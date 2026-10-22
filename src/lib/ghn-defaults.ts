import { parseGhnAddress, type GhnPublicConfig } from '@shared/ghn'
import { ghnDraftSchema, ghnShipmentInputSchema, type GhnShipmentInput } from '@shared/schemas'
import { amountDue } from '@shared/stats'
import type { OrderView } from '@shared/types'

/** Nháp đã lưu trong đơn (chỉ lấy các trường hợp lệ) + thời điểm lưu. */
export function readDraft(raw: string) {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const parsed = ghnDraftSchema.safeParse(value)
    if (!parsed.success) return null
    return { values: parsed.data, savedAt: typeof value.saved_at === 'string' ? value.saved_at : '' }
  } catch {
    return null
  }
}

export function shipmentDefaults(order: OrderView, ghn: GhnPublicConfig): GhnShipmentInput {
  const saved = parseGhnAddress(order.customer.ghn_address)
  const quantity = order.items.reduce((s, i) => s + i.quantity, 0)
  return {
    to_name: order.customer.name,
    to_phone: order.customer.phone,
    is_new_address: saved?.is_new ?? true,
    province_id: saved?.province_id ?? 0,
    district_id: saved?.district_id ?? 0,
    ward_id: saved?.ward_id ?? 0,
    street: saved?.street ?? order.customer.address,
    // Khách đã cọc / chuyển khoản thì chỉ thu hộ phần còn lại.
    cod_amount: amountDue(order),
    insurance_value: 0,
    weight: Math.min(19_999, Math.max(1, quantity) * ghn.default_item_weight),
    ...ghn.default_dimensions,
    payment_type_id: ghn.default_payment_type,
    required_note: ghn.default_required_note,
    note: '',
    save_address: true,
  }
}

/**
 * Thông tin gửi GHN cho tạo vận đơn hàng loạt: lấy nháp hoặc địa chỉ GHN đã lưu của khách.
 * Không tự đoán địa chỉ từ chữ khách nhập — thiếu tỉnh/phường thì trả lý do để người bán mở từng đơn.
 */
export function bulkShipmentInput(
  order: OrderView,
  ghn: GhnPublicConfig,
): { ok: true; input: GhnShipmentInput } | { ok: false; reason: string } {
  const draft = readDraft(order.ghn_draft)
  // Nháp lưu từ trước khi ghi tiền cọc / sửa sản phẩm có thể còn COD cũ — không tự gửi số đó.
  const due = amountDue(order)
  if (draft?.values.cod_amount !== undefined && draft.values.cod_amount !== due) {
    return {
      ok: false,
      reason: `Thu hộ trong nháp (${draft.values.cod_amount.toLocaleString('vi-VN')} ₫) khác số còn phải thu (${due.toLocaleString('vi-VN')} ₫) — mở đơn để kiểm tra`,
    }
  }
  const values = { ...shipmentDefaults(order, ghn), ...draft?.values, expected_updated_at: order.updated_at }
  if (!values.province_id || !values.ward_id) return { ok: false, reason: 'Chưa có địa chỉ GHN (khách mới) — mở đơn để chọn' }
  const parsed = ghnShipmentInputSchema.safeParse(values)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'Thiếu thông tin gửi GHN' }
  return { ok: true, input: parsed.data }
}
