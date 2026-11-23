export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'packing',
  'shipping',
  'delivered',
  'cancelled',
  'returned',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  packing: 'Đang đóng gói',
  shipping: 'Đang giao',
  delivered: 'Đã giao',
  cancelled: 'Đã hủy',
  returned: 'Hoàn hàng',
}

export const GROUP_STATUSES = ['open', 'closed'] as const
export type GroupStatus = (typeof GROUP_STATUSES)[number]

export const GROUP_STATUS_LABELS: Record<GroupStatus, string> = {
  open: 'Đang mở',
  closed: 'Đã đóng',
}

export const DEFAULT_SIZES = ['S', 'M', 'L', 'XL']

export const MAX_ITEMS_PER_ORDER = 20

export const COST_CATEGORIES = ['material', 'labor', 'other'] as const
export type CostCategory = (typeof COST_CATEGORIES)[number]

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  material: 'Nguyên vật liệu',
  labor: 'Công thợ',
  other: 'Chi phí khác',
}

/** fixed: số lượng cố định (50 mét vải). per_item: số lượng cho MỖI sản phẩm × số sản phẩm đã đặt. */
export const COST_BASES = ['fixed', 'per_item'] as const
export type CostBasis = (typeof COST_BASES)[number]

export const COST_BASIS_LABELS: Record<CostBasis, string> = {
  fixed: 'Số lượng cố định',
  per_item: 'Theo mỗi sản phẩm',
}

/** Lô xuất: một đợt soạn / tạo vận đơn / in nhãn / giao cho GHN. */
export const BATCH_STATUSES = ['open', 'done'] as const
export type BatchStatus = (typeof BATCH_STATUSES)[number]

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  open: 'Đang xuất',
  done: 'Đã xong',
}

/** Chi phí ngoài: chi phí chung của shop, không thuộc nhóm hàng nào. */
export const EXPENSE_CATEGORIES = ['ads', 'shipping', 'packaging', 'salary', 'tools', 'other'] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  ads: 'Quảng cáo',
  shipping: 'Vận chuyển',
  packaging: 'Bao bì, đóng gói',
  salary: 'Lương, nhân công',
  tools: 'Dụng cụ, thiết bị',
  other: 'Khác',
}
