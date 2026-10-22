import { ORDER_STATUSES, type OrderStatus } from './constants'
import { normalizeSize } from './phone'
import type { GroupStats, Order, OrderItem, SizeStat } from './types'

type StatOrder = Pick<Order, 'id' | 'customer_id' | 'status' | 'total_amount'> & {
  items: Pick<OrderItem, 'size' | 'quantity'>[]
}

export interface StatsScope {
  /** Chỉ thống kê một trạng thái. Bỏ trống = mọi trạng thái (trừ đã hủy, xem includeCancelled). */
  status?: OrderStatus | ''
  /** Khi không lọc trạng thái: có tính cả đơn đã hủy không (mặc định không). */
  includeCancelled?: boolean
}

export function inStatsScope(status: OrderStatus, scope: StatsScope = {}): boolean {
  if (scope.status) return status === scope.status
  return scope.includeCancelled || status !== 'cancelled'
}

/** Sắp size theo danh sách cấu hình trước (S, M, L, XL...), size lạ xếp sau theo ABC. */
export function sortSizes(sizes: Iterable<string>, preferred: string[]): string[] {
  const rank = new Map(preferred.map((s, i) => [normalizeSize(s), i]))
  return [...new Set(sizes)].sort((a, b) => {
    const ra = rank.get(a) ?? Number.MAX_SAFE_INTEGER
    const rb = rank.get(b) ?? Number.MAX_SAFE_INTEGER
    return ra !== rb ? ra - rb : a.localeCompare(b, 'vi')
  })
}

/**
 * Tính thống kê từ danh sách đơn thực tế — không lưu số tổng cố định.
 * Đơn trùng id chỉ được tính một lần.
 */
export function computeGroupStats(
  orders: StatOrder[],
  scope: StatsScope = {},
  preferredSizes: string[] = [],
): GroupStats {
  const seen = new Set<string>()
  const customers = new Set<string>()
  const bySize = new Map<string, number>()
  let orderCount = 0
  let totalAmount = 0
  let revenue = 0

  for (const o of orders) {
    if (seen.has(o.id) || !inStatsScope(o.status, scope)) continue
    seen.add(o.id)
    orderCount++
    customers.add(o.customer_id)
    totalAmount += o.total_amount
    if (o.status === 'delivered') revenue += o.total_amount
    for (const it of o.items) {
      const size = normalizeSize(it.size)
      bySize.set(size, (bySize.get(size) ?? 0) + it.quantity)
    }
  }

  // Luôn hiện các size cấu hình (kể cả 0) để bảng size ổn định giữa các nhóm.
  for (const s of preferredSizes) {
    const n = normalizeSize(s)
    if (!bySize.has(n)) bySize.set(n, 0)
  }
  const sizes: SizeStat[] = sortSizes(bySize.keys(), preferredSizes).map((size) => ({
    size,
    quantity: bySize.get(size)!,
  }))

  return {
    order_count: orderCount,
    customer_count: customers.size,
    item_count: sizes.reduce((sum, s) => sum + s.quantity, 0),
    sizes,
    total_amount: totalAmount,
    revenue,
  }
}

export interface DashboardStats {
  total: number
  by_status: Record<OrderStatus, number>
  /** Doanh thu từ đơn đã giao. */
  revenue: number
  /** Tiền còn phải thu của các đơn đang xử lý (chưa giao, chưa hủy/hoàn). */
  outstanding: number
}

/** Đơn còn đang xử lý: tiền chưa về tay shop. */
export const OPEN_ORDER_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'packing', 'shipping']

/** Số tiền khách còn phải trả. Dữ liệu cũ chưa có cột paid_amount được coi là 0. */
export function amountDue(o: Pick<Order, 'total_amount'> & { paid_amount?: number }): number {
  // Số âm do sửa tay trên Sheets coi như chưa trả.
  return Math.max(0, o.total_amount - Math.max(0, o.paid_amount || 0))
}

/** Còn phải thu theo trạng thái: đơn đã giao / hủy / hoàn không còn gì để thu. */
export function amountDueNow(o: Pick<Order, 'total_amount' | 'status'> & { paid_amount?: number }): number {
  return OPEN_ORDER_STATUSES.includes(o.status) ? amountDue(o) : 0
}

export function computeDashboardStats(
  orders: (Pick<Order, 'id' | 'status' | 'total_amount'> & { paid_amount?: number })[],
): DashboardStats {
  const by_status = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>
  const seen = new Set<string>()
  let revenue = 0
  let outstanding = 0
  for (const o of orders) {
    if (seen.has(o.id)) continue
    seen.add(o.id)
    by_status[o.status]++
    if (o.status === 'delivered') revenue += o.total_amount
    if (OPEN_ORDER_STATUSES.includes(o.status)) outstanding += amountDue(o)
  }
  return { total: seen.size, by_status, revenue, outstanding }
}

/** "M x2, L x1" */
export function summarizeItems(items: Pick<OrderItem, 'size' | 'quantity'>[]): string {
  return items.map((i) => `${i.size} x${i.quantity}`).join(', ')
}
