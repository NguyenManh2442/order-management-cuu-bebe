import { randomUUID } from 'node:crypto'
import type { OrderStatus } from '../shared/constants'
import { normalizePhone, normalizeSize, normalizeUrl } from '../shared/phone'
import type { CustomerInput, GroupInput, OrderInput, OrderStatusInput } from '../shared/schemas'
import { computeGroupStats, summarizeItems } from '../shared/stats'
import type {
  Customer,
  CustomerDetail,
  CustomerSummary,
  GroupDetail,
  GroupWithStats,
  Order,
  OrderGroup,
  OrderItem,
  OrderView,
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
    return { group, orders: this.buildViews(snap, snap.orders.filter((o) => o.group_id === id)) }
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
    const stats = new Map<string, { count: number; last: string }>()
    for (const o of snap.orders) {
      const s = stats.get(o.customer_id) ?? { count: 0, last: '' }
      s.count++
      if (o.created_at > s.last) s.last = o.created_at
      stats.set(o.customer_id, s)
    }
    return snap.customers
      .map((c) => ({ ...c, order_count: stats.get(c.id)?.count ?? 0, last_order_at: stats.get(c.id)?.last || null }))
      .sort((a, b) => (b.last_order_at ?? b.created_at).localeCompare(a.last_order_at ?? a.created_at))
  }

  async getCustomer(id: string): Promise<CustomerDetail> {
    const snap = await this.store.snapshot()
    const customer = snap.customers.find((c) => c.id === id)
    if (!customer) throw notFound('khách hàng')
    return { customer, orders: this.buildViews(snap, snap.orders.filter((o) => o.customer_id === id)) }
  }

  async findCustomerByPhone(phone: string): Promise<Customer | null> {
    const key = normalizePhone(phone)
    const snap = await this.store.snapshot()
    return snap.customers.find((c) => c.phone === key) ?? null
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
      const order: Order = {
        id,
        order_code: nextOrderCode(
          snap.orders.map((o) => o.order_code),
          nowDate,
        ),
        group_id: group.id,
        customer_id: customer.id,
        items_summary: summarizeItems(items),
        total_amount: items.reduce((s, i) => s + i.line_total, 0),
        status: input.status,
        note: input.note.trim(),
        ...EMPTY_GHN_FIELDS,
        created_at: now,
        updated_at: now,
      }
      // Ghi dòng sản phẩm trước: nếu ghi đơn lỗi thì chỉ còn dòng mồ côi (không hiện ở đâu), không có đơn thiếu sản phẩm.
      await this.store.insert('items', items)
      await this.store.insert('orders', [order])
      return { ...order, customer, items, group_name: group.name }
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

      const now = this.clock().toISOString()
      const customer = await this.upsertCustomer(snap, input.customer, now)
      const items = buildItems(input, id, group, now)
      const order: Order = {
        ...current,
        group_id: group.id,
        customer_id: customer.id,
        items_summary: summarizeItems(items),
        total_amount: items.reduce((s, i) => s + i.line_total, 0),
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
      return { ...order, customer, items, group_name: group.name }
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
