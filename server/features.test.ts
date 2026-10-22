import { describe, expect, it } from 'vitest'
import { customerRisk } from '../shared/customer-history'
import { orderInputSchema, type OrderInput } from '../shared/schemas'
import { codMismatch } from '../shared/ghn'
import { amountDue, amountDueNow, computeDashboardStats } from '../shared/stats'
import { MemoryStore } from './repo/memory'
import { OrderService, maskPhone } from './service'

function setup() {
  let t = Date.parse('2026-12-01T03:00:00Z')
  return new OrderService(new MemoryStore(), ['S', 'M', 'L', 'XL'], () => new Date((t += 1000)))
}

const input = (groupId: string, over: Partial<OrderInput> = {}): OrderInput => ({
  group_id: groupId,
  customer: { name: 'Lan', phone: '0912345678', facebook_url: '', address: 'HN' },
  items: [{ size: 'M', quantity: 2, unit_price: 100000 }],
  status: 'pending',
  note: '',
  ...over,
})
const groupInput = { name: 'Váy Noel', description: '', product_name: 'Váy', default_unit_price: 0, status: 'open' as const }

describe('Tiền cọc / đã thanh toán', () => {
  it('lưu số tiền đã trả và tính còn phải thu', async () => {
    const s = setup()
    const g = await s.createGroup(groupInput)
    const o = await s.createOrder(input(g.id, { paid_amount: 50000 }))
    expect(o.paid_amount).toBe(50000)
    expect(computeDashboardStats([o]).outstanding).toBe(150000)
  })

  it('client bản cũ không gửi paid_amount: giữ nguyên số đã cọc', async () => {
    const s = setup()
    const g = await s.createGroup(groupInput)
    const o = await s.createOrder(input(g.id, { paid_amount: 50000 }))
    const updated = await s.updateOrder(o.id, input(g.id, { note: 'sửa', expected_updated_at: o.updated_at }))
    expect(updated.paid_amount).toBe(50000)
  })

  it('từ chối số tiền đã trả lớn hơn tổng đơn', async () => {
    expect(orderInputSchema.safeParse(input('g', { paid_amount: 300000 })).success).toBe(false)
    const s = setup()
    const g = await s.createGroup(groupInput)
    const o = await s.createOrder(input(g.id, { paid_amount: 200000 }))
    // Client gửi số đã trả lớn hơn tổng mới → báo lỗi, không lưu sai.
    await expect(
      s.updateOrder(
        o.id,
        input(g.id, { items: [{ size: 'M', quantity: 1, unit_price: 100000 }], paid_amount: 200000, expected_updated_at: o.updated_at }),
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('đơn đã giao / hủy không tính vào còn phải thu', () => {
    const base = { total_amount: 100, paid_amount: 0 }
    const stats = computeDashboardStats([
      { id: '1', status: 'delivered', ...base },
      { id: '2', status: 'cancelled', ...base },
      { id: '3', status: 'shipping', ...base },
    ])
    expect(stats.outstanding).toBe(100)
  })
})

describe('Cảnh báo khách hay hoàn/hủy', () => {
  it('đếm lịch sử, không tính chính đơn đang xem', async () => {
    const s = setup()
    const g = await s.createGroup(groupInput)
    const a = await s.createOrder(input(g.id))
    await s.updateOrderStatus(a.id, { status: 'returned' })
    const b = await s.createOrder(input(g.id))
    expect(b.customer_history).toMatchObject({ order_count: 1, returned: 1 })

    const viewA = await s.getOrder(a.id)
    expect(viewA.customer_history).toMatchObject({ order_count: 1, returned: 0 })

    const lookup = await s.findCustomerByPhone('+84912345678')
    expect(lookup?.history).toMatchObject({ order_count: 2, returned: 1 })
  })

  it('mức cảnh báo', () => {
    expect(customerRisk({ order_count: 5, delivered: 5, returned: 0, cancelled: 0 }).level).toBe('none')
    expect(customerRisk({ order_count: 5, delivered: 4, returned: 1, cancelled: 0 }).level).toBe('warn')
    expect(customerRisk({ order_count: 3, delivered: 2, returned: 1, cancelled: 0 }).level).toBe('high')
    expect(customerRisk({ order_count: 9, delivered: 7, returned: 2, cancelled: 0 }).text).toBe('Khách đã hoàn 2/9 đơn')
    expect(customerRisk({ order_count: 4, delivered: 2, returned: 0, cancelled: 2 }).level).toBe('warn')
  })
})

describe('Đổi trạng thái hàng loạt', () => {
  it('đổi các đơn hợp lệ, bỏ qua đơn bị sửa trước và đơn không tồn tại', async () => {
    const s = setup()
    const g = await s.createGroup(groupInput)
    const a = await s.createOrder(input(g.id))
    const b = await s.createOrder(input(g.id))
    const c = await s.createOrder(input(g.id))
    await s.updateOrderStatus(b.id, { status: 'confirmed' }) // b bị sửa sau khi client đọc
    const res = await s.bulkUpdateStatus({
      status: 'packing',
      orders: [
        { id: a.id, expected_updated_at: a.updated_at },
        { id: b.id, expected_updated_at: b.updated_at },
        { id: c.id, expected_updated_at: c.updated_at },
        { id: 'khong-co' },
      ],
    })
    expect(res.updated).toBe(2)
    expect(res.skipped.map((x) => x.order_code)).toEqual([b.order_code, ''])
    expect((await s.getOrder(a.id)).status).toBe('packing')
    expect((await s.getOrder(b.id)).status).toBe('confirmed')
  })
})

describe('Link tra cứu cho khách', () => {
  it('tạo link, giữ nguyên khi lấy lại, đổi được link mới', async () => {
    const s = setup()
    const g = await s.createGroup(groupInput)
    const o = await s.createOrder(input(g.id, { paid_amount: 50000 }))
    const { token } = await s.publicLink(o.id, false)
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect((await s.publicLink(o.id, false)).token).toBe(token)
    // Tạo link không đổi updated_at → người đang sửa đơn không bị báo xung đột.
    expect((await s.getOrder(o.id)).updated_at).toBe(o.updated_at)

    const view = await s.getPublicOrder(token)
    expect(view).toMatchObject({ order_code: o.order_code, customer_phone_masked: '091****678', amount_due: 150000 })
    expect(JSON.stringify(view)).not.toContain('0912345678')
    expect(view.delivery_address).toBe('HN')

    const { token: next } = await s.publicLink(o.id, true)
    expect(next).not.toBe(token)
    await expect(s.getPublicOrder(token)).rejects.toMatchObject({ status: 404 })
  })

  it('mã sai định dạng hoặc rỗng không khớp đơn nào chưa có link', async () => {
    const s = setup()
    const g = await s.createGroup(groupInput)
    await s.createOrder(input(g.id))
    await expect(s.getPublicOrder('')).rejects.toMatchObject({ status: 404 })
    await expect(s.getPublicOrder('../../etc')).rejects.toMatchObject({ status: 404 })
  })

  it('che số điện thoại', () => {
    expect(maskPhone('0912345678')).toBe('091****678')
    expect(maskPhone('12')).toBe('***')
  })
})

describe('Chi phí của nhóm', () => {
  const costInput = { category: 'material' as const, name: 'Vải', quantity: 1.2, unit: 'mét', unit_price: 80000, basis: 'per_item' as const, note: '' }

  it('thêm, sửa, xóa khoản chi và trả về cùng nhóm', async () => {
    const s = setup()
    const g = await s.createGroup(groupInput)
    const c = await s.createCost(g.id, costInput)
    await s.createCost(g.id, { ...costInput, category: 'labor', name: 'Công may', quantity: 1, unit_price: 50000 })
    expect((await s.getGroup(g.id)).costs.map((x) => x.name)).toEqual(['Vải', 'Công may'])

    const updated = await s.updateCost(g.id, c.id, { ...costInput, unit_price: 90000, expected_updated_at: c.updated_at })
    expect(updated.unit_price).toBe(90000)
    await expect(s.updateCost(g.id, c.id, { ...costInput, expected_updated_at: c.updated_at })).rejects.toMatchObject({ status: 409 })

    await s.deleteCost(g.id, c.id, updated.updated_at)
    expect((await s.getGroup(g.id)).costs).toHaveLength(1)
  })

  it('không sửa được khoản chi qua nhóm khác', async () => {
    const s = setup()
    const g1 = await s.createGroup(groupInput)
    const g2 = await s.createGroup(groupInput)
    const c = await s.createCost(g1.id, costInput)
    await expect(s.updateCost(g2.id, c.id, costInput)).rejects.toMatchObject({ status: 404 })
    await expect(s.deleteCost(g2.id, c.id)).rejects.toMatchObject({ status: 404 })
    await expect(s.createCost('khong-co', costInput)).rejects.toMatchObject({ status: 404 })
  })
})

describe('Sửa sau review', () => {
  it('giao diện bản cũ sửa đơn giảm tổng dưới số đã cọc: hạ số cọc thay vì báo lỗi', async () => {
    const s = setup()
    const g = await s.createGroup(groupInput)
    const o = await s.createOrder(input(g.id, { paid_amount: 200000 }))
    const updated = await s.updateOrder(
      o.id,
      input(g.id, { items: [{ size: 'M', quantity: 1, unit_price: 100000 }], expected_updated_at: o.updated_at }),
    )
    expect(updated.paid_amount).toBe(100000)
  })

  it('số cọc âm (sửa tay trên Sheets) coi như chưa trả; đơn đã kết thúc không còn phải thu', () => {
    expect(amountDue({ total_amount: 100, paid_amount: -50 })).toBe(100)
    expect(amountDueNow({ total_amount: 100, paid_amount: 30, status: 'shipping' })).toBe(70)
    expect(amountDueNow({ total_amount: 100, paid_amount: 30, status: 'cancelled' })).toBe(0)
  })

  it('cảnh báo khi thu hộ trên GHN khác số còn phải thu', () => {
    const base = { ghn_order_code: 'GHN1', ghn_status: 'delivering', total_amount: 500, status: 'shipping' as const }
    expect(codMismatch({ ...base, paid_amount: 0, ghn_cod_amount: 500 })).toBe(false)
    expect(codMismatch({ ...base, paid_amount: 200, ghn_cod_amount: 500 })).toBe(true)
    expect(codMismatch({ ...base, paid_amount: 200, ghn_cod_amount: 500, ghn_status: 'cancel' })).toBe(false)
    expect(codMismatch({ ...base, paid_amount: 200, ghn_cod_amount: 500, status: 'delivered' })).toBe(false)
  })
})
