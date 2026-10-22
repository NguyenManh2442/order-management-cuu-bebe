import { COST_CATEGORIES, type CostCategory } from './constants'
import type { GroupCost } from './types'

export interface CostLine extends GroupCost {
  /** Số lượng thực dùng để tính tiền (per_item = quantity × số sản phẩm). */
  effective_quantity: number
  amount: number
}

export interface CostSummary {
  lines: CostLine[]
  by_category: Record<CostCategory, number>
  total: number
  /** Chi phí bình quân mỗi sản phẩm, 0 nếu chưa có sản phẩm. */
  per_item: number
}

/** Làm tròn số lượng lẻ tới 3 chữ số để tránh 0.1 + 0.2 = 0.30000000000000004. */
const round3 = (n: number) => Math.round(n * 1000) / 1000

/** Tính chi phí từ các dòng đã nhập và số sản phẩm đặt hiện tại (không tính đơn đã hủy). */
export function computeCosts(costs: GroupCost[], itemCount: number): CostSummary {
  const by_category = Object.fromEntries(COST_CATEGORIES.map((c) => [c, 0])) as Record<CostCategory, number>
  const lines = costs.map((c) => {
    const effective_quantity = round3(c.basis === 'per_item' ? c.quantity * itemCount : c.quantity)
    const amount = Math.round(effective_quantity * c.unit_price)
    by_category[c.category] += amount
    return { ...c, effective_quantity, amount }
  })
  const total = lines.reduce((s, l) => s + l.amount, 0)
  return { lines, by_category, total, per_item: itemCount > 0 ? Math.round(total / itemCount) : 0 }
}

export interface ProfitSummary {
  /** Tổng tiền các đơn chưa hủy, chưa hoàn (dự kiến thu được). */
  expected_revenue: number
  cost: number
  expected_profit: number
}

export function computeProfit(
  orders: { status: string; total_amount: number }[],
  cost: number,
): ProfitSummary {
  const expected_revenue = orders
    .filter((o) => o.status !== 'cancelled' && o.status !== 'returned')
    .reduce((s, o) => s + o.total_amount, 0)
  return { expected_revenue, cost, expected_profit: expected_revenue - cost }
}
