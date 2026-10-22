import type { CostBasis, CostCategory, GroupStatus, OrderStatus } from './constants'
import type { GhnPublicConfig } from './ghn'

/** Mọi mốc thời gian là chuỗi ISO 8601 (UTC). Mọi số tiền là số nguyên VND. */

export interface Customer {
  id: string
  name: string
  phone: string
  facebook_url: string
  address: string
  /** Địa chỉ GHN đã chọn lần gần nhất (JSON GhnAddress), '' nếu chưa có. */
  ghn_address: string
  created_at: string
  updated_at: string
}

export interface OrderGroup {
  id: string
  name: string
  description: string
  product_name: string
  /** Đơn giá gợi ý khi thêm đơn vào nhóm, 0 = không có. */
  default_unit_price: number
  status: GroupStatus
  created_at: string
  updated_at: string
}

export interface Order {
  id: string
  order_code: string
  group_id: string
  customer_id: string
  /** Tóm tắt dạng "M x2, L x1" để đọc nhanh trên Google Sheets; không dùng để tính toán. */
  items_summary: string
  total_amount: number
  status: OrderStatus
  note: string
  /** Mã vận đơn GHN, '' nếu chưa gửi GHN. */
  ghn_order_code: string
  /** Mã đơn của shop đã gửi GHN (client_order_code) — để gửi lại an toàn không tạo trùng. */
  ghn_client_code: string
  /** Trạng thái thô của GHN (ready_to_pick, delivering…). */
  ghn_status: string
  /** Thời điểm GHN ghi nhận trạng thái trên — để bỏ qua webhook đến muộn/trùng. */
  ghn_status_at: string
  ghn_fee: number
  ghn_cod_amount: number
  ghn_expected_delivery: string
  /** Địa chỉ đầy đủ đã gửi GHN. */
  ghn_to_address: string
  /** Thông tin form GHN đang nhập dở (JSON GhnDraft), '' nếu không có nháp. */
  ghn_draft: string
  /** Khách đã cọc / chuyển khoản trước (VND). Còn phải thu = total_amount − paid_amount. */
  paid_amount: number
  /** Mã bí mật của link tra cứu đơn cho khách, '' nếu chưa tạo link. */
  public_token: string
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  product_name: string
  size: string
  quantity: number
  unit_price: number
  line_total: number
  created_at: string
}

/** Lịch sử mua của một khách (để cảnh báo khách hay hoàn/hủy đơn). */
export interface CustomerHistory {
  order_count: number
  delivered: number
  returned: number
  cancelled: number
}

/** Đơn hàng kèm khách hàng, các dòng sản phẩm và tên nhóm — dạng API trả về. */
export interface OrderView extends Order {
  customer: Customer
  items: OrderItem[]
  group_name: string
  /** Các đơn KHÁC của cùng khách (không tính đơn này). */
  customer_history: CustomerHistory
}

/** Khách tìm theo SĐT, kèm lịch sử để cảnh báo ngay trên form tạo đơn. */
export interface CustomerLookup extends Customer {
  history: CustomerHistory
}

/** Thông tin đơn hiển thị trên trang tra cứu công khai cho khách — chỉ những gì khách cần. */
export interface PublicOrderView {
  order_code: string
  created_at: string
  status: OrderStatus
  group_name: string
  /** Tên khách như shop đã ghi, SĐT đã che bớt số. */
  customer_name: string
  customer_phone_masked: string
  /** Địa chỉ giao hàng: địa chỉ đã gửi GHN nếu có, không thì địa chỉ khách đã cho. */
  delivery_address: string
  items: Pick<OrderItem, 'product_name' | 'size' | 'quantity' | 'unit_price' | 'line_total'>[]
  total_amount: number
  paid_amount: number
  /** Số tiền khách còn phải trả (COD trên GHN nếu đã gửi hàng). */
  amount_due: number
  shipment: {
    code: string
    status: string
    expected_delivery: string
    tracking_url: string
  } | null
}

export interface SizeStat {
  size: string
  quantity: number
}

export interface GroupStats {
  order_count: number
  customer_count: number
  item_count: number
  sizes: SizeStat[]
  /** Tổng tiền các đơn trong phạm vi thống kê. */
  total_amount: number
  /** Doanh thu = tổng tiền các đơn "Đã giao" trong phạm vi thống kê. */
  revenue: number
}

export interface GroupWithStats extends OrderGroup {
  stats: GroupStats
}

/** Một dòng chi phí của nhóm (vải, phụ liệu, công may…). Thành tiền không lưu, luôn tính lại. */
export interface GroupCost {
  id: string
  group_id: string
  category: CostCategory
  name: string
  /** Có thể là số lẻ (1,2 mét). Với per_item: số lượng cho mỗi sản phẩm. */
  quantity: number
  unit: string
  unit_price: number
  basis: CostBasis
  note: string
  created_at: string
  updated_at: string
}

export interface GroupDetail {
  group: OrderGroup
  orders: OrderView[]
  costs: GroupCost[]
}

export interface CustomerSummary extends Customer {
  history: CustomerHistory
  order_count: number
  last_order_at: string | null
}

export interface CustomerDetail {
  customer: Customer
  orders: OrderView[]
}

export interface AppConfig {
  sizes: string[]
  data_source: 'demo' | 'sheets'
  /** null = chưa cấu hình GHN. */
  ghn: GhnPublicConfig | null
}

export interface SessionUser {
  username: string
}

export interface BulkStatusResult {
  updated: number
  /** Đơn không đổi được: mã đơn + lý do. */
  skipped: { id: string; order_code: string; reason: string }[]
}
