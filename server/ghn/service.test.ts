import { describe, expect, it } from 'vitest'
import { parseGhnAddress } from '../../shared/ghn'
import { ghnShipmentInputSchema, type GhnShipmentInput } from '../../shared/schemas'
import { Mutex } from '../mutex'
import { MemoryStore } from '../repo/memory'
import { OrderService } from '../service'
import { FakeGhnClient, type GhnOrderPayload } from './client'
import { ShippingService, applyGhnStatus, nextClientCode } from './service'

class SpyGhn extends FakeGhnClient {
  created: GhnOrderPayload[] = []
  override async create(body: GhnOrderPayload) {
    this.created.push(body)
    return super.create(body)
  }
}

async function setup() {
  let t = Date.parse('2026-12-01T03:00:00Z')
  const clock = () => new Date((t += 1000))
  const store = new MemoryStore()
  const lock = new Mutex()
  const orders = new OrderService(store, ['S', 'M', 'L'], clock, lock)
  const ghn = new SpyGhn()
  const shipping = new ShippingService(store, ghn, lock, clock)
  const g = await orders.createGroup({ name: 'Váy', description: '', product_name: 'Váy nhung', default_unit_price: 0, status: 'open' })
  const o = await orders.createOrder({
    group_id: g.id,
    customer: { name: 'Lan', phone: '0912345678', facebook_url: '', address: '' },
    items: [{ size: 'M', quantity: 2, unit_price: 150000 }],
    status: 'confirmed',
    note: '',
  })
  return { orders, shipping, ghn, order: o }
}

const shipment = (over: Partial<GhnShipmentInput> = {}): GhnShipmentInput => ({
  to_name: 'Lan',
  to_phone: '0912 345 678',
  is_new_address: true,
  province_id: 1000002,
  district_id: 0,
  ward_id: 100000202,
  street: '12 Trần Thái Tông',
  cod_amount: 300000,
  insurance_value: 0,
  weight: 600,
  length: 25,
  width: 20,
  height: 5,
  payment_type_id: 2,
  required_note: 'CHOXEMHANGKHONGTHU',
  note: '',
  save_address: true,
  ...over,
})

describe('nextClientCode', () => {
  it('lần đầu dùng mã đơn, tạo lại thì thêm -R2, -R3', () => {
    expect(nextClientCode({ order_code: 'DH1-001', ghn_client_code: '' })).toBe('DH1-001')
    expect(nextClientCode({ order_code: 'DH1-001', ghn_client_code: 'DH1-001' })).toBe('DH1-001-R2')
    expect(nextClientCode({ order_code: 'DH1-001', ghn_client_code: 'DH1-001-R2' })).toBe('DH1-001-R3')
  })
})

describe('ShippingService', () => {
  it('tạo vận đơn: dùng tên chuẩn GHN, lưu mã, chuyển đơn sang đóng gói, nhớ địa chỉ khách', async () => {
    const { orders, shipping, ghn, order } = await setup()
    const o = await shipping.createShipment(order.id, shipment())
    expect(o.ghn_order_code).toMatch(/^DEMO/)
    expect(o.ghn_client_code).toBe(order.order_code)
    expect(o.ghn_status).toBe('ready_to_pick')
    expect(o.status).toBe('packing')
    expect(o.ghn_fee).toBeGreaterThan(0)

    const sent = ghn.created[0]
    expect(sent.to_province_name).toBe('Hà Nội')
    expect(sent.to_ward_name).toBe('Phường Cầu Giấy')
    expect(sent.to_address).toBe('12 Trần Thái Tông, Phường Cầu Giấy, Hà Nội')
    expect(sent.to_phone).toBe('0912345678')
    expect(sent.is_new_to_address).toBe(true)
    expect(sent.items).toEqual([{ name: 'Váy nhung - size M', code: 'M', quantity: 2, price: 150000 }])

    const c = (await orders.getOrder(order.id)).customer
    expect(parseGhnAddress(c.ghn_address)).toMatchObject({ province_id: 1000002, ward_id: 100000202, street: '12 Trần Thái Tông' })
    expect(c.address).toBe(sent.to_address)
  })

  it('từ chối phường không thuộc tỉnh và không tạo vận đơn thứ hai', async () => {
    const { shipping, order } = await setup()
    await expect(shipping.createShipment(order.id, shipment({ ward_id: 100000101 }))).rejects.toThrow(/không thuộc Hà Nội/)
    await shipping.createShipment(order.id, shipment())
    await expect(shipping.createShipment(order.id, shipment())).rejects.toThrow(/đã có vận đơn/)
  })

  it('đồng bộ cập nhật trạng thái đơn theo GHN', async () => {
    const { shipping, order } = await setup()
    await shipping.createShipment(order.id, shipment())
    expect((await shipping.syncShipment(order.id)).ghn_status).toBe('picking') // giả lập: mỗi lần tiến 1 bước
    const picked = await shipping.syncShipment(order.id)
    expect(picked.ghn_status).toBe('picked')
    expect(picked.status).toBe('shipping')
  })

  it('hủy vận đơn: đơn về "Đã xác nhận", tạo lại dùng client code mới', async () => {
    const { shipping, ghn, order } = await setup()
    await shipping.createShipment(order.id, shipment())
    const cancelled = await shipping.cancelShipment(order.id)
    expect(cancelled.ghn_status).toBe('cancel')
    expect(cancelled.status).toBe('confirmed')
    const again = await shipping.createShipment(order.id, shipment())
    expect(again.ghn_client_code).toBe(`${order.order_code}-R2`)
    expect(ghn.created[1].client_order_code).toBe(`${order.order_code}-R2`)
  })

  it('webhook: cập nhật theo mã vận đơn, bỏ qua sự kiện cũ hơn', async () => {
    const { orders, shipping, order } = await setup()
    const o = await shipping.createShipment(order.id, shipment())
    const send = (Status: string, Time: string) =>
      shipping.handleWebhook({ OrderCode: o.ghn_order_code, Type: 'switch_status', Status, Time, CODAmount: 300000 })

    expect(await send('delivering', '2026-12-02T05:00:00Z')).toBe(true)
    expect((await orders.getOrder(order.id)).status).toBe('shipping')
    await send('picked', '2026-12-02T01:00:00Z') // đến trễ
    expect((await orders.getOrder(order.id)).ghn_status).toBe('delivering')
    await send('delivered', '2026-12-02T09:00:00Z')
    const done = await orders.getOrder(order.id)
    expect(done.ghn_status).toBe('delivered')
    expect(done.status).toBe('delivered')

    expect(await shipping.handleWebhook({ OrderCode: 'KHONGCO', Type: 'switch_status', Status: 'delivered' })).toBe(false)
  })

  it('webhook nhận ra vận đơn theo ClientOrderCode khi app chưa kịp lưu mã', async () => {
    const { orders, shipping, order } = await setup()
    await shipping.handleWebhook({
      OrderCode: 'LOST01',
      ClientOrderCode: order.order_code,
      Type: 'switch_status',
      Status: 'picked',
      Time: '2026-12-02T01:00:00Z',
    })
    const o = await orders.getOrder(order.id)
    expect(o.ghn_order_code).toBe('LOST01')
    expect(o.status).toBe('shipping')
  })
})

describe('applyGhnStatus', () => {
  it('không đổi gì thì trả null', async () => {
    const { shipping, order } = await setup()
    const o = await shipping.createShipment(order.id, shipment())
    expect(applyGhnStatus(o, 'ready_to_pick', '', 'now')).toBeNull()
  })
})

describe('địa chỉ lấy hàng (GHN_FROM_*)', () => {
  it('gửi kèm from_* và return_* theo hệ địa chỉ mới', async () => {
    const store = new MemoryStore()
    const lock = new Mutex()
    const orders = new OrderService(store, ['M'], undefined, lock)
    const ghn = new SpyGhn()
    const sender = { name: 'MEI', phone: '0397482241', street: '5 Kim Mã', ward: 'Phường Ba Đình', province: 'Hà Nội' }
    const shipping = new ShippingService(store, ghn, lock, undefined, sender)
    const g = await orders.createGroup({ name: 'A', description: '', product_name: 'Áo', default_unit_price: 0, status: 'open' })
    const o = await orders.createOrder({
      group_id: g.id,
      customer: { name: 'Lan', phone: '0912345678', facebook_url: '', address: '' },
      items: [{ size: 'M', quantity: 1, unit_price: 100000 }],
      status: 'confirmed',
      note: '',
    })
    await shipping.createShipment(o.id, shipment())
    expect(ghn.created[0]).toMatchObject({
      from_name: 'MEI',
      from_address: '5 Kim Mã, Phường Ba Đình, Hà Nội',
      from_ward_name: 'Phường Ba Đình',
      from_province_name: 'Hà Nội',
      is_new_from_address: true,
      return_address: '5 Kim Mã, Phường Ba Đình, Hà Nội',
      is_new_return_address: true,
    })
  })
})

describe('địa chỉ hệ cũ (3 cấp)', () => {
  it('gửi kèm quận/huyện, is_new_to_address=false, bắt buộc chọn quận', async () => {
    const { orders, shipping, ghn, order } = await setup()
    await expect(
      shipping.createShipment(order.id, shipment({ is_new_address: false, province_id: 202, district_id: 1444, ward_id: 144201 })),
    ).rejects.toThrow(/không thuộc Quận 3/)
    const o = await shipping.createShipment(
      order.id,
      shipment({ is_new_address: false, province_id: 202, district_id: 1442, ward_id: 144202, street: '72 Lê Thánh Tôn' }),
    )
    expect(ghn.created[0]).toMatchObject({
      is_new_to_address: false,
      to_province_name: 'Hồ Chí Minh',
      to_district_name: 'Quận 1',
      to_ward_name: 'Phường Bến Thành',
      to_address: '72 Lê Thánh Tôn, Phường Bến Thành, Quận 1, Hồ Chí Minh',
    })
    expect(o.ghn_to_address).toBe('72 Lê Thánh Tôn, Phường Bến Thành, Quận 1, Hồ Chí Minh')
    const saved = parseGhnAddress((await orders.getOrder(order.id)).customer.ghn_address)
    expect(saved).toMatchObject({ is_new: false, district_id: 1442, district_name: 'Quận 1' })
  })

  it('schema: hệ cũ thiếu quận/huyện thì báo lỗi', () => {
    const r = ghnShipmentInputSchema.safeParse(shipment({ is_new_address: false, district_id: 0 }))
    expect(r.success).toBe(false)
    expect(r.error?.issues[0].path).toEqual(['district_id'])
  })
})

describe('nháp GHN', () => {
  it('lưu nháp không đổi updated_at, tạo vận đơn thì xóa nháp', async () => {
    const { orders, shipping, order } = await setup()
    const saved = await shipping.saveDraft(order.id, { street: '5 Kim Mã', province_id: 1000002, weight: 0 })
    expect(saved.updated_at).toBe(order.updated_at)
    expect(JSON.parse(saved.ghn_draft)).toMatchObject({ street: '5 Kim Mã', province_id: 1000002 })
    await shipping.createShipment(order.id, shipment())
    expect((await orders.getOrder(order.id)).ghn_draft).toBe('')
    await expect(shipping.saveDraft(order.id, { street: 'x' })).rejects.toThrow(/đã có vận đơn/)
  })
})

describe('gửi chung một vận đơn (nhiều đơn của cùng khách)', () => {
  async function setupBundle() {
    const base = await setup()
    const g2 = await base.orders.createGroup({ name: 'Áo', description: '', product_name: 'Áo dài', default_unit_price: 0, status: 'open' })
    const second = await base.orders.createOrder({
      group_id: g2.id,
      customer: { name: 'Lan', phone: '0912345678', facebook_url: '', address: '' },
      items: [{ size: 'S', quantity: 1, unit_price: 200000 }],
      status: 'pending',
      note: '',
      paid_amount: 50000,
    })
    return { ...base, second }
  }

  it('tạo một vận đơn cho cả gói: COD tổng, mỗi đơn giữ phần còn thu của mình, phí chỉ ở đơn chính', async () => {
    const { orders, shipping, ghn, order, second } = await setupBundle()
    const main = await shipping.createShipment(
      order.id,
      shipment({ cod_amount: 450000, bundle: [{ id: second.id, expected_updated_at: second.updated_at }] }),
    )
    expect(ghn.created).toHaveLength(1)
    const sent = ghn.created[0]
    expect(sent.cod_amount).toBe(450000)
    expect(sent.items.map((i) => i.code)).toEqual(['M', 'S'])
    expect(sent.order_value).toBe(500000)
    expect(sent.content).toContain(`Gồm đơn ${order.order_code}, ${second.order_code}`)

    const companion = await orders.getOrder(second.id)
    expect(companion.ghn_order_code).toBe(main.ghn_order_code)
    expect(companion.status).toBe('packing')
    expect(companion.ghn_cod_amount).toBe(150000) // 200.000 - cọc 50.000
    expect(companion.ghn_fee).toBe(0)
    expect(main.ghn_cod_amount).toBe(300000)
    expect((await orders.getOrder(order.id)).ghn_bundle).toEqual([second.order_code])
    expect(companion.ghn_bundle).toEqual([order.order_code])
  })

  it('đồng bộ / webhook cập nhật mọi đơn trong gói, COD tổng không làm lệch phần từng đơn', async () => {
    const { orders, shipping, order, second } = await setupBundle()
    const main = await shipping.createShipment(order.id, shipment({ cod_amount: 450000, bundle: [{ id: second.id }] }))
    await shipping.syncShipment(second.id) // giả lập: picking
    await shipping.syncShipment(order.id) // picked
    for (const id of [order.id, second.id]) {
      const o = await orders.getOrder(id)
      expect(o.ghn_status).toBe('picked')
      expect(o.status).toBe('shipping')
    }
    expect((await orders.getOrder(order.id)).ghn_cod_amount).toBe(300000)
    expect((await orders.getOrder(second.id)).ghn_cod_amount).toBe(150000)

    await shipping.handleWebhook({ OrderCode: main.ghn_order_code, Type: 'switch_status', Status: 'delivered', Time: '2030-01-01T00:00:00Z', CODAmount: 450000 })
    expect((await orders.getOrder(second.id)).status).toBe('delivered')
    expect((await orders.getOrder(order.id)).status).toBe('delivered')

    // Shop sửa COD trên GHN: phần chênh lệch tính vào đơn chính.
    await shipping.handleWebhook({ OrderCode: main.ghn_order_code, Type: 'update_cod', CODAmount: 400000 })
    expect((await orders.getOrder(order.id)).ghn_cod_amount).toBe(250000)
    expect((await orders.getOrder(second.id)).ghn_cod_amount).toBe(150000)
  })

  it('hủy vận đơn từ đơn gửi kèm thì hủy cả gói; đồng bộ tất cả chỉ hỏi GHN một lần', async () => {
    const { orders, shipping, order, second } = await setupBundle()
    await shipping.createShipment(order.id, shipment({ cod_amount: 450000, bundle: [{ id: second.id }] }))
    const r = await shipping.syncAll()
    expect(r.checked).toBe(1)
    expect(r.updated).toBe(2)

    await shipping.cancelShipment(second.id)
    for (const id of [order.id, second.id]) {
      const o = await orders.getOrder(id)
      expect(o.ghn_status).toBe('cancel')
      expect(o.status).toBe('confirmed')
      expect(o.ghn_bundle).toEqual([])
    }
  })

  it('từ chối: COD thiếu phần đơn gửi kèm, khác khách, đơn đã có vận đơn, đơn vừa bị sửa', async () => {
    const { orders, shipping, ghn, order, second } = await setupBundle()
    await expect(shipping.createShipment(order.id, shipment({ cod_amount: 100000, bundle: [{ id: second.id }] }))).rejects.toThrow(
      /ít nhất 150\.000/,
    )
    await expect(
      shipping.createShipment(order.id, shipment({ cod_amount: 450000, bundle: [{ id: second.id, expected_updated_at: 'cu' }] })),
    ).rejects.toThrow(/vừa được sửa/)

    const other = await orders.createOrder({
      group_id: order.group_id,
      customer: { name: 'Mai', phone: '0987654321', facebook_url: '', address: '' },
      items: [{ size: 'L', quantity: 1, unit_price: 100000 }],
      status: 'confirmed',
      note: '',
    })
    await expect(shipping.createShipment(order.id, shipment({ bundle: [{ id: other.id }] }))).rejects.toThrow(/không cùng khách/)

    await shipping.createShipment(second.id, shipment({ cod_amount: 150000 }))
    await expect(shipping.createShipment(order.id, shipment({ cod_amount: 450000, bundle: [{ id: second.id }] }))).rejects.toThrow(
      /đã có vận đơn/,
    )
    expect(ghn.created).toHaveLength(1)
    expect((await orders.getOrder(order.id)).ghn_order_code).toBe('')
  })
})

describe('trang tra cứu của đơn gửi chung', () => {
  it('hiện sản phẩm của các đơn cùng gói (không lộ mã đơn), tiền phải trả là tổng cả gói', async () => {
    const base = await setup()
    const g2 = await base.orders.createGroup({ name: 'Áo', description: '', product_name: 'Áo dài', default_unit_price: 0, status: 'open' })
    const second = await base.orders.createOrder({
      group_id: g2.id,
      customer: { name: 'Lan', phone: '0912345678', facebook_url: '', address: '' },
      items: [{ size: 'S', quantity: 1, unit_price: 200000 }],
      status: 'pending',
      note: '',
      paid_amount: 50000,
    })
    await base.shipping.createShipment(base.order.id, shipment({ cod_amount: 450000, bundle: [{ id: second.id }] }))
    const { token } = await base.orders.publicLink(second.id, false)
    const view = await base.orders.getPublicOrder(token)
    expect(view.amount_due).toBe(450000)
    expect(view.bundled_orders).toEqual([
      { group_name: 'Váy', items: [expect.objectContaining({ size: 'M', quantity: 2 })], total_amount: 300000, paid_amount: 0 },
    ])
    expect(JSON.stringify(view)).not.toContain(base.order.order_code)
  })
})

describe('gửi chung — các trường hợp biên', () => {
  async function bundled() {
    const base = await setup()
    const second = await base.orders.createOrder({
      group_id: base.order.group_id,
      customer: { name: 'Lan', phone: '0912345678', facebook_url: '', address: '' },
      items: [{ size: 'S', quantity: 1, unit_price: 200000 }],
      status: 'pending',
      note: '',
      paid_amount: 50000,
    })
    return { ...base, second }
  }

  it('không cho xóa đơn đang gửi chung (tiền các đơn còn lại sẽ lệch)', async () => {
    const { orders, shipping, order, second } = await bundled()
    await shipping.createShipment(order.id, shipment({ cod_amount: 450000, bundle: [{ id: second.id }] }))
    await expect(orders.deleteOrder(order.id)).rejects.toThrow(/gửi chung vận đơn/)
    await expect(orders.deleteOrder(second.id)).rejects.toThrow(/gửi chung vận đơn/)
    await shipping.cancelShipment(order.id)
    await orders.deleteOrder(second.id) // hủy vận đơn rồi thì xóa được
  })

  it('trang tra cứu không tính tiền / không hiện đơn cùng gói đã bị hủy trong app', async () => {
    const { orders, shipping, order, second } = await bundled()
    await shipping.createShipment(order.id, shipment({ cod_amount: 450000, bundle: [{ id: second.id }] }))
    await orders.updateOrderStatus(second.id, { status: 'cancelled' })
    const { token } = await orders.publicLink(order.id, false)
    const view = await orders.getPublicOrder(token)
    expect(view.amount_due).toBe(300000)
    expect(view.bundled_orders).toEqual([])
  })

  it('webhook cứu vận đơn (GHN đã tạo, app chưa kịp lưu) gắn mã cho cả đơn gửi kèm', async () => {
    const { orders, shipping, ghn, order, second } = await bundled()
    // Giả lập: GHN tạo xong nhưng lưu vào Sheets thất bại.
    const store = (shipping as unknown as { store: { updateMany: (...a: unknown[]) => Promise<void> } }).store
    const original = store.updateMany.bind(store)
    let calls = 0
    store.updateMany = async (...a: unknown[]) => {
      if (++calls === 2) throw new Error('Sheets lỗi')
      return original(...a)
    }
    await expect(shipping.createShipment(order.id, shipment({ cod_amount: 450000, bundle: [{ id: second.id }] }))).rejects.toThrow()
    store.updateMany = original
    const code = (await ghn.create.call(ghn, ghn.created[0])).order_code // vận đơn mà GHN đã tạo
    await shipping.handleWebhook({
      OrderCode: code,
      ClientOrderCode: order.order_code,
      Type: 'create',
      Status: 'ready_to_pick',
      Time: '2026-12-02T01:00:00Z',
      CODAmount: 450000,
    })
    const main = await orders.getOrder(order.id)
    const comp = await orders.getOrder(second.id)
    expect(main.ghn_order_code).toBe(code)
    expect(comp.ghn_order_code).toBe(code)
    expect(comp.ghn_cod_amount).toBe(150000)
    expect(main.ghn_cod_amount).toBe(300000)
    expect(comp.status).toBe('packing')
  })
})
