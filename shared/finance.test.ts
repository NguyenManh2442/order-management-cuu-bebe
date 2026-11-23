import { describe, expect, it } from 'vitest'
import type { OrderStatus } from './constants'
import { computeFinance, monthKey, revenueDate, withDeliveredAt } from './finance'

const order = (over: Partial<Parameters<typeof revenueDate>[0]> & { status?: OrderStatus; total_amount?: number } = {}) => ({
  status: 'delivered' as OrderStatus,
  total_amount: 100000,
  delivered_at: '',
  ghn_status: '',
  ghn_status_at: '',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...over,
})

describe('withDeliveredAt', () => {
  it('chuyển sang Đã giao thì ghi mốc, rời Đã giao thì xóa, vẫn Đã giao thì giữ', () => {
    expect(withDeliveredAt({ status: 'shipping' }, { status: 'delivered', delivered_at: '' }, 'T1').delivered_at).toBe('T1')
    expect(withDeliveredAt({ status: 'delivered' }, { status: 'delivered', delivered_at: 'T0' }, 'T1').delivered_at).toBe('T0')
    expect(withDeliveredAt({ status: 'delivered' }, { status: 'returned', delivered_at: 'T0' }, 'T1').delivered_at).toBe('')
  })
})

describe('monthKey / revenueDate', () => {
  it('theo giờ Việt Nam: 23h ngày 31/10 (UTC 16h) vẫn là tháng 10, 0h ngày 1/11 là tháng 11', () => {
    expect(monthKey('2026-10-31T16:00:00.000Z')).toBe('2026-10')
    expect(monthKey('2026-10-31T17:00:00.000Z')).toBe('2026-11')
    expect(monthKey('rác')).toBe('')
  })

  it('đơn cũ chưa có delivered_at: lấy mốc GHN báo giao, không có thì lần cập nhật cuối', () => {
    expect(revenueDate(order({ delivered_at: 'A', ghn_status: 'delivered', ghn_status_at: 'B' }))).toBe('A')
    expect(revenueDate(order({ ghn_status: 'delivered', ghn_status_at: 'B' }))).toBe('B')
    expect(revenueDate(order({ ghn_status: 'delivering', ghn_status_at: 'B', updated_at: 'C' }))).toBe('C')
  })
})

describe('computeFinance', () => {
  const orders = [
    order({ delivered_at: '2026-03-10T03:00:00.000Z', total_amount: 300000 }),
    order({ delivered_at: '2026-03-20T03:00:00.000Z', total_amount: 200000 }),
    order({ delivered_at: '2026-05-01T03:00:00.000Z', total_amount: 150000 }),
    order({ delivered_at: '2025-12-01T03:00:00.000Z', total_amount: 999000 }),
    order({ status: 'returned', delivered_at: '', updated_at: '2026-03-15T03:00:00.000Z', total_amount: 500000 }),
  ]
  const expenses = [
    { date: '2026-03-02', amount: 120000 },
    { date: '2026-07-09', amount: 80000 },
    { date: '2025-12-30', amount: 1000 },
  ]

  it('theo tháng: đủ 12 tháng, chỉ đơn đã giao, trừ chi phí ngoài', () => {
    const rows = computeFinance(orders, expenses, 'month', 2026)
    expect(rows).toHaveLength(12)
    expect(rows[2]).toEqual({ period: '2026-03', revenue: 500000, delivered_count: 2, expenses: 120000, net: 380000 })
    expect(rows[4]).toMatchObject({ period: '2026-05', revenue: 150000, net: 150000 })
    expect(rows[6]).toMatchObject({ period: '2026-07', revenue: 0, expenses: 80000, net: -80000 })
    expect(rows[0]).toMatchObject({ period: '2026-01', revenue: 0, expenses: 0 })
  })

  it('theo năm: mỗi năm một dòng, năm mới nhất trước', () => {
    expect(computeFinance(orders, expenses, 'year')).toEqual([
      { period: '2026', revenue: 650000, delivered_count: 3, expenses: 200000, net: 450000 },
      { period: '2025', revenue: 999000, delivered_count: 1, expenses: 1000, net: 998000 },
    ])
  })
})
