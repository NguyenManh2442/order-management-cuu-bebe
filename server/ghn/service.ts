import {
  GHN_CANCELLABLE_STATUSES,
  GHN_FINAL_STATUSES,
  SHIPPABLE_STATUSES,
  formatGhnAddress,
  ghnStatusLabel,
  ghnToOrderStatus,
  isActiveShipment,
  type GhnAddress,
  type GhnPlace,
  type GhnQuote,
} from '../../shared/ghn'
import type { GhnDraft, GhnShipmentInput } from '../../shared/schemas'
import { amountDue } from '../../shared/stats'
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

/**
 * Đơn chính của một vận đơn gửi chung: đơn đã đặt client_order_code khi tạo.
 * Các đơn gửi kèm lưu cùng client code nhưng mã đơn khác.
 */
function primaryOf(members: Order[]): Order {
  return members.find((o) => o.ghn_client_code.replace(/-R\d+$/, '') === o.order_code) ?? members[0]
}

/**
 * Áp trạng thái GHN cho mọi đơn cùng vận đơn. COD trên GHN là tổng cả gói: đơn gửi kèm giữ phần của mình,
 * phần chênh lệch (nếu sửa COD trên GHN) tính vào đơn chính — để cảnh báo "thu hộ khác số còn phải thu" vẫn đúng từng đơn.
 */
export function applyGhnStatusToShipment(
  members: Order[],
  status: string,
  at: string,
  now: string,
  extra: { cod_amount?: number; expected_delivery?: string } = {},
): Order[] {
  if (!members.length) return []
  const primary = primaryOf(members)
  const primaryCod = extra.cod_amount === undefined ? undefined : primaryCodShare(members, primary, extra.cod_amount)
  return members.flatMap((o) => {
    const cod = extra.cod_amount === undefined ? undefined : o === primary ? primaryCod : o.ghn_cod_amount
    const next = applyGhnStatus(o, status, at, now, { ...extra, cod_amount: cod })
    return next ? [next] : []
  })
}

/** COD trên GHN là tổng cả gói: đơn gửi kèm giữ phần của mình, phần còn lại (kể cả chênh lệch khi sửa COD trên GHN) thuộc đơn chính. */
function primaryCodShare(members: Order[], primary: Order, total: number): number {
  const others = members.filter((o) => o !== primary).reduce((sum, o) => sum + o.ghn_cod_amount, 0)
  return Math.max(0, total - others)
}

interface BundleEntry {
  order: Order
  items: OrderItem[]
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

  /** Mọi đơn đang dùng chung vận đơn của đơn này (gồm cả nó). */
  private shipmentMembers(snap: Snapshot, order: Order): Order[] {
    if (!order.ghn_order_code) return [order]
    return snap.orders.filter((o) => o.ghn_order_code === order.ghn_order_code)
  }

  /**
   * Đơn gửi kèm: cùng khách, còn ở giai đoạn chuẩn bị hàng, chưa có vận đơn.
   * checkVersion = kiểm tra không ai sửa đơn kể từ lúc mở form (khi tạo vận đơn thật).
   */
  private loadBundle(snap: Snapshot, main: Order, input: GhnShipmentInput, checkVersion: boolean): BundleEntry[] {
    const seen = new Set<string>([main.id])
    return (input.bundle ?? []).map(({ id, expected_updated_at }) => {
      if (seen.has(id)) throw new AppError(400, 'Đơn gửi kèm bị trùng.')
      seen.add(id)
      const order = snap.orders.find((o) => o.id === id)
      if (!order) throw new AppError(404, 'Một đơn gửi kèm không còn tồn tại — tải lại trang rồi chọn lại.')
      const code = order.order_code
      if (order.customer_id !== main.customer_id) throw new AppError(400, `Đơn ${code} không cùng khách hàng, không gửi chung được.`)
      if (isActiveShipment(order)) throw new AppError(409, `Đơn ${code} đã có vận đơn GHN ${order.ghn_order_code}.`)
      if (!SHIPPABLE_STATUSES.includes(order.status)) throw new AppError(400, `Đơn ${code} không còn ở giai đoạn chuẩn bị hàng.`)
      if (checkVersion && expected_updated_at && expected_updated_at !== order.updated_at) {
        throw new AppError(409, `Đơn gửi kèm ${code} vừa được sửa — tải lại trang rồi thử lại.`)
      }
      return { order, items: snap.items.filter((i) => i.order_id === id) }
    })
  }

  private buildPayload(
    order: Order,
    items: OrderItem[],
    input: GhnShipmentInput,
    { isNew, province, district, ward }: ResolvedAddress,
    bundle: BundleEntry[] = [],
  ): GhnOrderPayload {
    if (!items.length) throw new AppError(400, 'Đơn chưa có sản phẩm nào.')
    const all = [{ order, items }, ...bundle]
    // Gửi chung: nội dung hàng trên nhãn liệt kê từng đơn để lúc đóng gói không sót.
    const content = bundle.length
      ? `Gồm đơn ${all.map((b) => b.order.order_code).join(', ')}. ` + all.map((b) => `${b.order.order_code}: ${b.order.items_summary}`).join('; ')
      : `${order.order_code}: ${order.items_summary}`
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
      order_value: all.reduce((sum, b) => sum + b.order.total_amount, 0),
      note: input.note.trim(),
      content: content.slice(0, 2000),
      items: all.flatMap((b) => b.items).map((it) => ({
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
    const bundle = this.loadBundle(snap, order, input, false)
    return this.ghn.preview(this.buildPayload(order, items, input, await this.resolveAddress(input), bundle))
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
      const bundle = this.loadBundle(snap, order, input, true)
      // COD là tổng cả gói; mỗi đơn gửi kèm thu đúng phần còn phải thu của nó, phần còn lại thuộc đơn chính.
      const bundleDue = bundle.reduce((sum, b) => sum + amountDue(b.order), 0)
      if (input.cod_amount < bundleDue) {
        throw new AppError(
          400,
          `Tiền thu hộ phải ít nhất ${bundleDue.toLocaleString('vi-VN')} ₫ (số còn phải thu của các đơn gửi kèm).`,
        )
      }

      const resolved = await this.resolveAddress(input)
      const { province, district, ward } = resolved
      const payload = this.buildPayload(order, items, input, resolved, bundle)
      // client_order_code giúp gửi lại an toàn: nếu lần trước GHN đã tạo mà app chưa kịp lưu, GHN trả lại đúng vận đơn đó.
      payload.client_order_code = nextClientCode(order)
      if (bundle.length) {
        // Ghi trước client code vào đơn gửi kèm: nếu GHN tạo xong mà app chưa kịp lưu, webhook vẫn nhận ra cả gói.
        // Không đổi updated_at (chưa phải sửa đơn).
        await this.store.updateMany(
          'orders',
          bundle.map(({ order: b }) => ({ ...b, ghn_client_code: payload.client_order_code ?? '' })),
        )
      }
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
        ghn_cod_amount: input.cod_amount - bundleDue,
        ghn_expected_delivery: created.expected_delivery_time,
        ghn_to_address: payload.to_address,
        ghn_draft: '',
        status: ghnToOrderStatus('ready_to_pick') ?? order.status,
        updated_at: now,
      }
      // Đơn gửi kèm: cùng mã vận đơn, phí ship chỉ ghi ở đơn chính.
      const companions = bundle.map(
        ({ order: b }): Order => ({
          ...b,
          ghn_order_code: updated.ghn_order_code,
          ghn_client_code: updated.ghn_client_code,
          ghn_status: updated.ghn_status,
          ghn_status_at: '',
          ghn_fee: 0,
          ghn_cod_amount: amountDue(b),
          ghn_expected_delivery: updated.ghn_expected_delivery,
          ghn_to_address: updated.ghn_to_address,
          ghn_draft: '',
          status: ghnToOrderStatus('ready_to_pick') ?? b.status,
          updated_at: now,
        }),
      )
      if (companions.length) await this.store.updateMany('orders', [updated, ...companions])
      else await this.store.update('orders', updated)

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
      const freshSnap = await this.store.snapshot(true)
      const fresh = this.findOrder(freshSnap, orderId).order
      if (fresh.ghn_order_code !== order.ghn_order_code) return fresh
      const changed = applyGhnStatusToShipment(this.shipmentMembers(freshSnap, fresh), detail.status, detail.updated_date, this.clock().toISOString(), {
        cod_amount: detail.cod_amount,
        expected_delivery: detail.leadtime,
      })
      if (!changed.length) return fresh
      await this.store.updateMany('orders', changed)
      return changed.find((o) => o.id === orderId) ?? fresh
    })
  }

  /** Đồng bộ mọi vận đơn chưa kết thúc (dùng khi server không nhận được webhook, ví dụ chạy ở máy cá nhân). */
  async syncAll(): Promise<SyncAllResult> {
    const snap = await this.store.snapshot()
    // Đơn gửi chung một vận đơn chỉ hỏi GHN một lần.
    const codes = [...new Set(snap.orders.filter((o) => o.ghn_order_code && !GHN_FINAL_STATUSES.includes(o.ghn_status)).map((o) => o.ghn_order_code))]
    const details = new Map<string, Awaited<ReturnType<GhnClient['detail']>>>()
    let failed = 0
    // Gọi GHN lần lượt, ngoài khóa ghi, để không chặn các thao tác khác trong lúc chờ mạng.
    for (const code of codes) {
      try {
        details.set(code, await this.ghn.detail(code))
      } catch {
        failed++
      }
    }
    if (!details.size) return { checked: codes.length, updated: 0, failed }

    const updated = await this.writeLock.run(async () => {
      const fresh = await this.store.snapshot(true)
      const now = this.clock().toISOString()
      const changed: Order[] = []
      for (const [code, d] of details) {
        const members = fresh.orders.filter((o) => o.ghn_order_code === code)
        changed.push(...applyGhnStatusToShipment(members, d.status, d.updated_date, now, { cod_amount: d.cod_amount, expected_delivery: d.leadtime }))
      }
      if (changed.length) await this.store.updateMany('orders', changed)
      return changed.length
    })
    return { checked: codes.length, updated, failed }
  }

  /** Xử lý callback của GHN. Trả về false nếu không có đơn tương ứng (vẫn trả 200 để GHN không gửi lại). */
  handleWebhook(payload: GhnWebhookPayload): Promise<boolean> {
    return this.writeLock.run(async () => {
      const code = String(payload.OrderCode ?? '').trim()
      const clientCode = String(payload.ClientOrderCode ?? '').trim()
      if (!code) return false
      const snap = await this.store.snapshot(true)
      let members = snap.orders.filter((o) => o.ghn_order_code === code)
      let order: Order | undefined = members[0]
      // Trường hợp GHN đã tạo vận đơn nhưng app chưa kịp lưu mã: nhận ra theo client_order_code.
      if (!order && clientCode) {
        const candidate = snap.orders.find((o) => o.order_code === clientCode.replace(/-R\d+$/, ''))
        // Chỉ nhận đúng mã mà lần tạo kế tiếp sẽ dùng, để callback của vận đơn cũ không gắn nhầm vào đơn.
        if (candidate && !isActiveShipment(candidate) && nextClientCode(candidate) === clientCode) {
          const link = (o: Order): Order => ({ ...o, ghn_order_code: code, ghn_client_code: clientCode, ghn_status: '', ghn_status_at: '' })
          order = link(candidate)
          // Đơn gửi kèm đã được ghi sẵn client code trước khi gọi GHN.
          const companions = snap.orders
            .filter((o) => o.id !== candidate.id && o.ghn_client_code === clientCode && !isActiveShipment(o) && SHIPPABLE_STATUSES.includes(o.status))
            .map((o): Order => ({ ...link(o), ghn_fee: 0, ghn_cod_amount: amountDue(o) }))
          members = [order, ...companions]
        }
      }
      if (!order) return false

      const now = this.clock().toISOString()
      const at = String(payload.Time ?? '')
      const cod = typeof payload.CODAmount === 'number' ? payload.CODAmount : undefined
      const primary = primaryOf(members)
      let changed: Order[] = []
      if ((payload.Type === 'switch_status' || payload.Type === 'create') && payload.Status) {
        changed = applyGhnStatusToShipment(members, String(payload.Status), at, now, { cod_amount: cod })
      } else if (payload.Type === 'update_cod' && cod !== undefined) {
        const share = primaryCodShare(members, primary, cod)
        if (share !== primary.ghn_cod_amount) changed = [{ ...primary, ghn_cod_amount: share, updated_at: now }]
      } else if (payload.Type === 'update_fee' && typeof payload.TotalFee === 'number' && payload.TotalFee > 0 && payload.TotalFee !== primary.ghn_fee) {
        changed = [{ ...primary, ghn_fee: payload.TotalFee, updated_at: now }]
      }
      if (changed.length) {
        await this.store.updateMany('orders', changed)
        console.log(`[ghn] webhook ${payload.Type} → ${ghnStatusLabel(changed[0].ghn_status)} (${changed.length} đơn)`)
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
      // Hủy vận đơn gửi chung thì mọi đơn trong gói đều về chưa gửi.
      const changed = applyGhnStatusToShipment(this.shipmentMembers(snap, order), 'cancel', '', now)
      if (changed.length) await this.store.updateMany('orders', changed)
      return changed.find((o) => o.id === orderId) ?? order
    })
  }

  async printUrl(orderId: string): Promise<string> {
    const { order } = this.findOrder(await this.store.snapshot(), orderId)
    if (!isActiveShipment(order)) throw new AppError(400, 'Đơn không có vận đơn GHN đang hiệu lực.')
    return this.ghn.printUrl([order.ghn_order_code])
  }

  /** In gộp nhãn nhiều đơn trong một trang. Đơn chưa có vận đơn hiệu lực thì bỏ qua. */
  async printUrlMany(orderIds: string[]): Promise<{ url: string; count: number; skipped: string[] }> {
    const snap = await this.store.snapshot()
    const byId = new Map(snap.orders.map((o) => [o.id, o]))
    const codes: string[] = []
    const skipped: string[] = []
    for (const id of new Set(orderIds)) {
      const o = byId.get(id)
      if (o && isActiveShipment(o)) {
        // Đơn gửi chung một vận đơn chỉ in một nhãn.
        if (!codes.includes(o.ghn_order_code)) codes.push(o.ghn_order_code)
      } else skipped.push(o?.order_code ?? id)
    }
    if (!codes.length) throw new AppError(400, 'Các đơn đã chọn chưa có vận đơn GHN để in.')
    return { url: await this.ghn.printUrl(codes), count: codes.length, skipped }
  }
}
