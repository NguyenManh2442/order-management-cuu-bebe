import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { OrderView } from '@shared/types'
import { OPEN_ORDER_STATUSES, amountDue } from '@shared/stats'
import { Button } from '@/components/ui/button'
import { cn, formatDateTime, formatNumber, formatVND } from '@/lib/utils'
import { SelectCheckbox, type OrderSelection } from './bulk-actions'
import { FacebookLink, PhoneLink } from './contact-links'
import { CustomerRiskBadge } from './customer-risk'
import { GhnListAction } from './ghn-shipment'
import { sizeTone } from './stats'
import { StatusSelect } from './status'

const PAGE = 20

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

/**
 * Đơn đang xử lý: "Cọc 100.000 ₫ · còn …" hoặc "Đã thanh toán".
 * Đơn đã giao / hủy / hoàn: chỉ ghi số đã trả (không còn gì để thu).
 */
function PaidNote({ order, className }: { order: OrderView; className?: string }) {
  if (!order.paid_amount) return null
  if (!OPEN_ORDER_STATUSES.includes(order.status)) {
    return <span className={cn('block text-xs font-normal text-muted-foreground', className)}>Đã trả {formatVND(order.paid_amount)}</span>
  }
  const due = amountDue(order)
  return (
    <span className={cn('block text-xs font-normal', due ? 'text-muted-foreground' : 'text-emerald-700', className)}>
      {due ? `Cọc ${formatVND(order.paid_amount)} · còn ${formatVND(due)}` : 'Đã thanh toán'}
    </span>
  )
}

function OrderCard({
  order,
  showGroup,
  selection,
}: {
  order: OrderView
  showGroup?: boolean
  selection?: OrderSelection
}) {
  const selected = selection?.isSelected(order.id)
  return (
    <li
      className={cn(
        'relative min-w-0 rounded-xl border bg-card p-3 shadow-xs transition-colors hover:bg-secondary/40',
        selected && 'border-primary ring-1 ring-primary',
      )}
    >
      <Link to={`/orders/${order.id}`} className="absolute inset-0 rounded-xl" aria-label={`Xem đơn ${order.order_code}`} />
      <div className="flex items-start justify-between gap-2">
        {selection && (
          <SelectCheckbox
            checked={!!selected}
            onChange={() => selection.toggle(order.id)}
            label={`Chọn đơn ${order.order_code}`}
            className="mr-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-muted-foreground">
            <span className="font-mono font-medium text-foreground">{order.order_code}</span> ·{' '}
            {formatDateTime(order.created_at)}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <span className="truncate font-semibold">{order.customer.name}</span>
            <CustomerRiskBadge history={order.customer_history} className="shrink-0" />
          </div>
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
      <PaidNote order={order} className="mt-0.5 text-right" />
      {order.note && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground italic">{order.note}</p>}
    </li>
  )
}

function OrderTable({
  orders,
  showGroup,
  selection,
}: {
  orders: OrderView[]
  showGroup?: boolean
  selection?: OrderSelection
}) {
  const selectedCount = selection ? orders.filter((o) => selection.isSelected(o.id)).length : 0
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
          <tr className="[&>th]:px-3 [&>th]:py-2.5 [&>th]:font-medium">
            {selection && (
              <th className="w-10">
                <SelectCheckbox
                  checked={selectedCount > 0 && selectedCount === orders.length}
                  indeterminate={selectedCount > 0}
                  onChange={() => selection.setMany(orders.map((o) => o.id), selectedCount !== orders.length)}
                  label="Chọn tất cả đơn đang hiện"
                />
              </th>
            )}
            <th>Đơn</th>
            <th>Khách hàng</th>
            <th>Size × SL</th>
            <th className="text-right">Thành tiền</th>
            <th>Trạng thái</th>
            <th>Giao hàng</th>
            <th className="hidden 2xl:table-cell">Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr
              key={o.id}
              className={cn(
                'relative border-b align-top last:border-0 hover:bg-secondary/40 [&>td]:px-3 [&>td]:py-2.5',
                selection?.isSelected(o.id) && 'bg-primary/5',
              )}
            >
              {selection && (
                <td>
                  <SelectCheckbox
                    checked={selection.isSelected(o.id)}
                    onChange={() => selection.toggle(o.id)}
                    label={`Chọn đơn ${o.order_code}`}
                  />
                </td>
              )}
              <td className="whitespace-nowrap">
                <Link to={`/orders/${o.id}`} className="font-mono text-xs font-medium after:absolute after:inset-0 hover:underline">
                  {o.order_code}
                </Link>
                <div className="text-xs text-muted-foreground">{formatDateTime(o.created_at)}</div>
                {showGroup && <div className="max-w-36 truncate text-xs text-muted-foreground">{o.group_name}</div>}
              </td>
              <td className="max-w-56">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-medium" title={o.customer.name}>{o.customer.name}</span>
                  <CustomerRiskBadge history={o.customer_history} className="relative z-10 shrink-0" />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 text-xs">
                  <PhoneLink phone={o.customer.phone} />
                  <FacebookLink url={o.customer.facebook_url} />
                </div>
                {o.customer.address && <div className="truncate text-xs text-muted-foreground">{o.customer.address}</div>}
              </td>
              <td>
                <ItemsText order={o} />
              </td>
              <td className="text-right font-semibold whitespace-nowrap tabular-nums">
                {formatVND(o.total_amount)}
                <PaidNote order={o} />
              </td>
              <td>
                <StatusSelect order={o} className="relative z-10" />
              </td>
              <td className="whitespace-nowrap">
                <GhnListAction order={o} compact />
              </td>
              <td className="hidden max-w-48 2xl:table-cell">
                <span className="line-clamp-2 text-muted-foreground">{o.note}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Trang hiện tại lưu trên URL (?page=) để mở đơn rồi quay lại vẫn đúng trang. */
function usePage(total: number) {
  const [params, setParams] = useSearchParams()
  const pageCount = Math.max(1, Math.ceil(total / PAGE))
  const raw = Number(params.get('page'))
  // Lọc bớt làm số trang giảm thì về trang cuối còn lại.
  const page = Number.isInteger(raw) && raw > 1 ? Math.min(raw, pageCount) : 1
  const setPage = (p: number) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (p > 1) next.set('page', String(p))
        else next.delete('page')
        return next
      },
      { replace: true },
    )
  return { page, pageCount, setPage }
}

function Pagination({
  page,
  pageCount,
  total,
  onChange,
}: {
  page: number
  pageCount: number
  total: number
  onChange: (page: number) => void
}) {
  if (pageCount <= 1) return null
  const from = (page - 1) * PAGE + 1
  const to = Math.min(total, page * PAGE)
  return (
    <nav className="flex flex-wrap items-center justify-between gap-2" aria-label="Phân trang">
      <span className="text-sm text-muted-foreground tabular-nums">
        {formatNumber(from)}–{formatNumber(to)} / {formatNumber(total)} đơn
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" disabled={page === 1} onClick={() => onChange(1)} aria-label="Trang đầu">
          <ChevronsLeft />
        </Button>
        <Button variant="outline" size="icon" disabled={page === 1} onClick={() => onChange(page - 1)} aria-label="Trang trước">
          <ChevronLeft />
        </Button>
        <span className="min-w-20 text-center text-sm font-medium tabular-nums">
          Trang {page}/{pageCount}
        </span>
        <Button variant="outline" size="icon" disabled={page === pageCount} onClick={() => onChange(page + 1)} aria-label="Trang sau">
          <ChevronRight />
        </Button>
        <Button variant="outline" size="icon" disabled={page === pageCount} onClick={() => onChange(pageCount)} aria-label="Trang cuối">
          <ChevronsRight />
        </Button>
      </div>
    </nav>
  )
}

/** Card trên điện thoại, bảng trên desktop; chia trang để danh sách dài vẫn mượt. */
export function OrderList({
  orders,
  showGroup,
  selection,
  className,
}: {
  orders: OrderView[]
  showGroup?: boolean
  /** Có = hiện ô chọn để thao tác hàng loạt. */
  selection?: OrderSelection
  className?: string
}) {
  const { page, pageCount, setPage } = usePage(orders.length)
  const top = useRef<HTMLDivElement>(null)
  const scrollPending = useRef(false)
  const visible = orders.slice((page - 1) * PAGE, page * PAGE)
  const goTo = (p: number) => {
    scrollPending.current = true
    setPage(p)
  }
  // Cuộn sau khi trang mới đã vẽ xong (cuộn ngay lúc bấm thì bị lần vẽ lại làm mất).
  useEffect(() => {
    if (!scrollPending.current) return
    scrollPending.current = false
    const el = top.current
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' })
  }, [page])
  return (
    // scroll-mt: chừa chỗ cho thanh tiêu đề dính trên điện thoại.
    <div ref={top} className={cn('grid min-w-0 scroll-mt-20 gap-3 md:scroll-mt-4', className)}>
      {selection && (
        <div className="-my-1 flex items-center xl:hidden">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const allOn = visible.every((o) => selection.isSelected(o.id))
              selection.setMany(visible.map((o) => o.id), !allOn)
            }}
          >
            {visible.every((o) => selection.isSelected(o.id)) ? 'Bỏ chọn tất cả' : `Chọn tất cả ${visible.length} đơn đang hiện`}
          </Button>
        </div>
      )}
      <ul className="grid min-w-0 gap-3 md:grid-cols-2 xl:hidden">
        {visible.map((o) => (
          <OrderCard key={o.id} order={o} showGroup={showGroup} selection={selection} />
        ))}
      </ul>
      <div className="hidden min-w-0 xl:block">
        <OrderTable orders={visible} showGroup={showGroup} selection={selection} />
      </div>
      <Pagination page={page} pageCount={pageCount} total={orders.length} onChange={goTo} />
    </div>
  )
}
