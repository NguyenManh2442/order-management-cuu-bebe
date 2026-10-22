import { randomBytes, randomUUID } from 'node:crypto'
import type { OrderStatus } from '../shared/constants'
import { emptyHistory, historyByCustomer, historyExcluding } from '../shared/customer-history'
import { ghnTrackingUrl, isActiveShipment } from '../shared/ghn'
import { normalizePhone, normalizeSize, normalizeUrl } from '../shared/phone'
import { COST_CATEGORIES } from '../shared/constants'
import type {
  BulkOrderStatusInput,
  CustomerInput,
  GroupCostInput,
  GroupInput,
  OrderInput,
  OrderStatusInput,
} from '../shared/schemas'
import { OPEN_ORDER_STATUSES, amountDue, computeGroupStats, summarizeItems } from '../shared/stats'
import type {
  BulkStatusResult,
  Customer,
  CustomerDetail,
  CustomerLookup,
  CustomerSummary,
  GroupCost,
  GroupDetail,
  GroupWithStats,
  Order,
  OrderGroup,
  OrderItem,
  OrderView,
  PublicOrderView,
} from '../shared/types'
import { AppError, conflict, notFound } from './errors'
import { Mutex } from './mutex'
import type { DataStore, Snapshot } from './repo/types'

const byNewest = (a: { created_at: string }, b: { created_at: string }) => b.created_at.localeCompare(a.created_at)

/** Mã đơn dạng DH251221-001: ngày tạo theo giờ Việt Nam + số thứ tự trong ngày. */
export function nextOrderCode(existing: Iterable<string>, now: Date): string {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .replaceAll('-', '')
  const prefix = `DH${ymd}-`
  const codes = new Set(existing)
  let max = 0
  for (const code of codes) {
    if (!code.startsWith(prefix)) continue
    const n = Number(code.slice(prefix.length))
    if (Number.isInteger(n) && n > max) max = n
  }
  let seq = max + 1
  while (codes.has(prefix + String(seq).padStart(3, '0'))) seq++
  return prefix + String(seq).padStart(3, '0')
}

/** Giá trị trống cho các cột GHN của đơn chưa gửi giao hàng. */
export const EMPTY_GHN_FIELDS = {
  ghn_order_code: '',
  ghn_client_code: '',
  ghn_status: '',
  ghn_status_at: '',
  ghn_fee: 0,
  ghn_cod_amount: 0,
  ghn_expected_delivery: '',
  ghn_to_address: '',
  ghn_draft: '',
} satisfies Partial<Order>

/** Mã link tra cứu: 128 bit ngẫu nhiên, base64url 22 ký tự — không đoán được. */
const PUBLIC_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/

/** 0912345678 → 091****678 */
export function maskPhone(phone: string): string {
  return phone.length >= 7 ? `${phone.slice(0, 3)}${'*'.repeat(phone.length - 6)}${phone.slice(-3)}` : '***'
}

export class OrderService {
  constructor(
    private store: DataStore,
    private sizes: string[],
    private clock: () => Date = () => new Date(),
    /** Dùng chung với ShippingService để mọi thao tác ghi chạy tuần tự. */
    private writeLock = new Mutex(),
  ) {}

  // ---------- Đọc ----------

  private buildViews(snap: Snapshot, orders: Order[]): OrderView[] {
    const customers = new Map(snap.customers.map((c) => [c.id, c]))
    const groups = new Map(snap.groups.map((g) => [g.id, g]))
    const history = historyByCustomer(snap.orders)
    const items = new Map<string, OrderItem[]>()
    for (const it of snap.items) {
      const list = items.get(it.order_id)
      if (list) list.push(it)
      else items.set(it.order_id, [it])
    }
    return orders
      .map((o) => ({
        ...o,
        customer: customers.get(o.customer_id) ?? missingCustomer(o.customer_id),
        items: items.get(o.id) ?? [],
        group_name: groups.get(o.group_id)?.name ?? '(Nhóm đã bị xóa)',
        customer_history: historyExcluding(history.get(o.customer_id), o.status),
      }))
      .sort(byNewest)
  }

  async listGroups(): Promise<GroupWithStats[]> {
    const snap = await this.store.snapshot()
    const views = this.buildViews(snap, snap.orders)
    return [...snap.groups]
      .sort((a, b) => (a.status === b.status ? byNewest(a, b) : a.status === 'open' ? -1 : 1))
      .map((g) => ({
        ...g,
        stats: computeGroupStats(
          views.filter((o) => o.group_id === g.id),
          {},
          this.sizes,
        ),
      }))
  }

  async getGroup(id: string): Promise<GroupDetail> {
    const snap = await this.store.snapshot()
    const group = snap.groups.find((g) => g.id === id)
    if (!group) throw notFound('nhóm đơn hàng')
    const costs = snap.costs
      .filter((c) => c.group_id === id)
      .sort((a, b) =>
        a.category === b.category
          ? a.created_at.localeCompare(b.created_at)
          : COST_CATEGORIES.indexOf(a.category) - COST_CATEGORIES.indexOf(b.category),
      )
    return { group, orders: this.buildViews(snap, snap.orders.filter((o) => o.group_id === id)), costs }
  }

  async listOrders(): Promise<OrderView[]> {
    const snap = await this.store.snapshot()
    return this.buildViews(snap, snap.orders)
  }

  async getOrder(id: string): Promise<OrderView> {
    const snap = await this.store.snapshot()
    const order = snap.orders.find((o) => o.id === id)
    if (!order) throw notFound('đơn hàng')
    return this.buildViews(snap, [order])[0]
  }

  async listCustomers(): Promise<CustomerSummary[]> {
    const snap = await this.store.snapshot()
    const history = historyByCustomer(snap.orders)
    const stats = new Map<string, { count: number; last: string }>()
    for (const o of snap.orders) {
      const s = stats.get(o.customer_id) ?? { count: 0, last: '' }
      s.count++
      if (o.created_at > s.last) s.last = o.created_at
      stats.set(o.customer_id, s)
    }
    return snap.customers
      .map((c) => ({
        ...c,
        history: history.get(c.id) ?? emptyHistory(),
        order_count: stats.get(c.id)?.count ?? 0,
        last_order_at: stats.get(c.id)?.last || null,
      }))
      .sort((a, b) => (b.last_order_at ?? b.created_at).localeCompare(a.last_order_at ?? a.created_at))
  }

  async getCustomer(id: string): Promise<CustomerDetail> {
    const snap = await this.store.snapshot()
    const customer = snap.customers.find((c) => c.id === id)
    if (!customer) throw notFound('khách hàng')
    return { customer, orders: this.buildViews(snap, snap.orders.filter((o) => o.customer_id === id)) }
  }

  async findCustomerByPhone(phone: string): Promise<CustomerLookup | null> {
    const key = normalizePhone(phone)
    const snap = await this.store.snapshot()
    const customer = snap.customers.find((c) => c.phone === key)
    if (!customer) return null
    const history = historyByCustomer(snap.orders.filter((o) => o.customer_id === customer.id)).get(customer.id)
    return { ...customer, history: history ?? emptyHistory() }
  }

  /**
   * Trang tra cứu cho khách (không cần đăng nhập): trạng thái, sản phẩm, tiền, vận đơn và địa chỉ giao hàng;
   * SĐT che bớt. Ai có link đều xem được địa chỉ — "Đổi link" để vô hiệu link đã lộ.
   */
  async getPublicOrder(token: string): Promise<PublicOrderView> {
    if (!PUBLIC_TOKEN_RE.test(token)) throw notFound('đơn hàng')
    const snap = await this.store.snapshot()
    const order = snap.orders.find((o) => o.public_token === token)
    if (!order) throw notFound('đơn hàng')
    const customer = snap.customers.find((c) => c.id === order.customer_id)
    const shipped = isActiveShipment(order)
    const amount_due = !OPEN_ORDER_STATUSES.includes(order.status) ? 0 : shipped ? order.ghn_cod_amount : amountDue(order)
    return {
      order_code: order.order_code,
      created_at: order.created_at,
      status: order.status,
      group_name: snap.groups.find((g) => g.id === order.group_id)?.name ?? '',
      customer_name: customer?.name ?? '',
      customer_phone_masked: customer ? maskPhone(customer.phone) : '',
      delivery_address: (shipped && order.ghn_to_address) || customer?.address || '',
      items: snap.items
        .filter((i) => i.order_id === order.id)
        .map(({ product_name, size, quantity, unit_price, line_total }) => ({ product_name, size, quantity, unit_price, line_total })),
      total_amount: order.total_amount,
      paid_amount: order.paid_amount,
      amount_due,
      shipment: shipped
        ? {
            code: order.ghn_order_code,
            status: order.ghn_status,
            expected_delivery: order.ghn_expected_delivery,
            tracking_url: ghnTrackingUrl(order.ghn_order_code),
          }
        : null,
    }
  }

  // ---------- Ghi (tuần tự, luôn đọc dữ liệu mới nhất trước khi ghi) ----------

  createGroup(input: GroupInput): Promise<OrderGroup> {
    return this.writeLock.run(async () => {
      const now = this.clock().toISOString()
      const group: OrderGroup = { id: randomUUID(), ...groupFields(input), created_at: now, updated_at: now }
      await this.store.insert('groups', [group])
      return group
    })
  }

  updateGroup(id: string, input: GroupInput): Promise<OrderGroup> {
    return this.writeLock.run(async () => {
      const snap = await this.store.snapshot(true)
      const current = snap.groups.find((g) => g.id === id)
      if (!current) throw notFound('nhóm đơn hàng')
      assertFresh(current.updated_at, input.expected_updated_at, 'Nhóm')
      const group: OrderGroup = { ...current, ...groupFields(input), updated_at: this.clock().toISOString() }
      await this.store.update('groups', group)
      return group
    })
  }

  // ---------- Chi phí của nhóm ----------

  createCost(groupId: string, input: GroupCostInput): Promise<GroupCost> {
    return this.writeLock.run(async () => {
      const snap = await this.store.snapshot(true)
      if (!snap.groups.some((g) => g.id === groupId)) throw notFound('nhóm đơn hàng')
      const now = this.clock().toISOString()
      const cost: GroupCost = { id: randomUUID(), group_id: groupId, ...costFields(input), created_at: now, updated_at: now }
      await this.store.insert('costs', [cost])
      return cost
    })
  }

  updateCost(groupId: string, costId: string, input: GroupCostInput): Promise<GroupCost> {
    return this.writeLock.run(async () => {
      const snap = await this.store.snapshot(true)
      const current = snap.costs.find((c) => c.id === costId && c.group_id === groupId)
      if (!current) throw notFound('khoản chi')
      assertFresh(current.updated_at, input.expected_updated_at, 'Khoản chi')
      const cost: GroupCost = { ...current, ...costFields(input), updated_at: this.clock().toISOString() }
      await this.store.update('costs', cost)
      return cost
    })
  }

  deleteCost(groupId: string, costId: string, expectedUpdatedAt?: string): Promise<void> {
    return this.writeLock.run(async () => {
      const snap = await this.store.snapshot(true)
      const current = snap.costs.find((c) => c.id === costId && c.group_id === groupId)
      if (!current) throw notFound('khoản chi')
      assertFresh(current.updated_at, expectedUpdatedAt, 'Khoản chi')
      await this.store.remove('costs', [costId])
    })
  }

  createOrder(input: OrderInput): Promise<OrderView> {
    return this.writeLock.run(async () => {
      const snap = await this.store.snapshot(true)
      const group = snap.groups.find((g) => g.id === input.group_id)
      if (!group) throw notFound('nhóm đơn hàng')
      if (group.status === 'closed') throw new AppError(400, `Nhóm "${group.name}" đã đóng, không thể thêm đơn mới.`)

      const nowDate = this.clock()
      const now = nowDate.toISOString()
      const customer = await this.upsertCustomer(snap, input.customer, now)
      const id = randomUUID()
      const items = buildItems(input, id, group, now)
      const total = items.reduce((s, i) => s + i.line_total, 0)
      const order: Order = {
        id,
        order_code: nextOrderCode(
          snap.orders.map((o) => o.order_code),
          nowDate,
        ),
        group_id: group.id,
        customer_id: customer.id,
        items_summary: summarizeItems(items),
        total_amount: total,
        status: input.status,
        note: input.note.trim(),
        ...EMPTY_GHN_FIELDS,
        paid_amount: input.paid_amount ?? 0,
        public_token: '',
        created_at: now,
        updated_at: now,
      }
      // Ghi dòng sản phẩm trước: nếu ghi đơn lỗi thì chỉ còn dòng mồ côi (không hiện ở đâu), không có đơn thiếu sản phẩm.
      await this.store.insert('items', items)
      await this.store.insert('orders', [order])
      const customer_history = historyByCustomer(snap.orders).get(customer.id) ?? emptyHistory()
      return { ...order, customer, items, group_name: group.name, customer_history }
    })
  }

  updateOrder(id: string, input: OrderInput): Promise<OrderView> {
    return this.writeLock.run(async () => {
      const snap = await this.store.snapshot(true)
      const current = snap.orders.find((o) => o.id === id)
      if (!current) throw notFound('đơn hàng')
      assertFresh(current.updated_at, input.expected_updated_at, 'Đơn hàng')
      const group = snap.groups.find((g) => g.id === input.group_id)
      if (!group) throw notFound('nhóm đơn hàng')
      if (group.status === 'closed' && group.id !== current.group_id) {
        throw new AppError(400, `Nhóm "${group.name}" đã đóng, không thể chuyển đơn vào.`)
      }

      const items = buildItems(input, id, group, this.clock().toISOString())
      const total = items.reduce((s, i) => s + i.line_total, 0)
      // Giao diện bản cũ (không có ô tiền cọc) không gửi paid_amount: giữ số cũ nhưng không vượt tổng mới,
      // vì người dùng bản đó không có cách nào sửa lại số tiền đã trả.
      const paid = input.paid_amount ?? Math.min(current.paid_amount, total)
      if (paid > total) throw new AppError(400, 'Số tiền khách đã trả lớn hơn tổng đơn mới. Sửa lại số tiền đã trả.')

      const now = this.clock().toISOString()
      const customer = await this.upsertCustomer(snap, input.customer, now)
      const order: Order = {
        ...current,
        group_id: group.id,
        customer_id: customer.id,
        items_summary: summarizeItems(items),
        total_amount: total,
        paid_amount: paid,
        status: input.status,
        note: input.note.trim(),
        updated_at: now,
      }
      // Thay toàn bộ dòng sản phẩm để không bao giờ cộng trùng số lượng cũ + mới.
      await this.store.remove(
        'items',
        snap.items.filter((i) => i.order_id === id).map((i) => i.id),
      )
      await this.store.insert('items', items)
      await this.store.update('orders', order)
      const others = snap.orders.filter((o) => o.id !== id)
      const customer_history = historyByCustomer(others).get(customer.id) ?? emptyHistory()
      return { ...order, customer, items, group_name: group.name, customer_history }
    })
  }

  updateOrderStatus(id: string, input: OrderStatusInput): Promise<Order> {
    return this.writeLock.run(async () => {
      const snap = await this.store.snapshot(true)
      const current = snap.orders.find((o) => o.id === id)
      if (!current) throw notFound('đơn hàng')
      assertFresh(current.updated_at, input.expected_updated_at, 'Đơn hàng')
      if (current.status === input.status) return current
      const order: Order = { ...current, status: input.status as OrderStatus, updated_at: this.clock().toISOString() }
      await this.store.update('orders', order)
      return order
    })
  }

  /**
   * Đổi trạng thái nhiều đơn trong một lần ghi. Đơn bị người khác sửa trong lúc đó
   * hoặc không còn tồn tại thì bỏ qua (báo lại), các đơn còn lại vẫn được đổi.
   */
  bulkUpdateStatus(input: BulkOrderStatusInput): Promise<BulkStatusResult> {
    return this.writeLock.run(async () => {
      const snap = await this.store.snapshot(true)
      const byId = new Map(snap.orders.map((o) => [o.id, o]))
      const now = this.clock().toISOString()
      const changed: Order[] = []
      const skipped: BulkStatusResult['skipped'] = []
      for (const { id, expected_updated_at } of input.orders) {
        const current = byId.get(id)
        if (!current) {
          skipped.push({ id, order_code: '', reason: 'Đơn không còn tồn tại' })
        } else if (expected_updated_at && expected_updated_at !== current.updated_at) {
          skipped.push({ id, order_code: current.order_code, reason: 'Vừa được người khác cập nhật' })
        } else if (current.status !== input.status && !changed.some((o) => o.id === id)) {
          changed.push({ ...current, status: input.status, updated_at: now })
        }
      }
      await this.store.updateMany('orders', changed)
      return { updated: changed.length, skipped }
    })
  }

  /**
   * Lấy (hoặc đổi) mã link tra cứu đơn cho khách. Không đổi updated_at: tạo link không phải sửa đơn,
   * người khác đang mở form sửa đơn không bị báo xung đột.
   */
  publicLink(id: string, regenerate: boolean): Promise<{ token: string }> {
    return this.writeLock.run(async () => {
      const snap = await this.store.snapshot(true)
      const current = snap.orders.find((o) => o.id === id)
      if (!current) throw notFound('đơn hàng')
      if (current.public_token && !regenerate) return { token: current.public_token }
      const token = randomBytes(16).toString('base64url')
      await this.store.update('orders', { ...current, public_token: token })
      return { token }
    })
  }

  deleteOrder(id: string, expectedUpdatedAt?: string): Promise<void> {
    return this.writeLock.run(async () => {
      const snap = await this.store.snapshot(true)
      const current = snap.orders.find((o) => o.id === id)
      if (!current) throw notFound('đơn hàng')
      assertFresh(current.updated_at, expectedUpdatedAt, 'Đơn hàng')
      await this.store.remove('orders', [id])
      await this.store.remove(
        'items',
        snap.items.filter((i) => i.order_id === id).map((i) => i.id),
      )
    })
  }

  /**
   * Xóa khách. Chỉ cho xóa khách chưa có đơn: xóa khách còn đơn sẽ để lại đơn không rõ khách
   * (kể cả đơn đã gửi GHN), nên bắt xóa các đơn đó trước.
   */
  deleteCustomer(id: string, expectedUpdatedAt?: string): Promise<void> {
    return this.writeLock.run(async () => {
      const snap = await this.store.snapshot(true)
      const current = snap.customers.find((c) => c.id === id)
      if (!current) throw notFound('khách hàng')
      assertFresh(current.updated_at, expectedUpdatedAt, 'Khách hàng')
      const orderCount = snap.orders.filter((o) => o.customer_id === id).length
      if (orderCount > 0) {
        throw new AppError(409, `Khách còn ${orderCount} đơn hàng. Xóa các đơn đó trước rồi mới xóa được khách.`)
      }
      await this.store.remove('customers', [id])
    })
  }

  /** Tìm khách theo SĐT đã chuẩn hóa; có thì cập nhật thông tin mới, chưa có thì tạo. */
  private async upsertCustomer(snap: Snapshot, input: CustomerInput, now: string): Promise<Customer> {
    const phone = normalizePhone(input.phone)
    const fields = {
      name: input.name.trim(),
      phone,
      facebook_url: normalizeUrl(input.facebook_url),
      address: input.address.trim(),
    }
    const existing = snap.customers.find((c) => c.phone === phone)
    if (!existing) {
      const customer: Customer = { id: randomUUID(), ...fields, ghn_address: '', created_at: now, updated_at: now }
      await this.store.insert('customers', [customer])
      snap.customers.push(customer)
      return customer
    }
    // Ô để trống không xóa thông tin cũ (người nhập có thể chưa bấm "dùng thông tin khách cũ").
    const merged: Customer = {
      ...existing,
      name: fields.name || existing.name,
      facebook_url: fields.facebook_url || existing.facebook_url,
      address: fields.address || existing.address,
    }
    if (
      merged.name === existing.name &&
      merged.facebook_url === existing.facebook_url &&
      merged.address === existing.address
    ) {
      return existing
    }
    merged.updated_at = now
    await this.store.update('customers', merged)
    return merged
  }
}

function assertFresh(actual: string, expected: string | undefined, what: string) {
  if (expected && expected !== actual) throw conflict(what)
}

function costFields(input: GroupCostInput) {
  return {
    category: input.category,
    name: input.name.trim(),
    quantity: input.quantity,
    unit: input.unit.trim(),
    unit_price: input.unit_price,
    basis: input.basis,
    note: input.note.trim(),
  }
}

function groupFields(input: GroupInput) {
  return {
    name: input.name.trim(),
    description: input.description.trim(),
    product_name: input.product_name.trim(),
    default_unit_price: input.default_unit_price,
    status: input.status,
  }
}

function buildItems(input: OrderInput, orderId: string, group: OrderGroup, now: string): OrderItem[] {
  return input.items.map((it) => ({
    id: randomUUID(),
    order_id: orderId,
    product_name: group.product_name || group.name,
    size: normalizeSize(it.size),
    quantity: it.quantity,
    unit_price: it.unit_price,
    line_total: it.quantity * it.unit_price,
    created_at: now,
  }))
}

function missingCustomer(id: string): Customer {
  return {
    id,
    name: '(Không rõ khách hàng)',
    phone: '',
    facebook_url: '',
    address: '',
    ghn_address: '',
    created_at: '',
    updated_at: '',
  }
}
