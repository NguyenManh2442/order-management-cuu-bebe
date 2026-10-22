import type { OrderStatus } from './constants'
import type { CustomerHistory } from './types'

export const emptyHistory = (): CustomerHistory => ({ order_count: 0, delivered: 0, returned: 0, cancelled: 0 })

export function addToHistory(h: CustomerHistory, status: OrderStatus): CustomerHistory {
  h.order_count++
  if (status === 'delivered') h.delivered++
  else if (status === 'returned') h.returned++
  else if (status === 'cancelled') h.cancelled++
  return h
}

/** Lịch sử theo từng khách: customer_id → số đơn theo kết quả. */
export function historyByCustomer(orders: { customer_id: string; status: OrderStatus }[]): Map<string, CustomerHistory> {
  const map = new Map<string, CustomerHistory>()
  for (const o of orders) {
    let h = map.get(o.customer_id)
    if (!h) map.set(o.customer_id, (h = emptyHistory()))
    addToHistory(h, o.status)
  }
  return map
}

/** Lịch sử của khách trừ chính đơn đang xem (để đơn bị hoàn không tự cảnh báo chính nó). */
export function historyExcluding(h: CustomerHistory | undefined, status: OrderStatus): CustomerHistory {
  const r = { ...(h ?? emptyHistory()) }
  if (r.order_count > 0) {
    r.order_count--
    if (status === 'delivered') r.delivered = Math.max(0, r.delivered - 1)
    else if (status === 'returned') r.returned = Math.max(0, r.returned - 1)
    else if (status === 'cancelled') r.cancelled = Math.max(0, r.cancelled - 1)
  }
  return r
}

export type RiskLevel = 'none' | 'warn' | 'high'

/**
 * Mức cảnh báo "bom hàng". Hoàn hàng (khách không nhận) nặng hơn hủy (có thể do shop hủy).
 * - high: hoàn ≥ 2 đơn, hoặc hoàn ≥ 30% số đơn
 * - warn: hoàn 1 đơn, hoặc hủy ≥ 2 đơn
 */
export function customerRisk(h: CustomerHistory): { level: RiskLevel; text: string } {
  const parts: string[] = []
  if (h.returned) parts.push(`hoàn ${h.returned}/${h.order_count} đơn`)
  if (h.cancelled) parts.push(`hủy ${h.cancelled}/${h.order_count} đơn`)
  const text = parts.length ? `Khách đã ${parts.join(', ')}` : ''
  if (h.returned >= 2 || (h.returned >= 1 && h.returned / h.order_count >= 0.3)) return { level: 'high', text }
  if (h.returned >= 1 || h.cancelled >= 2) return { level: 'warn', text }
  return { level: 'none', text }
}
