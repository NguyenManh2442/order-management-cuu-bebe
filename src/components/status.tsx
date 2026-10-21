import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import {
  GROUP_STATUS_LABELS,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  type GroupStatus,
  type OrderStatus,
} from '@shared/constants'
import type { Order } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, type DropdownOption } from '@/components/ui/dropdown'
import { errorMessage } from '@/lib/api'
import { useUpdateOrderStatus } from '@/lib/queries'
import { cn } from '@/lib/utils'

export const STATUS_STYLES: Record<OrderStatus, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
  packing: 'bg-violet-50 text-violet-700 border-violet-200',
  shipping: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  returned: 'bg-rose-50 text-rose-700 border-rose-200',
}

export const STATUS_DOT: Record<OrderStatus, string> = {
  pending: 'bg-amber-500',
  confirmed: 'bg-blue-500',
  packing: 'bg-violet-500',
  shipping: 'bg-cyan-500',
  delivered: 'bg-emerald-500',
  cancelled: 'bg-zinc-400',
  returned: 'bg-rose-500',
}

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <Badge className={cn(STATUS_STYLES[status], className)}>
      <span className={cn('size-1.5 rounded-full', STATUS_DOT[status])} />
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  )
}

export function GroupStatusBadge({ status }: { status: GroupStatus }) {
  return (
    <Badge
      className={
        status === 'open'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-zinc-200 bg-zinc-100 text-zinc-600'
      }
    >
      {GROUP_STATUS_LABELS[status]}
    </Badge>
  )
}

/** Lựa chọn trạng thái đơn có chấm màu — dùng chung cho mọi ô chọn trạng thái. */
export const ORDER_STATUS_OPTIONS: DropdownOption<OrderStatus>[] = ORDER_STATUSES.map((s) => ({
  value: s,
  label: ORDER_STATUS_LABELS[s],
  dot: STATUS_DOT[s],
}))

/** Badge trạng thái bấm được để đổi nhanh: mở danh sách trạng thái có màu ngay dưới badge. */
export function StatusSelect({
  order,
  size = 'sm',
  className,
}: {
  order: Pick<Order, 'id' | 'status' | 'updated_at' | 'order_code'>
  size?: 'sm' | 'lg'
  className?: string
}) {
  const mutation = useUpdateOrderStatus()
  const status = mutation.isPending && mutation.variables ? mutation.variables.status : order.status

  return (
    <DropdownMenu
      value={status}
      options={ORDER_STATUS_OPTIONS}
      disabled={mutation.isPending}
      minWidth={190}
      onChange={(next) =>
        mutation.mutate(
          { order, status: next },
          {
            onSuccess: () => toast.success(`${order.order_code}: ${ORDER_STATUS_LABELS[next]}`),
            onError: (err) => toast.error(errorMessage(err)),
          },
        )
      }
      renderTrigger={({ ref, open, buttonProps }) => (
        <button
          ref={ref}
          aria-label={`Trạng thái đơn ${order.order_code}: ${ORDER_STATUS_LABELS[status]} — bấm để đổi`}
          {...buttonProps}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border font-medium transition-shadow hover:shadow-sm disabled:cursor-wait',
            STATUS_STYLES[status],
            size === 'sm' ? 'h-8 pr-2 pl-2.5 text-xs' : 'h-11 pr-3 pl-3.5 text-sm',
            mutation.isPending && 'opacity-60',
            open && 'ring-2 ring-ring/30',
            className,
          )}
        >
          <span className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[status])} />
          {ORDER_STATUS_LABELS[status]}
          <ChevronDown className={cn('shrink-0 transition-transform', size === 'sm' ? 'size-3.5' : 'size-4', open && 'rotate-180')} />
        </button>
      )}
    />
  )
}
