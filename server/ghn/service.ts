import {
  GHN_CANCELLABLE_STATUSES,
  GHN_FINAL_STATUSES,
  formatGhnAddress,
  ghnStatusLabel,
  ghnToOrderStatus,
  isActiveShipment,
  type GhnAddress,
  type GhnPlace,
  type GhnQuote,
} from '../../shared/ghn'
import type { GhnDraft, GhnShipmentInput } from '../../shared/schemas'
import type { Order, OrderItem } from '../../shared/types'
import { AppError, conflict, notFound } from '../errors'
import type { Mutex } from '../mutex'
import type { DataStore, Snapshot } from '../repo/types'
import type { GhnClient, GhnOrderPayload, GhnSender } from './client'

/** Payload webhook trạng thái đơn của GHN (khóa PascalCase). */
export interface GhnWebhookPayload {
  OrderCode?: string
  ClientOrderCode?: string
  Type?: string
  Status?: string
  Time?: string
  CODAmount?: number
  TotalFee?: number
}

interface ResolvedAddress {
  isNew: boolean
  province: GhnPlace
  /** null ở hệ mới (không còn cấp quận/huyện). */
  district: GhnPlace | null
  ward: GhnPlace
}

export interface SyncAllResult {
  checked: number
  updated: number
  failed: number
}

/** Mã đơn gửi GHN (client_order_code): lần đầu là mã đơn, tạo lại sau khi hủy thì thêm -R2, -R3… */
export function nextClientCode(order: Pick<Order, 'order_code' | 'ghn_client_code'>): string {
  if (!order.ghn_client_code) return order.order_code
  const m = /-R(\d+)$/.exec(order.ghn_client_code)
  return `${order.order_code}-R${m ? Number(m[1]) + 1 : 2}`
}

const time = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

/**
 * Áp trạng thái GHN mới vào đơn. Trả về null nếu không có gì thay đổi hoặc
 * sự kiện cũ hơn trạng thái đã ghi (webhook đến trễ / gửi lặp).
 */
export function applyGhnStatus(
  order: Order,
  status: string,
  at: string,
  now: string,
  extra: { cod_amount?: number; expected_delivery?: string } = {},
): Order | null {
  if (!status) return null
  if (at && order.ghn_status_at && time(at) < time(order.ghn_status_at)) return null
  let localStatus = ghnToOrderStatus(status) ?? order.status
  // Vận đơn bị hủy khi chưa lấy hàng: đơn quay về "Đã xác nhận" để tạo vận đơn khác.
  if (status === 'cancel' && order.status === 'packing') localStatus = 'confirmed'
  const next: Order = {
    ...order,
    ghn_status: status,
    ghn_status_at: at || order.ghn_status_at,
    ghn_cod_amount: extra.cod_amount ?? order.ghn_cod_amount,
    ghn_expected_delivery: extra.expected_delivery || order.ghn_expected_delivery,
    status: localStatus,
  }
  const changed =
    next.ghn_status !== order.ghn_status ||
    next.status !== order.status ||
    next.ghn_cod_amount !== order.ghn_cod_amount ||
    next.ghn_expected_delivery !== order.ghn_expected_delivery
  if (!changed) return null
  return { ...next, updated_at: now }
}

export class ShippingService {
  constructor(
    private store: DataStore,
    private ghn: GhnClient,
    private writeLock: Mutex,
    private clock: () => Date = () => new Date(),
    /** null = để GHN dùng địa chỉ shop đã khai báo trên GHN. */
    private sender: GhnSender | null = null,
  ) {}

  private senderFields(): Partial<GhnOrderPayload> {
    const s = this.sender
    if (!s) return {}
    const address = formatGhnAddress({ street: s.street, ward_name: s.ward, province_name: s.province })
    const contact = { ...(s.name ? { from_name: s.name } : {}), ...(s.phone ? { from_phone: s.phone } : {}) }
    return {
      ...contact,
      from_address: address,
      from_ward_name: s.ward,
      from_province_name: s.province,
      is_new_from_address: true,
      // Hàng hoàn về cùng địa chỉ lấy hàng (shop chưa có kho trả hàng trên GHN).
      ...(s.name ? { return_name: s.name } : {}),
      ...(s.phone ? { return_phone: s.phone } : {}),
      return_address: address,
      return_ward_name: s.ward,
      return_province_name: s.province,
      is_new_return_address: true,
    }
  }

  provinces(): Promise<GhnPlace[]> {
    return this.ghn.provinces()
  }

  wards(provinceId: number): Promise<GhnPlace[]> {
    return this.ghn.wards(provinceId)
  }

  oldProvinces(): Promise<GhnPlace[]> {
    return this.ghn.oldProvinces()
  }

  districts(provinceId: number): Promise<GhnPlace[]> {
    return this.ghn.districts(provinceId)
  }

  oldWards(districtId: number): Promise<GhnPlace[]> {
    return this.ghn.oldWards(districtId)
  }

  /** Tra lại tên chuẩn của GHN theo mã (hệ mới hoặc cũ) — không tin tên do trình duyệt gửi lên. */
  private async resolveAddress(
    input: Pick<GhnShipmentInput, 'is_new_address' | 'province_id' | 'district_id' | 'ward_id'>,
  ): Promise<ResolvedAddress> {
    const isNew = input.is_new_address
    const provinces = isNew ? await this.ghn.provinces() : await this.ghn.oldProvinces()
    const province = provinces.find((p) => p.id === input.province_id)
    if (!province) throw new AppError(400, 'Tỉnh/thành không có trong danh mục GHN, vui lòng chọn lại.')
    let district: GhnPlace | null = null
    if (!isNew) {
      district = (await this.ghn.districts(province.id)).find((d) => d.id === input.district_id) ?? null
      if (!district) throw new AppError(400, `Quận/huyện không thuộc ${province.name}, vui lòng chọn lại.`)
    }
    const wards = district ? await this.ghn.oldWards(district.id) : await this.ghn.wards(province.id)
    const ward = wards.find((w) => w.id === input.ward_id)
    if (!ward) throw new AppError(400, `Phường/xã không thuộc ${district?.name ?? province.name}, vui lòng chọn lại.`)
    return { isNew, province, district, ward }
  }

  private findOrder(snap: Snapshot, id: string) {
    const order = snap.orders.find((o) => o.id === id)
    if (!order) throw notFound('đơn hàng')
    const items = snap.items.filter((i) => i.order_id === id)
    return { order, items }
  }

  private buildPayload(
    order: Order,
    items: OrderItem[],
    input: GhnShipmentInput,
    { isNew, province, district, ward }: ResolvedAddress,
  ): GhnOrderPayload {
    if (!items.length) throw new AppError(400, 'Đơn chưa có sản phẩm nào.')
    return {
      ...this.senderFields(),
      to_name: input.to_name.trim(),
      to_phone: input.to_phone.replace(/\D/g, ''),
      to_address: formatGhnAddress({
        street: input.street,
        ward_name: ward.name,
        district_name: district?.name,
        province_name: province.name,
      }),
      to_ward_name: ward.name,
      ...(district ? { to_district_name: district.name } : {}),
      to_province_name: province.name,
      is_new_to_address: isNew,
      weight: input.weight,
      length: input.length,
      width: input.width,
      height: input.height,
      service_type_id: 2,
      payment_type_id: input.payment_type_id,
      required_note: input.required_note,
      cod_amount: input.cod_amount,
      insurance_value: input.insurance_value,
      order_value: order.total_amount,
      note: input.note.trim(),
      content: `${order.order_code}: ${order.items_summary}`.slice(0, 2000),
      items: items.map((it) => ({
        name: `${it.product_name} - size ${it.size}`.slice(0, 512),
        code: it.size,
        quantity: it.quantity,
        price: it.unit_price,
      })),
    }
  }

  /** Tính phí + ngày giao dự kiến, không tạo vận đơn. */
  async preview(orderId: string, input: GhnShipmentInput): Promise<GhnQuote> {
    const snap = await this.store.snapshot()
    const { order, items } = this.findOrder(snap, orderId)
    return this.ghn.preview(this.buildPayload(order, items, input, await this.resolveAddress(input)))
  }

  createShipment(orderId: string, input: GhnShipmentInput): Promise<Order> {
    return this.writeLock.run(async () => {
      const snap = await this.store.snapshot(true)
      const { order, items } = this.findOrder(snap, orderId)
      if (input.expected_updated_at && input.expected_updated_at !== order.updated_at) throw conflict('Đơn hàng')
      if (isActiveShipment(order)) {
        throw new AppError(409, `Đơn đã có vận đơn GHN ${order.ghn_order_code}. Hủy vận đơn cũ trước khi tạo mới.`)
      }
      if (order.status === 'cancelled') throw new AppError(400, 'Đơn đã hủy, không thể gửi giao hàng.')

      const resolved = await this.resolveAddress(input)
      const { province, district, ward } = resolved
      const payload = this.buildPayload(order, items, input, resolved)
      // client_order_code giúp gửi lại an toàn: nếu lần trước GHN đã tạo mà app chưa kịp lưu, GHN trả lại đúng vận đơn đó.
      payload.client_order_code = nextClientCode(order)
      const created = await this.ghn.create(payload)

      const now = this.clock().toISOString()
      const updated: Order = {
        ...order,
        ghn_order_code: created.order_code,
        ghn_client_code: payload.client_order_code,
        ghn_status: 'ready_to_pick',
        // Để trống: mốc thời gian lấy theo đồng hồ GHN từ webhook/đồng bộ đầu tiên.
        ghn_status_at: '',
        ghn_fee: created.total_fee,
        ghn_cod_amount: input.cod_amount,
        ghn_expected_delivery: created.expected_delivery_time,
        ghn_to_address: payload.to_address,
        ghn_draft: '',
        status: ghnToOrderStatus('ready_to_pick') ?? order.status,
        updated_at: now,
      }
      await this.store.update('orders', updated)

      if (input.save_address) {
        const customer = snap.customers.find((c) => c.id === order.customer_id)
        if (customer) {
          const address: GhnAddress = {
            is_new: resolved.isNew,
            province_id: province.id,
            province_name: province.name,
            district_id: district?.id ?? 0,
            district_name: district?.name ?? '',
            ward_id: ward.id,
            ward_name: ward.name,
            street: input.street.trim(),
          }
          try {
            await this.store.update('customers', {
              ...customer,
              address: customer.address || payload.to_address,
              ghn_address: JSON.stringify(address),
              updated_at: now,
            })
          } catch (err) {
            // Vận đơn đã tạo và đã lưu vào đơn; lỗi lưu địa chỉ gợi ý không nên làm hỏng cả thao tác.
            console.error('[ghn] Không lưu được địa chỉ GHN của khách:', (err as Error)?.message)
          }
        }
      }
      return updated
    })
  }

  /**
   * Lưu nháp form GHN vào đơn (null = xóa nháp). Không đổi updated_at: nháp không phải là sửa đơn,
   * nên người khác đang mở form sửa đơn không bị báo xung đột.
   */
  saveDraft(orderId: string, draft: GhnDraft | null): Promise<Order> {
    return this.writeLock.run(async () => {
      const { order } = this.findOrder(await this.store.snapshot(true), orderId)
      if (draft && isActiveShipment(order)) throw new AppError(409, `Đơn đã có vận đơn GHN ${order.ghn_order_code}.`)
      const value = draft ? JSON.stringify({ ...draft, saved_at: this.clock().toISOString() }) : ''
      if (value === order.ghn_draft) return order
      const next: Order = { ...order, ghn_draft: value }
      await this.store.update('orders', next)
      return next
    })
  }

  /** Lấy trạng thái mới nhất từ GHN cho một đơn. */
  async syncShipment(orderId: string): Promise<Order> {
    const snap = await this.store.snapshot()
    const { order } = this.findOrder(snap, orderId)
    if (!order.ghn_order_code) throw new AppError(400, 'Đơn chưa gửi GHN.')
    const detail = await this.ghn.detail(order.ghn_order_code)
    return this.writeLock.run(async () => {
      const fresh = this.findOrder(await this.store.snapshot(true), orderId).order
      if (fresh.ghn_order_code !== order.ghn_order_code) return fresh
      const next = applyGhnStatus(fresh, detail.status, detail.updated_date, this.clock().toISOString(), {
        cod_amount: detail.cod_amount,
        expected_delivery: detail.leadtime,
      })
      if (!next) return fresh
      await this.store.update('orders', next)
      return next
    })
  }

  /** Đồng bộ mọi vận đơn chưa kết thúc (dùng khi server không nhận được webhook, ví dụ chạy ở máy cá nhân). */
  async syncAll(): Promise<SyncAllResult> {
    const snap = await this.store.snapshot()
    const active = snap.orders.filter((o) => o.ghn_order_code && !GHN_FINAL_STATUSES.includes(o.ghn_status))
    const details = new Map<string, Awaited<ReturnType<GhnClient['detail']>>>()
    let failed = 0
    // Gọi GHN lần lượt, ngoài khóa ghi, để không chặn các thao tác khác trong lúc chờ mạng.
    for (const o of active) {
      try {
        details.set(o.ghn_order_code, await this.ghn.detail(o.ghn_order_code))
      } catch {
        failed++
      }
    }
    if (!details.size) return { checked: active.length, updated: 0, failed }

    const updated = await this.writeLock.run(async () => {
      const fresh = await this.store.snapshot(true)
      const now = this.clock().toISOString()
      let count = 0
      for (const o of fresh.orders) {
        const d = o.ghn_order_code ? details.get(o.ghn_order_code) : undefined
        if (!d) continue
        const next = applyGhnStatus(o, d.status, d.updated_date, now, { cod_amount: d.cod_amount, expected_delivery: d.leadtime })
        if (!next) continue
        await this.store.update('orders', next)
        count++
      }
      return count
    })
    return { checked: active.length, updated, failed }
  }

  /** Xử lý callback của GHN. Trả về false nếu không có đơn tương ứng (vẫn trả 200 để GHN không gửi lại). */
  handleWebhook(payload: GhnWebhookPayload): Promise<boolean> {
    return this.writeLock.run(async () => {
      const code = String(payload.OrderCode ?? '').trim()
      const clientCode = String(payload.ClientOrderCode ?? '').trim()
      if (!code) return false
      const snap = await this.store.snapshot(true)
      let order = snap.orders.find((o) => o.ghn_order_code === code)
      // Trường hợp GHN đã tạo vận đơn nhưng app chưa kịp lưu mã: nhận ra theo client_order_code.
      if (!order && clientCode) {
        const candidate = snap.orders.find((o) => o.order_code === clientCode.replace(/-R\d+$/, ''))
        // Chỉ nhận đúng mã mà lần tạo kế tiếp sẽ dùng, để callback của vận đơn cũ không gắn nhầm vào đơn.
        if (candidate && !isActiveShipment(candidate) && nextClientCode(candidate) === clientCode) {
          order = { ...candidate, ghn_order_code: code, ghn_client_code: clientCode, ghn_status: '', ghn_status_at: '' }
        }
      }
      if (!order) return false

      const now = this.clock().toISOString()
      const at = String(payload.Time ?? '')
      let next: Order | null = null
      if ((payload.Type === 'switch_status' || payload.Type === 'create') && payload.Status) {
        next = applyGhnStatus(order, String(payload.Status), at, now, {
          cod_amount: typeof payload.CODAmount === 'number' ? payload.CODAmount : undefined,
        })
      } else if (payload.Type === 'update_cod' && typeof payload.CODAmount === 'number' && payload.CODAmount !== order.ghn_cod_amount) {
        next = { ...order, ghn_cod_amount: payload.CODAmount, updated_at: now }
      } else if (payload.Type === 'update_fee' && typeof payload.TotalFee === 'number' && payload.TotalFee > 0 && payload.TotalFee !== order.ghn_fee) {
        next = { ...order, ghn_fee: payload.TotalFee, updated_at: now }
      }
      if (next) {
        await this.store.update('orders', next)
        console.log(`[ghn] webhook ${payload.Type} → ${ghnStatusLabel(next.ghn_status)}`)
      }
      return true
    })
  }

  cancelShipment(orderId: string, expectedUpdatedAt?: string): Promise<Order> {
    return this.writeLock.run(async () => {
      const snap = await this.store.snapshot(true)
      const { order } = this.findOrder(snap, orderId)
      if (expectedUpdatedAt && expectedUpdatedAt !== order.updated_at) throw conflict('Đơn hàng')
      if (!isActiveShipment(order)) throw new AppError(400, 'Đơn không có vận đơn GHN đang hiệu lực.')
      if (!GHN_CANCELLABLE_STATUSES.includes(order.ghn_status)) {
        throw new AppError(
          400,
          `Vận đơn đang ở trạng thái "${ghnStatusLabel(order.ghn_status)}", không hủy qua app được. Liên hệ GHN để yêu cầu trả hàng.`,
        )
      }
      await this.ghn.cancel(order.ghn_order_code)
      const now = this.clock().toISOString()
      const next = applyGhnStatus(order, 'cancel', '', now) ?? order
      await this.store.update('orders', next)
      return next
    })
  }

  async printUrl(orderId: string): Promise<string> {
    const { order } = this.findOrder(await this.store.snapshot(), orderId)
    if (!isActiveShipment(order)) throw new AppError(400, 'Đơn không có vận đơn GHN đang hiệu lực.')
    return this.ghn.printUrl(order.ghn_order_code)
  }
}
