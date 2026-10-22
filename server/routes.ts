import { timingSafeEqual } from 'node:crypto'
import { Router, type Request } from 'express'
import type { ZodType } from 'zod'
import {
  bulkOrderStatusInputSchema,
  ghnBulkPrintInputSchema,
  ghnCancelInputSchema,
  ghnDraftSchema,
  ghnSettingsInputSchema,
  ghnShipmentInputSchema,
  ghnPlacesQuerySchema,
  ghnShopsQuerySchema,
  groupCostInputSchema,
  groupInputSchema,
  loginInputSchema,
  orderInputSchema,
  orderStatusInputSchema,
  publicLinkInputSchema,
} from '../shared/schemas'
import type { AppConfig } from '../shared/types'
import {
  checkCredentials,
  clearSession,
  getSessionUser,
  loginRateLimited,
  requireAuth,
  resetLoginAttempts,
  setSession,
} from './auth'
import { config } from './config'
import { AppError } from './errors'
import type { GhnRuntime } from './ghn/settings'
import type { OrderService } from './service'

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    const first = result.error.issues[0]
    throw new AppError(400, first ? `${first.path.join('.')}: ${first.message}` : 'Dữ liệu không hợp lệ')
  }
  return result.data
}

const param = (req: Request, name: string) => String(req.params[name])

/** Tối đa 60 lượt tra cứu / phút / IP cho trang công khai. */
const publicHits = new Map<string, { count: number; reset: number }>()
function publicRateLimited(ip: string): boolean {
  const now = Date.now()
  const hit = publicHits.get(ip)
  if (!hit || hit.reset < now) {
    if (publicHits.size >= 10_000) {
      // Dọn IP đã hết hạn; vẫn đầy thì bỏ các IP cũ nhất (Map giữ thứ tự thêm vào) —
      // không xóa sạch để kẻ dò không thể tự reset bộ đếm của mình.
      for (const [key, v] of publicHits) if (v.reset < now) publicHits.delete(key)
      for (const key of publicHits.keys()) {
        if (publicHits.size < 10_000) break
        publicHits.delete(key)
      }
    }
    publicHits.delete(ip)
    publicHits.set(ip, { count: 1, reset: now + 60_000 })
    return false
  }
  return ++hit.count > 60
}

function sameSecret(actual: string | undefined, expected: string): boolean {
  const a = Buffer.from(actual ?? '')
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createApiRouter(service: OrderService, ghnRuntime: GhnRuntime): Router {
  const api = Router()

  /**
   * Callback trạng thái đơn của GHN. Không dùng phiên đăng nhập: xác thực bằng header
   * X-Webhook-Secret khai báo ở "Header tùy chỉnh" khi cấu hình webhook trên GHN.
   */
  api.post('/ghn/webhook', async (req, res) => {
    const secret = ghnRuntime.settings?.webhook_secret
    const shipping = ghnRuntime.shipping
    if (!shipping || !secret) throw new AppError(404, 'Webhook GHN chưa được bật (chưa có webhook secret trong Thiết lập GHN)')
    if (!sameSecret(req.get('X-Webhook-Secret'), secret)) throw new AppError(401, 'Sai X-Webhook-Secret')
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new AppError(400, 'Payload không hợp lệ')
    const matched = await shipping.handleWebhook(req.body)
    res.json({ ok: true, matched })
  })

  api.post('/auth/login', (req, res) => {
    const ip = req.ip ?? 'unknown'
    if (loginRateLimited(ip)) throw new AppError(429, 'Đăng nhập sai quá nhiều lần, thử lại sau 15 phút.')
    const { username, password } = parse(loginInputSchema, req.body)
    if (!checkCredentials(username, password)) throw new AppError(401, 'Sai tên đăng nhập hoặc mật khẩu')
    resetLoginAttempts(ip)
    setSession(res, username)
    res.json({ username })
  })

  api.post('/auth/logout', (_req, res) => {
    clearSession(res)
    res.json({ ok: true })
  })

  api.get('/auth/me', (req, res) => {
    const username = getSessionUser(req)
    if (!username) throw new AppError(401, 'Chưa đăng nhập')
    res.json({ username })
  })

  /**
   * Trang tra cứu đơn cho khách — không cần đăng nhập, chỉ cần mã bí mật trong link.
   * Giới hạn lượt gọi để không ai dò mã hay làm cạn quota Google Sheets.
   */
  api.get('/public/orders/:token', async (req, res) => {
    if (publicRateLimited(req.ip ?? 'unknown')) throw new AppError(429, 'Bạn tra cứu quá nhanh, vui lòng thử lại sau ít phút.')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    res.json(await service.getPublicOrder(param(req, 'token')))
  })

  /** Thông tin công khai cho màn đăng nhập (không chứa bí mật). */
  api.get('/auth/hints', (_req, res) => {
    res.json({ demo_login: config.demoLogin })
  })

  api.use(requireAuth)

  api.get('/config', (_req, res) => {
    const body: AppConfig = { sizes: config.sizes, data_source: config.dataSource, ghn: ghnRuntime.publicConfig() }
    res.json(body)
  })

  api.get('/ghn/settings', (_req, res) => {
    res.json(ghnRuntime.view())
  })
  api.post('/ghn/settings/shops', async (req, res) => {
    const { env, token } = parse(ghnShopsQuerySchema, req.body)
    res.json(await ghnRuntime.listShops(env, token))
  })
  api.post('/ghn/settings/places', async (req, res) => {
    const q = parse(ghnPlacesQuerySchema, req.body)
    res.json(await ghnRuntime.places(q.env, q.token, q.shop_id, q.province_id))
  })
  api.put('/ghn/settings', async (req, res) => {
    res.json(await ghnRuntime.save(parse(ghnSettingsInputSchema, req.body)))
  })

  const ghn = () => {
    if (!ghnRuntime.shipping) throw new AppError(404, 'Chưa thiết lập Giao Hàng Nhanh — vào "Thiết lập GHN" để kết nối.')
    return ghnRuntime.shipping
  }
  api.get('/ghn/provinces', async (_req, res) => {
    res.json(await ghn().provinces())
  })
  api.get('/ghn/wards', async (req, res) => {
    const provinceId = Number(req.query.province_id)
    if (!Number.isInteger(provinceId) || provinceId <= 0) throw new AppError(400, 'Thiếu province_id')
    res.json(await ghn().wards(provinceId))
  })
  const positiveId = (v: unknown, name: string) => {
    const n = Number(v)
    if (!Number.isInteger(n) || n <= 0) throw new AppError(400, `Thiếu ${name}`)
    return n
  }
  // Danh mục địa chỉ hệ cũ 3 cấp (Tỉnh → Quận/Huyện → Phường/Xã).
  api.get('/ghn/old/provinces', async (_req, res) => {
    res.json(await ghn().oldProvinces())
  })
  api.get('/ghn/old/districts', async (req, res) => {
    res.json(await ghn().districts(positiveId(req.query.province_id, 'province_id')))
  })
  api.get('/ghn/old/wards', async (req, res) => {
    res.json(await ghn().oldWards(positiveId(req.query.district_id, 'district_id')))
  })
  api.post('/ghn/sync', async (_req, res) => {
    res.json(await ghn().syncAll())
  })
  api.post('/orders/:id/ghn/preview', async (req, res) => {
    res.json(await ghn().preview(param(req, 'id'), parse(ghnShipmentInputSchema, req.body)))
  })
  api.post('/orders/:id/ghn', async (req, res) => {
    res.status(201).json(await ghn().createShipment(param(req, 'id'), parse(ghnShipmentInputSchema, req.body)))
  })
  api.put('/orders/:id/ghn/draft', async (req, res) => {
    res.json(await ghn().saveDraft(param(req, 'id'), parse(ghnDraftSchema, req.body)))
  })
  api.delete('/orders/:id/ghn/draft', async (req, res) => {
    res.json(await ghn().saveDraft(param(req, 'id'), null))
  })
  api.post('/orders/:id/ghn/sync', async (req, res) => {
    res.json(await ghn().syncShipment(param(req, 'id')))
  })
  api.post('/orders/:id/ghn/cancel', async (req, res) => {
    const { expected_updated_at } = parse(ghnCancelInputSchema, req.body)
    res.json(await ghn().cancelShipment(param(req, 'id'), expected_updated_at))
  })
  api.post('/orders/:id/ghn/print', async (req, res) => {
    res.json({ url: await ghn().printUrl(param(req, 'id')) })
  })
  api.post('/ghn/print', async (req, res) => {
    res.json(await ghn().printUrlMany(parse(ghnBulkPrintInputSchema, req.body).order_ids))
  })

  api.get('/groups', async (_req, res) => {
    res.json(await service.listGroups())
  })
  api.post('/groups', async (req, res) => {
    res.status(201).json(await service.createGroup(parse(groupInputSchema, req.body)))
  })
  api.get('/groups/:id', async (req, res) => {
    res.json(await service.getGroup(param(req, 'id')))
  })
  api.put('/groups/:id', async (req, res) => {
    res.json(await service.updateGroup(param(req, 'id'), parse(groupInputSchema, req.body)))
  })

  api.post('/groups/:id/costs', async (req, res) => {
    res.status(201).json(await service.createCost(param(req, 'id'), parse(groupCostInputSchema, req.body)))
  })
  api.put('/groups/:id/costs/:costId', async (req, res) => {
    res.json(await service.updateCost(param(req, 'id'), param(req, 'costId'), parse(groupCostInputSchema, req.body)))
  })
  api.delete('/groups/:id/costs/:costId', async (req, res) => {
    const expected = typeof req.query.expected_updated_at === 'string' ? req.query.expected_updated_at : undefined
    await service.deleteCost(param(req, 'id'), param(req, 'costId'), expected)
    res.status(204).end()
  })

  api.get('/orders', async (_req, res) => {
    res.json(await service.listOrders())
  })
  api.post('/orders', async (req, res) => {
    res.status(201).json(await service.createOrder(parse(orderInputSchema, req.body)))
  })
  api.get('/orders/:id', async (req, res) => {
    res.json(await service.getOrder(param(req, 'id')))
  })
  api.put('/orders/:id', async (req, res) => {
    res.json(await service.updateOrder(param(req, 'id'), parse(orderInputSchema, req.body)))
  })
  api.post('/orders/bulk-status', async (req, res) => {
    res.json(await service.bulkUpdateStatus(parse(bulkOrderStatusInputSchema, req.body)))
  })
  api.post('/orders/:id/public-link', async (req, res) => {
    res.json(await service.publicLink(param(req, 'id'), parse(publicLinkInputSchema, req.body).regenerate))
  })
  api.patch('/orders/:id/status', async (req, res) => {
    res.json(await service.updateOrderStatus(param(req, 'id'), parse(orderStatusInputSchema, req.body)))
  })
  api.delete('/orders/:id', async (req, res) => {
    const expected = typeof req.query.expected_updated_at === 'string' ? req.query.expected_updated_at : undefined
    await service.deleteOrder(param(req, 'id'), expected)
    res.status(204).end()
  })

  api.get('/customers', async (_req, res) => {
    res.json(await service.listCustomers())
  })
  api.get('/customers/lookup', async (req, res) => {
    const phone = typeof req.query.phone === 'string' ? req.query.phone : ''
    res.json(phone ? await service.findCustomerByPhone(phone) : null)
  })
  api.get('/customers/:id', async (req, res) => {
    res.json(await service.getCustomer(param(req, 'id')))
  })
  api.delete('/customers/:id', async (req, res) => {
    const expected = typeof req.query.expected_updated_at === 'string' ? req.query.expected_updated_at : undefined
    await service.deleteCustomer(param(req, 'id'), expected)
    res.status(204).end()
  })

  return api
}
