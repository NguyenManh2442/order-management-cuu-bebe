import { describe, expect, it } from 'vitest'
import { computeCosts, computeProfit } from './costs'
import { groupCostInputSchema } from './schemas'
import type { GroupCost } from './types'

const cost = (over: Partial<GroupCost>): GroupCost => ({
  id: Math.random().toString(),
  group_id: 'g',
  category: 'material',
  name: 'x',
  quantity: 1,
  unit: '',
  unit_price: 0,
  basis: 'fixed',
  note: '',
  created_at: '',
  updated_at: '',
  ...over,
})

describe('computeCosts', () => {
  it('cố định và theo mỗi sản phẩm', () => {
    const s = computeCosts(
      [
        cost({ quantity: 1.2, unit_price: 85_000, basis: 'per_item' }), // 1.2 m × 60 sp = 72 m
        cost({ category: 'labor', quantity: 1, unit_price: 60_000, basis: 'per_item' }),
        cost({ category: 'other', quantity: 1, unit_price: 300_000 }),
      ],
      60,
    )
    expect(s.lines[0]).toMatchObject({ effective_quantity: 72, amount: 6_120_000 })
    expect(s.by_category).toEqual({ material: 6_120_000, labor: 3_600_000, other: 300_000 })
    expect(s.total).toBe(10_020_000)
    expect(s.per_item).toBe(167_000)
  })

  it('chưa có sản phẩm: chi phí theo sản phẩm bằng 0, không chia cho 0', () => {
    const s = computeCosts([cost({ quantity: 2, unit_price: 100, basis: 'per_item' }), cost({ quantity: 3, unit_price: 10 })], 0)
    expect(s.total).toBe(30)
    expect(s.per_item).toBe(0)
  })

  it('số lẻ không sinh sai số dấu phẩy động', () => {
    expect(computeCosts([cost({ quantity: 0.1, basis: 'per_item', unit_price: 1000 })], 3).lines[0].effective_quantity).toBe(0.3)
  })
})

it('computeProfit bỏ đơn đã hủy và hoàn hàng', () => {
  const p = computeProfit(
    [
      { status: 'delivered', total_amount: 500 },
      { status: 'pending', total_amount: 300 },
      { status: 'cancelled', total_amount: 999 },
      { status: 'returned', total_amount: 999 },
    ],
    600,
  )
  expect(p).toEqual({ expected_revenue: 800, cost: 600, expected_profit: 200 })
})

it('validate số lượng tối đa 3 chữ số thập phân', () => {
  const base = { category: 'material', name: 'Vải', unit: 'mét', unit_price: 1, basis: 'fixed', note: '' } as const
  expect(groupCostInputSchema.safeParse({ ...base, quantity: 1.005 }).success).toBe(true)
  expect(groupCostInputSchema.safeParse({ ...base, quantity: 1.0005 }).success).toBe(false)
  expect(groupCostInputSchema.safeParse({ ...base, quantity: 0 }).success).toBe(false)
})
