import { describe, expect, it } from 'vitest'
import type { OrderInput } from '../shared/schemas'
import { MemoryStore } from './repo/memory'
import { OrderService, nextOrderCode } from './service'

function setup() {
  let t = Date.parse('2026-12-01T03:00:00Z')
  const service = new OrderService(new MemoryStore(), ['S', 'M', 'L', 'XL'], () => new Date((t += 1000)))
  return service
}

const input = (groupId: string, over: Partial<OrderInput> = {}): OrderInput => ({
  group_id: groupId,
  customer: { name: 'Lan', phone: '0912 345 678', facebook_url: 'facebook.com/lan', address: 'HN' },
  items: [{ size: 'm', quantity: 2, unit_price: 100000 }],
  status: 'pending',
  note: '',
  ...over,
})

const groupInput = { name: 'Váy Noel', description: '', product_name: 'Váy', default_unit_price: 0, status: 'open' as const }

describe('nextOrderCode', () => {
  it('đánh số tiếp theo trong ngày giờ VN', () => {
    // 2026-12-01T20:00Z = 02/12 giờ VN
    const now = new Date('2026-12-01T20:00:00Z')
    expect(nextOrderCode([], now)).toBe('DH261202-001')
    expect(nextOrderCode(['DH261202-001', 'DH261202-007', 'DH261201-050'], now)).toBe('DH261202-008')
  })
})

describe('OrderService', () => {
  it('tạo đơn: chuẩn hóa dữ liệu, tính tiền, dùng lại khách theo SĐT', async () => {
    const s = setup()
    const g = await s.createGroup(groupInput)
    const o1 = await s.createOrder(input(g.id))
    expect(o1.total_amount).toBe(200000)
    expect(o1.customer.phone).toBe('0912345678')
    expect(o1.customer.facebook_url).toBe('https://facebook.com/lan')
    expect(o1.items[0].size).toBe('M')

    const o2 = await s.createOrder(input(g.id, { customer: { name: 'Lan', phone: '+84912345678', facebook_url: '', address: '' } }))
    expect(o2.customer.id).toBe(o1.customer.id)
    expect(o2.customer.address).toBe('HN') // ô trống không xóa thông tin cũ
    expect(o2.order_code).not.toBe(o1.order_code)
    expect((await s.listCustomers()).length).toBe(1)
  })

  it('sửa size/số lượng thì thống kê nhóm tính lại, không cộng trùng', async () => {
    const s = setup()
    const g = await s.createGroup(groupInput)
    const o = await s.createOrder(input(g.id))
    await s.updateOrder(o.id, input(g.id, { items: [{ size: 'L', quantity: 1, unit_price: 100000 }, { size: 'S', quantity: 3, unit_price: 90000 }], expected_updated_at: o.updated_at }))
    const [stats] = (await s.listGroups()).map((x) => x.stats)
    expect(stats.item_count).toBe(4)
    expect(stats.sizes.find((x) => x.size === 'M')?.quantity).toBe(0)
    expect(stats.sizes.find((x) => x.size === 'L')?.quantity).toBe(1)

    const updated = await s.getOrder(o.id)
    await s.updateOrderStatus(o.id, { status: 'cancelled', expected_updated_at: updated.updated_at })
    expect((await s.listGroups())[0].stats.item_count).toBe(0)
  })

  it('từ chối ghi đè khi dữ liệu đã bị người khác sửa', async () => {
    const s = setup()
    const g = await s.createGroup(groupInput)
    const o = await s.createOrder(input(g.id))
    await s.updateOrderStatus(o.id, { status: 'confirmed', expected_updated_at: o.updated_at })
    await expect(s.updateOrderStatus(o.id, { status: 'shipping', expected_updated_at: o.updated_at })).rejects.toMatchObject({ status: 409 })
  })

  it('không cho thêm đơn vào nhóm đã đóng', async () => {
    const s = setup()
    const g = await s.createGroup({ ...groupInput, status: 'closed' })
    await expect(s.createOrder(input(g.id))).rejects.toMatchObject({ status: 400 })
  })

  it('xóa đơn xóa luôn dòng sản phẩm', async () => {
    const s = setup()
    const g = await s.createGroup(groupInput)
    const o = await s.createOrder(input(g.id))
    await s.deleteOrder(o.id)
    expect((await s.getGroup(g.id)).orders).toEqual([])
    expect((await s.listGroups())[0].stats.item_count).toBe(0)
  })

  it('xóa khách: chỉ khi khách chưa có đơn', async () => {
    const s = setup()
    const g = await s.createGroup(groupInput)
    const o = await s.createOrder(input(g.id))
    await expect(s.deleteCustomer(o.customer.id)).rejects.toThrow(/còn 1 đơn/)
    await s.deleteOrder(o.id)
    await expect(s.deleteCustomer(o.customer.id, 'cũ')).rejects.toThrow(/người khác cập nhật/)
    await s.deleteCustomer(o.customer.id, o.customer.updated_at)
    expect(await s.listCustomers()).toEqual([])
    await expect(s.deleteCustomer(o.customer.id)).rejects.toThrow(/Không tìm thấy/)
  })
})
