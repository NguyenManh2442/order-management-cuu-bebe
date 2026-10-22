import { describe, expect, it } from 'vitest'
import type { GhnPublicConfig } from '@shared/ghn'
import type { OrderView } from '@shared/types'
import { bulkShipmentInput } from './ghn-defaults'

const ghn: GhnPublicConfig = {
  env: 'demo',
  default_item_weight: 300,
  default_dimensions: { length: 25, width: 20, height: 5 },
  default_required_note: 'CHOXEMHANGKHONGTHU',
  default_payment_type: 2,
}

const address = { is_new: true, province_id: 1, province_name: 'HCM', district_id: 0, district_name: '', ward_id: 2, ward_name: 'P', street: '12 Lê Lợi' }

const order = (over: Partial<OrderView> = {}): OrderView =>
  ({
    id: 'o1',
    order_code: 'DH1',
    total_amount: 500_000,
    paid_amount: 200_000,
    ghn_draft: '',
    updated_at: 't',
    items: [{ quantity: 1 }],
    customer: { name: 'Lan', phone: '0912345678', address: '12 Lê Lợi', ghn_address: JSON.stringify(address) },
    ...over,
  }) as OrderView

describe('bulkShipmentInput', () => {
  it('thu hộ = số còn phải thu (đã trừ cọc)', () => {
    const r = bulkShipmentInput(order(), ghn)
    expect(r.ok && r.input.cod_amount).toBe(300_000)
  })

  it('nháp còn COD cũ (trước khi ghi cọc) thì không gửi tự động', () => {
    const r = bulkShipmentInput(order({ ghn_draft: JSON.stringify({ cod_amount: 500_000 }) }), ghn)
    expect(r.ok).toBe(false)
  })

  it('khách chưa có địa chỉ GHN thì bỏ qua, không tự đoán', () => {
    const r = bulkShipmentInput(order({ customer: { ...order().customer, ghn_address: '' } }), ghn)
    expect(r.ok).toBe(false)
  })
})
