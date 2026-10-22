import type { OrderStatus } from './constants'
import { OPEN_ORDER_STATUSES, amountDue } from './stats'
import type { Order } from './types'

/**
 * Giao Hàng Nhanh (GHN) — https://developer.ghn.vn
 * Dùng địa chỉ hệ mới 2 cấp (Tỉnh/Thành + Phường/Xã, sau 01/07/2025).
 */

export const GHN_STATUS_LABELS: Record<string, string> = {
  ready_to_pick: 'Chờ lấy hàng',
  picking: 'Đang lấy hàng',
  money_collect_picking: 'Thu tiền khi lấy',
  picked: 'Đã lấy hàng',
  storing: 'Đang ở kho',
  sorting: 'Đang phân loại',
  transporting: 'Đang luân chuyển',
  delivering: 'Đang giao',
  money_collect_delivering: 'Thu tiền khi giao',
  delivered: 'Giao thành công',
  delivery_fail: 'Giao thất bại',
  waiting_to_return: 'Chờ trả hàng',
  return: 'Yêu cầu trả hàng',
  return_transporting: 'Đang luân chuyển hàng trả',
  return_sorting: 'Đang phân loại hàng trả',
  returning: 'Đang trả hàng',
  return_fail: 'Trả hàng thất bại',
  returned: 'Đã trả hàng',
  cancel: 'Đã hủy',
  exception: 'Sự cố',
  lost: 'Thất lạc',
  damage: 'Hư hỏng',
  scrap: 'Đã tiêu hủy',
}

export const ghnStatusLabel = (s: string) => GHN_STATUS_LABELS[s] ?? s

/** Trạng thái kết thúc: không cần đồng bộ nữa. */
export const GHN_FINAL_STATUSES = ['delivered', 'returned', 'cancel', 'exception', 'lost', 'damage', 'scrap']

/** Còn hủy được qua API (trước khi tài xế lấy hàng). */
export const GHN_CANCELLABLE_STATUSES = ['ready_to_pick', 'picking', 'money_collect_picking']

/** Vận đơn đang hiệu lực (chưa hủy) — chặn tạo vận đơn thứ hai cho cùng một đơn. */
export const isActiveShipment = (o: { ghn_order_code: string; ghn_status: string }) =>
  !!o.ghn_order_code && o.ghn_status !== 'cancel'

/**
 * Trạng thái GHN → trạng thái đơn trong app. null = giữ nguyên trạng thái đơn
 * (ví dụ vận đơn bị hủy hay gặp sự cố: shop tự quyết định tạo lại hay hủy đơn).
 */
export function ghnToOrderStatus(status: string): OrderStatus | null {
  switch (status) {
    case 'ready_to_pick':
    case 'picking':
    case 'money_collect_picking':
      return 'packing'
    case 'picked':
    case 'storing':
    case 'sorting':
    case 'transporting':
    case 'delivering':
    case 'money_collect_delivering':
    case 'delivery_fail':
      return 'shipping'
    case 'delivered':
      return 'delivered'
    case 'waiting_to_return':
    case 'return':
    case 'return_transporting':
    case 'return_sorting':
    case 'returning':
    case 'return_fail':
    case 'returned':
      return 'returned'
    default:
      return null
  }
}

export const GHN_REQUIRED_NOTES = ['CHOXEMHANGKHONGTHU', 'CHOTHUHANG', 'KHONGCHOXEMHANG'] as const
export type GhnRequiredNote = (typeof GHN_REQUIRED_NOTES)[number]

export const GHN_REQUIRED_NOTE_LABELS: Record<GhnRequiredNote, string> = {
  CHOXEMHANGKHONGTHU: 'Cho xem hàng, không cho thử',
  CHOTHUHANG: 'Cho xem và thử hàng',
  KHONGCHOXEMHANG: 'Không cho xem hàng',
}

export const GHN_PAYMENT_TYPE_LABELS: Record<1 | 2, string> = {
  2: 'Người nhận trả (thu thêm khi giao)',
  1: 'Shop trả',
}

/** 1 = shop trả phí ship, 2 = người nhận trả. */
export const GHN_PAYMENT_TYPES = [1, 2] as const
export type GhnPaymentType = (typeof GHN_PAYMENT_TYPES)[number]

export interface GhnPlace {
  id: number
  name: string
  /** Biến thể tên (không dấu, viết tắt…) do GHN cung cấp, để tìm kiếm/gợi ý. */
  aliases: string[]
}

/** Địa chỉ GHN đã chọn lần gần nhất cho khách — lưu JSON trong cột customers.ghn_address. */
export interface GhnAddress {
  /** true = hệ mới 2 cấp (Tỉnh → Phường), false = hệ cũ 3 cấp (Tỉnh → Quận/Huyện → Phường). */
  is_new: boolean
  province_id: number
  province_name: string
  /** Chỉ có ở hệ cũ (0 / '' ở hệ mới). */
  district_id: number
  district_name: string
  ward_id: number
  ward_name: string
  street: string
}

export function parseGhnAddress(raw: string): GhnAddress | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<GhnAddress>
    if (typeof v.province_id !== 'number' || typeof v.ward_id !== 'number') return null
    return {
      // Bản lưu trước khi có hệ cũ luôn là hệ mới.
      is_new: v.is_new !== false,
      province_id: v.province_id,
      province_name: String(v.province_name ?? ''),
      district_id: Number(v.district_id ?? 0),
      district_name: String(v.district_name ?? ''),
      ward_id: v.ward_id,
      ward_name: String(v.ward_name ?? ''),
      street: String(v.street ?? ''),
    }
  } catch {
    return null
  }
}

export function formatGhnAddress(
  a: Pick<GhnAddress, 'street' | 'ward_name' | 'province_name'> & { district_name?: string },
): string {
  return [a.street.trim(), a.ward_name, a.district_name, a.province_name].filter(Boolean).join(', ')
}

export interface GhnQuote {
  total_fee: number
  expected_delivery_time: string
}

/** Cấu hình GHN gửi xuống trình duyệt (không chứa token). */
export interface GhnPublicConfig {
  /** "staging" | "production" | "demo" (giả lập, không gọi GHN thật). */
  env: string
  default_item_weight: number
  default_dimensions: { length: number; width: number; height: number }
  default_required_note: GhnRequiredNote
  default_payment_type: GhnPaymentType
}

export type GhnEnv = 'staging' | 'production'

/** Địa chỉ lấy hàng. Mã tỉnh/phường = 0 khi khai báo bằng tên trong .env. */
export interface GhnSenderAddress {
  name: string
  phone: string
  street: string
  province_id: number
  province_name: string
  ward_id: number
  ward_name: string
}

export interface GhnDefaults {
  item_weight: number
  length: number
  width: number
  height: number
  required_note: GhnRequiredNote
  payment_type: GhnPaymentType
}

/** Cấu hình GHN hiển thị trên màn thiết lập. Không bao giờ chứa token. */
export interface GhnSettingsView {
  /** file = lưu từ màn thiết lập, env = từ .env, none = chưa thiết lập. */
  source: 'file' | 'env' | 'none'
  env: GhnEnv
  has_token: boolean
  /** 4 ký tự cuối của token để nhận ra token nào đang dùng. */
  token_hint: string
  shop_id: string
  webhook_secret: string
  sender: GhnSenderAddress | null
  defaults: GhnDefaults
  /** Chế độ demo: chưa thiết lập thì dùng GHN giả lập. */
  demo_fallback: boolean
  /** Khác '' = server không lưu được thiết lập (ví dụ chạy trên Vercel), kèm lý do và cách cấu hình. */
  read_only: string
}

export interface GhnShop {
  id: number
  name: string
  /** '' = shop chưa khai báo địa chỉ lấy hàng trên GHN. */
  address: string
}

export const DEFAULT_GHN_DEFAULTS: GhnDefaults = {
  item_weight: 300,
  length: 25,
  width: 20,
  height: 5,
  required_note: 'CHOXEMHANGKHONGTHU',
  payment_type: 2,
}

/**
 * Vận đơn đang chạy mà tiền thu hộ trên GHN khác số còn phải thu — xảy ra khi sửa tiền cọc
 * hoặc sản phẩm sau khi đã gửi GHN (sửa đơn trong app không cập nhật sang GHN).
 */
export function codMismatch(
  o: Pick<Order, 'ghn_order_code' | 'ghn_status' | 'ghn_cod_amount' | 'total_amount' | 'paid_amount' | 'status'>,
): boolean {
  return isActiveShipment(o) && OPEN_ORDER_STATUSES.includes(o.status) && o.ghn_cod_amount !== amountDue(o)
}

export const ghnTrackingUrl = (code: string) => `https://donhang.ghn.vn/?order_code=${encodeURIComponent(code)}`
