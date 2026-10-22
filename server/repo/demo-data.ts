import type { OrderStatus } from '../../shared/constants'
import { summarizeItems } from '../../shared/stats'
import type { Customer, GroupCost, Order, OrderGroup, OrderItem } from '../../shared/types'
import { EMPTY_GHN_FIELDS } from '../service'
import type { Snapshot } from './types'

/**
 * Dữ liệu mẫu CHỈ dùng cho DATA_SOURCE=demo (lưu trong bộ nhớ, mất khi tắt server).
 * Tên và số điện thoại là giả.
 */
export function createDemoSnapshot(sizes: string[]): Snapshot {
  let seed = 20261221
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]
  const now = Date.now()
  const daysAgo = (d: number) => new Date(now - d * 86_400_000 - Math.floor(rand() * 36e5 * 8)).toISOString()
  let n = 0
  const id = (p: string) => `demo-${p}-${++n}`

  const names = [
    'Nguyễn Thị Lan', 'Trần Minh Anh', 'Lê Thu Hà', 'Phạm Ngọc Mai', 'Hoàng Thảo Vy', 'Vũ Thanh Hương',
    'Đặng Bảo Ngọc', 'Bùi Khánh Linh', 'Đỗ Mỹ Duyên', 'Ngô Phương Thảo', 'Dương Hải Yến', 'Lý Quỳnh Như',
  ]
  const streets = ['Lê Lợi', 'Trần Hưng Đạo', 'Nguyễn Trãi', 'Hai Bà Trưng', 'Phan Đình Phùng', 'Lý Thường Kiệt']
  const cities = ['Q.1, TP.HCM', 'Q. Cầu Giấy, Hà Nội', 'TP. Đà Nẵng', 'TP. Cần Thơ', 'TP. Huế']

  const customers: Customer[] = names.map((name, i) => {
    const t = daysAgo(60 - i)
    return {
      id: id('c'),
      name,
      phone: `09${String(10000000 + i * 7654321).slice(0, 8)}`,
      facebook_url: i % 3 === 2 ? '' : `https://facebook.com/demo.khach.${i + 1}`,
      address: i % 4 === 3 ? '' : `${12 + i * 3} ${pick(streets)}, ${pick(cities)}`,
      ghn_address: '',
      created_at: t,
      updated_at: t,
    }
  })

  const groupSeeds: Array<Pick<OrderGroup, 'name' | 'description' | 'product_name' | 'default_unit_price' | 'status'> & { age: number; orders: number }> = [
    { name: 'Mẫu váy Noel', description: 'Váy nhung đỏ, chốt đơn trước 15/12', product_name: 'Váy nhung Noel', default_unit_price: 350000, status: 'open', age: 20, orders: 14 },
    { name: 'Áo dài Tết 2027', description: 'Áo dài cách tân, giao trước 20 tháng Chạp', product_name: 'Áo dài cách tân', default_unit_price: 680000, status: 'open', age: 8, orders: 9 },
    { name: 'Áo thun đợt 1', description: 'Đợt bán đầu tiên', product_name: 'Áo thun cotton', default_unit_price: 150000, status: 'closed', age: 55, orders: 11 },
  ]
  const statusPool: OrderStatus[] = ['pending', 'pending', 'confirmed', 'packing', 'shipping', 'delivered', 'delivered', 'delivered', 'cancelled', 'returned']
  const sizePool = [...sizes, sizes[1] ?? 'M', sizes[1] ?? 'M', sizes[2] ?? 'L', 'XXL']

  const groups: OrderGroup[] = []
  const orders: Order[] = []
  const items: OrderItem[] = []
  let seq = 0

  for (const g of groupSeeds) {
    const created = daysAgo(g.age)
    const group: OrderGroup = { id: id('g'), ...g, created_at: created, updated_at: created }
    delete (group as Partial<typeof g>).age
    delete (group as Partial<typeof g>).orders
    groups.push(group)

    for (let k = 0; k < g.orders; k++) {
      const customer = pick(customers)
      const orderId = id('o')
      const t = daysAgo(Math.max(0, g.age - 1 - Math.floor(rand() * g.age)))
      const lines = rand() < 0.2 ? 2 : 1
      const its: OrderItem[] = []
      for (let l = 0; l < lines; l++) {
        const quantity = rand() < 0.75 ? 1 : 2
        its.push({
          id: id('i'),
          order_id: orderId,
          product_name: g.product_name,
          size: pick(sizePool),
          quantity,
          unit_price: g.default_unit_price,
          line_total: quantity * g.default_unit_price,
          created_at: t,
        })
      }
      items.push(...its)
      const status = g.status === 'closed' ? pick(['delivered', 'delivered', 'delivered', 'returned', 'cancelled'] as const) : pick(statusPool)
      const note = rand() < 0.25 ? pick(['Giao giờ hành chính', 'Gọi trước khi giao', 'Khách cọc 100k', 'Gói quà giúp shop']) : ''
      const total = its.reduce((s, i) => s + i.line_total, 0)
      orders.push({
        id: orderId,
        order_code: `DEMO-${String(++seq).padStart(3, '0')}`,
        group_id: group.id,
        customer_id: customer.id,
        items_summary: summarizeItems(its),
        total_amount: total,
        status,
        note,
        ...EMPTY_GHN_FIELDS,
        // Một số đơn đã cọc / chuyển khoản trước để thử phần "còn phải thu".
        paid_amount: note === 'Khách cọc 100k' ? Math.min(100_000, total) : rand() < 0.15 ? total : 0,
        public_token: '',
        created_at: t,
        updated_at: t,
      })
    }
  }
  // Chi phí mẫu theo từng nhóm: [loại, tên, số lượng, đơn vị, đơn giá, cách tính]
  const costSeeds: [GroupCost['category'], string, number, string, number, GroupCost['basis']][][] = [
    [
      ['material', 'Vải nhung đỏ', 1.2, 'mét', 85_000, 'per_item'],
      ['material', 'Khóa kéo + chỉ', 1, 'bộ', 6_000, 'per_item'],
      ['labor', 'Công may', 1, 'chiếc', 60_000, 'per_item'],
      ['other', 'Túi đóng gói, tem nhãn', 1, 'lô', 300_000, 'fixed'],
    ],
    [
      ['material', 'Vải lụa', 2.5, 'mét', 120_000, 'per_item'],
      ['labor', 'Công may áo dài', 1, 'chiếc', 150_000, 'per_item'],
    ],
    [
      ['material', 'Phôi áo thun', 1, 'cái', 45_000, 'per_item'],
      ['labor', 'Công in', 1, 'cái', 15_000, 'per_item'],
      ['other', 'Làm khuôn in', 1, 'lần', 500_000, 'fixed'],
    ],
  ]
  const costs: GroupCost[] = groups.flatMap((g, i) =>
    (costSeeds[i] ?? []).map(([category, name, quantity, unit, unit_price, basis]) => ({
      id: id('k'),
      group_id: g.id,
      category,
      name,
      quantity,
      unit,
      unit_price,
      basis,
      note: '',
      created_at: g.created_at,
      updated_at: g.created_at,
    })),
  )
  return { customers, groups, orders, items, costs }
}
