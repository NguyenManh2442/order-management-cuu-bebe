import { useState } from 'react'
import { Link } from 'react-router'
import type { OrderView } from '@shared/types'
import { Button } from '@/components/ui/button'
import { cn, formatDateTime, formatNumber, formatVND } from '@/lib/utils'
import { FacebookLink, PhoneLink } from './contact-links'
import { GhnListAction } from './ghn-shipment'
import { sizeTone } from './stats'
import { StatusSelect } from './status'

const PAGE = 50

function ItemsText({ order }: { order: OrderView }) {
  if (!order.items.length) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex flex-wrap gap-1">
      {order.items.map((it) => (
        <span
          key={it.id}
          className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs whitespace-nowrap tabular-nums', sizeTone(it.size))}
        >
          <b className="font-bold">{it.size}</b>
          <span className="opacity-70">×</span>
          <b className="font-bold">{formatNumber(it.quantity)}</b>
        </span>
      ))}
    </span>
  )
}

function OrderCard({ order, showGroup }: { order: OrderView; showGroup?: boolean }) {
  return (
    <li className="relative rounded-xl border bg-card p-3 shadow-xs transition-colors hover:bg-secondary/40">
      <Link to={`/orders/${order.id}`} className="absolute inset-0 rounded-xl" aria-label={`Xem đơn ${order.order_code}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs text-muted-foreground">
            <span className="font-mono font-medium text-foreground">{order.order_code}</span> ·{' '}
            {formatDateTime(order.created_at)}
          </div>
          <div className="mt-0.5 truncate font-semibold">{order.customer.name}</div>
        </div>
        <StatusSelect order={order} className="relative z-10 shrink-0" />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <PhoneLink phone={order.customer.phone} />
        <FacebookLink url={order.customer.facebook_url} />
      </div>
      {order.customer.address && (
        <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{order.customer.address}</p>
      )}
      {showGroup && <p className="mt-1 truncate text-xs text-muted-foreground">Nhóm: {order.group_name}</p>}
      <GhnListAction order={order} className="mt-2" />
      <div className="mt-2 flex items-end justify-between gap-2">
        <ItemsText order={order} />
        <span className="shrink-0 font-semibold tabular-nums">{formatVND(order.total_amount)}</span>
      </div>
      {order.note && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground italic">{order.note}</p>}
    </li>
  )
}

function OrderTable({ orders, showGroup }: { orders: OrderView[]; showGroup?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
          <tr className="[&>th]:px-3 [&>th]:py-2.5 [&>th]:font-medium">
            <th>Mã đơn</th>
            <th>Khách hàng</th>
            <th>Số điện thoại</th>
            <th className="hidden xl:table-cell">Địa chỉ</th>
            {showGroup && <th>Nhóm</th>}
            <th>Size × SL</th>
            <th className="hidden text-right xl:table-cell">Đơn giá</th>
            <th className="text-right">Thành tiền</th>
            <th>Trạng thái</th>
            <th>Giao hàng</th>
            <th className="hidden xl:table-cell">Ghi chú</th>
            <th>Ngày tạo</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const prices = [...new Set(o.items.map((i) => i.unit_price))]
            return (
              <tr key={o.id} className="relative border-b last:border-0 hover:bg-secondary/40 [&>td]:px-3 [&>td]:py-2.5">
                <td className="font-mono text-xs font-medium whitespace-nowrap">
                  <Link to={`/orders/${o.id}`} className="after:absolute after:inset-0 hover:underline">
                    {o.order_code}
                  </Link>
                </td>
                <td className="max-w-44">
                  <div className="truncate font-medium">{o.customer.name}</div>
                  <FacebookLink url={o.customer.facebook_url} className="text-xs" />
                </td>
                <td className="whitespace-nowrap">
                  <PhoneLink phone={o.customer.phone} />
                </td>
                <td className="hidden max-w-56 xl:table-cell">
                  <span className="line-clamp-2 text-muted-foreground">{o.customer.address}</span>
                </td>
                {showGroup && <td className="max-w-40 truncate">{o.group_name}</td>}
                <td>
                  <ItemsText order={o} />
                </td>
                <td className="hidden text-right whitespace-nowrap tabular-nums xl:table-cell">
                  {prices.length === 1 ? formatVND(prices[0]) : prices.length ? 'Nhiều giá' : ''}
                </td>
                <td className="text-right font-semibold whitespace-nowrap tabular-nums">{formatVND(o.total_amount)}</td>
                <td>
                  <StatusSelect order={o} className="relative z-10" />
                </td>
                <td className="whitespace-nowrap">
                  <GhnListAction order={o} compact />
                </td>
                <td className="hidden max-w-48 xl:table-cell">
                  <span className="line-clamp-2 text-muted-foreground">{o.note}</span>
                </td>
                <td className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(o.created_at)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Card trên điện thoại, bảng trên desktop. Hiện dần từng trang để danh sách dài vẫn mượt. */
export function OrderList({
  orders,
  showGroup,
  className,
}: {
  orders: OrderView[]
  showGroup?: boolean
  className?: string
}) {
  const [limit, setLimit] = useState(PAGE)
  const visible = orders.slice(0, limit)
  return (
    <div className={cn('grid gap-3', className)}>
      <ul className="grid gap-3 md:hidden">
        {visible.map((o) => (
          <OrderCard key={o.id} order={o} showGroup={showGroup} />
        ))}
      </ul>
      <div className="hidden md:block">
        <OrderTable orders={visible} showGroup={showGroup} />
      </div>
      {orders.length > limit && (
        <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
          Xem thêm ({orders.length - limit} đơn)
        </Button>
      )}
    </div>
  )
}
