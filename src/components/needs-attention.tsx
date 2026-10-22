import { PhoneCall } from 'lucide-react'
import { Link } from 'react-router'
import type { OrderView } from '@shared/types'
import { Button } from '@/components/ui/button'
import { cn, formatDateTime } from '@/lib/utils'

/** GHN giao không thành công và đơn chưa kết thúc: shop cần gọi khách hẹn giao lại hoặc xác nhận hoàn. */
export function deliveryFailed(orders: OrderView[] | undefined): OrderView[] {
  return (orders ?? [])
    .filter((o) => o.ghn_status === 'delivery_fail' && o.status !== 'cancelled' && o.status !== 'delivered' && o.status !== 'returned')
    .sort((a, b) => (b.ghn_status_at || b.updated_at).localeCompare(a.ghn_status_at || a.updated_at))
}

export function DeliveryFailedCard({ orders, className }: { orders: OrderView[]; className?: string }) {
  if (!orders.length) return null
  return (
    <section className={cn('rounded-xl border border-rose-200 bg-rose-50/60 p-4', className)} aria-label="Cần xử lý">
      <h2 className="flex items-center gap-2 font-semibold text-rose-900">
        <PhoneCall className="size-4" /> Cần gọi khách: {orders.length} đơn GHN giao thất bại
      </h2>
      <p className="mt-0.5 text-sm text-rose-900/80">Gọi khách hẹn giao lại trước khi GHN chuyển hoàn hàng.</p>
      <ul className="mt-3 grid gap-2">
        {orders.map((o) => (
          <li key={o.id} className="flex items-center gap-3 rounded-lg border border-rose-200 bg-card px-3 py-2">
            <div className="min-w-0 flex-1">
              <Link to={`/orders/${o.id}`} className="block truncate font-medium hover:underline">
                {o.customer.name} <span className="font-mono text-xs text-muted-foreground">· {o.order_code}</span>
              </Link>
              <div className="truncate text-xs text-muted-foreground">
                {o.items_summary}
                {o.ghn_status_at && ` · thất bại lúc ${formatDateTime(o.ghn_status_at)}`}
              </div>
            </div>
            {o.customer.phone && (
              <Button asChild size="sm" className="shrink-0">
                <a href={`tel:${o.customer.phone}`} aria-label={`Gọi ${o.customer.name}`}>
                  <PhoneCall /> Gọi
                </a>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
