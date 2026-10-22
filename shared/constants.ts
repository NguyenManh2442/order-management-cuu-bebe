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
