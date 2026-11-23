import type { Expense, Order } from './types'

/**
 * Ghi / xóa mốc "đã giao" khi trạng thái đơn đổi:
 * chuyển sang "Đã giao" thì ghi thời điểm `at`, rời "Đã giao" (hoàn, hủy, sửa nhầm) thì xóa,
 * vẫn "Đã giao" thì giữ nguyên mốc cũ.
 */
export function withDeliveredAt<T extends Pick<Order, 'status' | 'delivered_at'>>(prev: Pick<Order, 'status'>, next: T, at: string): T {
  if (next.status !== 'delivered') return next.delivered_at ? { ...next, delivered_at: '' } : next
  if (prev.status === 'delivered' && next.delivered_at) return next
  return { ...next, delivered_at: at }
}

/**
 * Mốc tính doanh thu của đơn đã giao. Đơn giao trước khi app có cột delivered_at:
 * lấy thời điểm GHN báo giao, không có thì lấy lần cập nhật cuối.
 */
export function revenueDate(o: Pick<Order, 'delivered_at' | 'ghn_status' | 'ghn_status_at' | 'updated_at'>): string {
  return o.delivered_at || (o.ghn_status === 'delivered' && o.ghn_status_at) || o.updated_at
}

/** Giờ Việt Nam (UTC+7, không đổi giờ mùa hè) — để đơn giao lúc 23h ngày 31 không bị tính sang tháng sau. */
const VN_OFFSET_MS = 7 * 3600 * 1000

/** "2026-11" theo giờ Việt Nam; '' nếu thời điểm không hợp lệ. */
export function monthKey(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t + VN_OFFSET_MS).toISOString().slice(0, 7) : ''
}

export interface FinanceRow {
  /** "2026-11" (theo tháng) hoặc "2026" (theo năm). */
  period: string
  /** Tổng tiền các đơn đã giao trong kỳ. */
  revenue: number
  delivered_count: number
  /** Tổng chi phí ngoài trong kỳ. */
  expenses: number
  /** revenue − expenses. */
  net: number
}

function emptyRow(period: string): FinanceRow {
  return { period, revenue: 0, delivered_count: 0, expenses: 0, net: 0 }
}

/**
 * Doanh thu (đơn đã giao, theo tháng giao) và chi phí ngoài (theo ngày chi), gộp theo kỳ.
 * by = 'month': đủ 12 tháng của `year`. by = 'year': mọi năm có số liệu, mới nhất trước.
 */
export function computeFinance(
  orders: Pick<Order, 'status' | 'total_amount' | 'delivered_at' | 'ghn_status' | 'ghn_status_at' | 'updated_at'>[],
  expenses: Pick<Expense, 'date' | 'amount'>[],
  by: 'month' | 'year',
  year?: number,
): FinanceRow[] {
  const rows = new Map<string, FinanceRow>()
  const periodOf = (month: string) => (by === 'year' ? month.slice(0, 4) : month)
  const inScope = (month: string) => by === 'year' || month.startsWith(`${year}-`)
  const row = (period: string) => {
    let r = rows.get(period)
    if (!r) rows.set(period, (r = emptyRow(period)))
    return r
  }

  for (const o of orders) {
    if (o.status !== 'delivered') continue
    const month = monthKey(revenueDate(o))
    if (!month || !inScope(month)) continue
    const r = row(periodOf(month))
    r.revenue += o.total_amount
    r.delivered_count++
  }
  for (const e of expenses) {
    const month = e.date.slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(month) || !inScope(month)) continue
    row(periodOf(month)).expenses += e.amount
  }

  if (by === 'month') {
    for (let m = 1; m <= 12; m++) row(`${year}-${String(m).padStart(2, '0')}`)
  }
  return [...rows.values()]
    .map((r) => ({ ...r, net: r.revenue - r.expenses }))
    .sort((a, b) => (by === 'month' ? a.period.localeCompare(b.period) : b.period.localeCompare(a.period)))
}
