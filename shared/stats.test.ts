import { describe, expect, it } from 'vitest'
import { computeDashboardStats, computeGroupStats, sortSizes } from './stats'

const order = (id: string, customer: string, status: any, items: [string, number][], total = 100) => ({
  id,
  customer_id: customer,
  status,
  total_amount: total,
  items: items.map(([size, quantity]) => ({ size, quantity })),
})

describe('computeGroupStats', () => {
  const orders = [
    order('1', 'a', 'pending', [['S', 2], ['m', 1]]),
    order('2', 'a', 'delivered', [['M', 3]], 300),
    order('3', 'b', 'cancelled', [['L', 5]]),
    order('4', 'c', 'shipping', [['XXL', 1]]),
  ]

  it('mặc định bỏ đơn đã hủy, gộp size không phân biệt hoa thường', () => {
    const s = computeGroupStats(orders, {}, ['S', 'M', 'L', 'XL'])
    expect(s.order_count).toBe(3)
    expect(s.customer_count).toBe(2)
    expect(s.item_count).toBe(7)
    expect(s.sizes).toEqual([
      { size: 'S', quantity: 2 },
      { size: 'M', quantity: 4 },
      { size: 'L', quantity: 0 },
      { size: 'XL', quantity: 0 },
      { size: 'XXL', quantity: 1 },
    ])
    expect(s.revenue).toBe(300)
  })

  it('cho phép tính cả đơn đã hủy để đối soát', () => {
    const s = computeGroupStats(orders, { includeCancelled: true }, ['S', 'M', 'L', 'XL'])
    expect(s.order_count).toBe(4)
    expect(s.item_count).toBe(12)
  })

  it('lọc theo một trạng thái', () => {
    const s = computeGroupStats(orders, { status: 'cancelled' })
    expect(s.order_count).toBe(1)
    expect(s.sizes).toEqual([{ size: 'L', quantity: 5 }])
  })

  it('không cộng trùng đơn lặp id', () => {
    const s = computeGroupStats([...orders, orders[0]], {})
    expect(s.order_count).toBe(3)
    expect(s.item_count).toBe(7)
  })
})

describe('computeDashboardStats', () => {
  it('đếm theo trạng thái và doanh thu đơn đã giao', () => {
    const s = computeDashboardStats([
      { id: '1', status: 'delivered', total_amount: 200 },
      { id: '2', status: 'pending', total_amount: 50 },
      { id: '3', status: 'cancelled', total_amount: 70 },
    ])
    expect(s.total).toBe(3)
    expect(s.by_status.pending).toBe(1)
    expect(s.revenue).toBe(200)
  })
})

it('sortSizes ưu tiên thứ tự cấu hình', () => {
  expect(sortSizes(['XL', 'FREE', 'S', 'M'], ['S', 'M', 'L', 'XL'])).toEqual(['S', 'M', 'XL', 'FREE'])
})
