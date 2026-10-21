import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  DEFAULT_GHN_DEFAULTS,
  type GhnDefaults,
  type GhnEnv,
  type GhnPlace,
  type GhnPublicConfig,
  type GhnSenderAddress,
  type GhnSettingsView,
  type GhnShop,
} from '../../shared/ghn'
import { ghnSettingsInputSchema, type GhnSettingsInput } from '../../shared/schemas'
import { AppError } from '../errors'
import type { Mutex } from '../mutex'
import type { DataStore } from '../repo/types'
import { FakeGhnClient, HttpGhnClient, type GhnClient, type GhnSender } from './client'
import { ShippingService } from './service'

/** Cấu hình GHN đầy đủ (có token) — chỉ nằm ở server. */
export interface GhnSettings {
  env: GhnEnv
  token: string
  shop_id: string
  webhook_secret: string
  sender: GhnSenderAddress | null
  defaults: GhnDefaults
}

const toSender = (s: GhnSenderAddress | null): GhnSender | null =>
  s ? { name: s.name, phone: s.phone, street: s.street, ward: s.ward_name, province: s.province_name } : null

/** Đọc file cấu hình; file hỏng thì báo lỗi rõ ràng thay vì âm thầm dùng cấu hình khác. */
function readSettingsFile(file: string): GhnSettings | null {
  if (!existsSync(file)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`File cấu hình GHN ${file} không đọc được (JSON lỗi). Sửa hoặc xóa file rồi thiết lập lại.`)
  }
  const v = raw as Partial<GhnSettings>
  if ((v.env !== 'staging' && v.env !== 'production') || !v.token || !/^\d+$/.test(String(v.shop_id ?? ''))) {
    throw new Error(`File cấu hình GHN ${file} thiếu env/token/shop_id. Sửa hoặc xóa file rồi thiết lập lại.`)
  }
  return {
    env: v.env,
    token: String(v.token),
    shop_id: String(v.shop_id),
    webhook_secret: String(v.webhook_secret ?? ''),
    sender: v.sender ?? null,
    defaults: { ...DEFAULT_GHN_DEFAULTS, ...v.defaults },
  }
}

/**
 * Cấu hình GHN đang chạy. Lưu thiết lập mới thì tạo lại client + ShippingService ngay,
 * không cần khởi động lại server.
 */
export class GhnRuntime {
  settings: GhnSettings | null = null
  source: GhnSettingsView['source'] = 'none'
  client: GhnClient | null = null
  shipping: ShippingService | null = null

  constructor(
    private opts: {
      store: DataStore
      lock: Mutex
      file: string
      fromEnv: GhnSettings | null
      demoFallback: boolean
      /** Khác '' = không cho lưu thiết lập (ví dụ Vercel), kèm hướng dẫn. */
      readOnlyReason?: string
      /** Tạo client GHN thật — thay được trong test. */
      createClient?: (env: GhnEnv, token: string, shopId: string) => HttpGhnClient
    },
  ) {
    const fromFile = readSettingsFile(opts.file)
    this.apply(fromFile ?? opts.fromEnv, fromFile ? 'file' : opts.fromEnv ? 'env' : 'none')
  }

  private newClient(env: GhnEnv, token: string, shopId: string): HttpGhnClient {
    return this.opts.createClient?.(env, token, shopId) ?? new HttpGhnClient(env, token, shopId)
  }

  private apply(settings: GhnSettings | null, source: GhnSettingsView['source']) {
    this.settings = settings
    this.source = source
    this.client = settings
      ? this.newClient(settings.env, settings.token, settings.shop_id)
      : this.opts.demoFallback
        ? new FakeGhnClient()
        : null
    this.shipping = this.client
      ? new ShippingService(this.opts.store, this.client, this.opts.lock, undefined, toSender(settings?.sender ?? null))
      : null
  }

  /** Kiểm tra token/shop lúc khởi động (chỉ ghi log). */
  checkOnStartup() {
    if (this.client instanceof HttpGhnClient) void this.client.checkShop(toSender(this.settings?.sender ?? null))
  }

  get envLabel(): string {
    return this.settings?.env ?? (this.client ? 'demo' : 'chưa thiết lập')
  }

  publicConfig(): GhnPublicConfig | null {
    if (!this.shipping) return null
    const d = this.settings?.defaults ?? DEFAULT_GHN_DEFAULTS
    return {
      env: this.settings?.env ?? 'demo',
      default_item_weight: d.item_weight,
      default_dimensions: { length: d.length, width: d.width, height: d.height },
      default_required_note: d.required_note,
      default_payment_type: d.payment_type,
    }
  }

  view(): GhnSettingsView {
    const s = this.settings
    return {
      source: this.source,
      env: s?.env ?? 'staging',
      has_token: !!s?.token,
      token_hint: s?.token ? s.token.slice(-4) : '',
      shop_id: s?.shop_id ?? '',
      webhook_secret: s?.webhook_secret ?? '',
      sender: s?.sender ?? null,
      defaults: s?.defaults ?? DEFAULT_GHN_DEFAULTS,
      demo_fallback: this.opts.demoFallback,
      read_only: this.opts.readOnlyReason ?? '',
    }
  }

  /** token = '' thì dùng token đã lưu (chỉ khi cùng môi trường — token staging và production khác nhau). */
  private resolveToken(env: GhnEnv, token: string): string {
    if (token) return token
    if (this.settings?.token && this.settings.env === env) return this.settings.token
    throw new AppError(400, `Nhập token GHN của môi trường ${env === 'production' ? 'thật (production)' : 'thử nghiệm (staging)'}.`)
  }

  listShops(env: GhnEnv, token: string): Promise<GhnShop[]> {
    return this.newClient(env, this.resolveToken(env, token), '').shops()
  }

  /** Danh mục tỉnh (provinceId = 0) hoặc phường/xã, gọi bằng token/shop đang nhập trên màn thiết lập. */
  places(env: GhnEnv, token: string, shopId: string, provinceId: number): Promise<GhnPlace[]> {
    const client = this.newClient(env, this.resolveToken(env, token), shopId)
    return provinceId > 0 ? client.wards(provinceId) : client.provinces()
  }

  async save(input: GhnSettingsInput): Promise<GhnSettingsView> {
    if (this.opts.readOnlyReason) throw new AppError(400, this.opts.readOnlyReason)
    const data = ghnSettingsInputSchema.parse(input)
    const token = this.resolveToken(data.env, data.token)
    const probe = this.newClient(data.env, token, data.shop_id)

    const shops = await probe.shops()
    const shop = shops.find((s) => String(s.id) === data.shop_id)
    if (!shop) {
      throw new AppError(400, `Cửa hàng ${data.shop_id} không thuộc token này. Chọn lại từ danh sách cửa hàng.`)
    }
    if (!data.sender && !shop.address) {
      throw new AppError(400, `Cửa hàng "${shop.name}" chưa có địa chỉ lấy hàng trên GHN — nhập địa chỉ lấy hàng.`)
    }

    let sender: GhnSenderAddress | null = null
    if (data.sender) {
      // Tra tên chuẩn theo mã, bằng chính token/shop vừa nhập.
      const province = (await probe.provinces()).find((p) => p.id === data.sender!.province_id)
      if (!province) throw new AppError(400, 'Tỉnh/thành lấy hàng không có trong danh mục GHN, chọn lại.')
      const ward = (await probe.wards(province.id)).find((w) => w.id === data.sender!.ward_id)
      if (!ward) throw new AppError(400, `Phường/xã lấy hàng không thuộc ${province.name}, chọn lại.`)
      sender = {
        name: data.sender.name,
        phone: data.sender.phone,
        street: data.sender.street,
        province_id: province.id,
        province_name: province.name,
        ward_id: ward.id,
        ward_name: ward.name,
      }
    }

    const settings: GhnSettings = {
      env: data.env,
      token,
      shop_id: data.shop_id,
      webhook_secret: data.webhook_secret,
      sender,
      defaults: data.defaults,
    }
    this.writeFile(settings)
    this.apply(settings, 'file')
    console.log(`[ghn] Đã lưu thiết lập GHN (${settings.env}, shop ${settings.shop_id})`)
    return this.view()
  }

  private writeFile(settings: GhnSettings) {
    const file = this.opts.file
    try {
      mkdirSync(dirname(file), { recursive: true })
      // Ghi file tạm rồi đổi tên: không bao giờ để lại file cấu hình ghi dở. Chỉ chủ tiến trình đọc được (có token).
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 })
      renameSync(tmp, file)
    } catch (err) {
      console.error('[ghn] Không ghi được file cấu hình:', (err as Error).message)
      throw new AppError(500, `Không ghi được file cấu hình GHN (${file}). Kiểm tra quyền ghi thư mục trên server.`)
    }
  }
}
