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
