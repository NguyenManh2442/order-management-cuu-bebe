import { Check, ExternalLink, LoaderCircle, MapPin, PackageSearch, Truck } from 'lucide-react'
import { useEffect } from 'react'
import { useParams } from 'react-router'
import { ORDER_STATUS_LABELS, type OrderStatus } from '@shared/constants'
import { ghnStatusLabel } from '@shared/ghn'
import type { PublicOrderView } from '@shared/types'
import { sizeTone } from '@/components/stats'
import { STATUS_DOT, StatusBadge } from '@/components/status'
import { ApiError, errorMessage } from '@/lib/api'
import { usePublicOrder } from '@/lib/queries'
import { cn, formatDate, formatDateTime, formatNumber, formatVND } from '@/lib/utils'

const STEPS: OrderStatus[] = ['pending', 'confirmed', 'packing', 'shipping', 'delivered']

/** Viền sáng quanh bước hiện tại và màu chữ — cùng tông với màu từng trạng thái trong app. */
const STEP_RING: Partial<Record<OrderStatus, string>> = {
  pending: 'ring-amber-200',
  confirmed: 'ring-blue-200',
  packing: 'ring-violet-200',
  shipping: 'ring-cyan-200',
  delivered: 'ring-emerald-200',
}
const STEP_TEXT: Partial<Record<OrderStatus, string>> = {
  pending: 'text-amber-800',
  confirmed: 'text-blue-700',
  packing: 'text-violet-700',
  shipping: 'text-cyan-800',
  delivered: 'text-emerald-700',
}

/** Trang khách tự xem đơn qua link shop gửi — không cần đăng nhập. Hiện địa chỉ giao hàng, SĐT che bớt. */
export function TrackPage() {
  const token = useParams().token ?? ''
  const { data: o, isPending, error } = usePublicOrder(token)
  // Gửi chung một gói: hiện sản phẩm của mọi đơn trong gói (gộp theo nhóm), tiền tính cho cả gói.
  const bundled = !!o?.bundled_orders.length
  const blocks: { group_name: string; items: PublicOrderView['items'] }[] = []
  for (const b of o ? [o, ...o.bundled_orders] : []) {
    const same = blocks.find((x) => x.group_name === b.group_name)
    if (same) same.items = [...same.items, ...b.items]
    else blocks.push({ group_name: b.group_name, items: b.items })
  }
  const totalAmount = o ? o.bundled_orders.reduce((s, b) => s + b.total_amount, o.total_amount) : 0
  const paidAmount = o ? o.bundled_orders.reduce((s, b) => s + b.paid_amount, o.paid_amount) : 0

  useEffect(() => {
    document.title = o ? `Đơn ${o.order_code} — Nhà Cừu` : 'Tra cứu đơn hàng — Nhà Cừu'
    // Không để công cụ tìm kiếm lập chỉ mục trang đơn của khách.
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [o])

  return (
    <div className="mx-auto min-h-dvh max-w-lg px-4 py-6">
      <header className="mb-5 text-center">
        <div className="text-2xl font-bold tracking-tight">Đơn Hàng Nhà Cừu</div>
        <div className="text-sm text-muted-foreground">Theo dõi đơn hàng của bạn</div>
      </header>

      {isPending ? (
        <div className="flex justify-center py-16">
          <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-xl border bg-card p-6 text-center">
          <PackageSearch className="mx-auto size-10 text-muted-foreground/60" />
          <p className="mt-3 font-medium">
            {error instanceof ApiError && error.status === 404 ? 'Không tìm thấy đơn hàng' : 'Không tải được đơn hàng'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof ApiError && error.status === 404
              ? 'Link không đúng hoặc shop đã đổi link mới. Bạn nhắn shop để lấy lại link nhé.'
              : errorMessage(error)}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          <section className="rounded-xl border bg-card p-4 shadow-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Mã đơn</div>
                <div className="font-mono text-lg font-bold">{o.order_code}</div>
                <div className="text-sm text-muted-foreground">Đặt lúc {formatDateTime(o.created_at)}</div>
              </div>
              <StatusBadge status={o.status} className="shrink-0" />
            </div>
            <div className="mt-2 text-sm">
              <span className="text-base font-bold">{o.customer_name}</span> · {o.customer_phone_masked}
            </div>
            {o.delivery_address && (
              <p className="mt-1 flex gap-1.5 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 break-words">{o.delivery_address}</span>
              </p>
            )}
            {o.status === 'cancelled' || o.status === 'returned' ? (
              <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-sm">
                Đơn hàng {ORDER_STATUS_LABELS[o.status].toLowerCase()}. Nếu có nhầm lẫn, bạn nhắn shop giúp nhé.
              </p>
            ) : (
              <ol className="mt-4 grid grid-cols-5 gap-1" aria-label="Tiến trình đơn hàng">
                {STEPS.map((step, i) => {
                  const current = STEPS.indexOf(o.status)
                  const done = i <= current
                  return (
                    <li
                      key={step}
                      className="relative grid justify-items-center gap-1 text-center"
                      aria-current={i === current ? 'step' : undefined}
                    >
                      {/* Đường nối với bước trước, tô màu khi đã qua bước này. */}
                      {i > 0 && (
                        <span
                          aria-hidden
                          className={cn('absolute top-3.5 right-1/2 h-0.5 w-full -translate-y-1/2', done ? STATUS_DOT[step] : 'bg-border')}
                        />
                      )}
                      <span
                        className={cn(
                          'relative z-10 flex size-7 items-center justify-center rounded-full border text-xs font-semibold',
                          done ? cn('border-transparent text-white', STATUS_DOT[step]) : 'bg-card text-muted-foreground',
                          i === current && cn('ring-4', STEP_RING[step]),
                        )}
                      >
                        {i < current ? <Check className="size-4" /> : i + 1}
                      </span>
                      <span
                        className={cn(
                          'text-[11px] leading-tight',
                          i === current ? cn('font-semibold', STEP_TEXT[step]) : done ? 'font-medium' : 'text-muted-foreground',
                        )}
                      >
                        {ORDER_STATUS_LABELS[step]}
                      </span>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          {o.shipment && (
            <section className="rounded-xl border bg-card p-4 shadow-xs">
              <h2 className="flex items-center gap-2 font-semibold">
                <Truck className="size-4" /> Giao Hàng Nhanh
              </h2>
              <dl className="mt-2 grid gap-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Mã vận đơn</dt>
                  <dd className="font-mono font-medium">{o.shipment.code}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Trạng thái</dt>
                  <dd>{ghnStatusLabel(o.shipment.status)}</dd>
                </div>
                {o.shipment.expected_delivery && o.status !== 'delivered' && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Dự kiến giao</dt>
                    <dd>{formatDate(o.shipment.expected_delivery)}</dd>
                  </div>
                )}
              </dl>
              <a
                href={o.shipment.tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex h-11 items-center justify-center gap-2 rounded-lg bg-orange-500 text-sm font-medium text-white hover:bg-orange-600"
              >
                Xem hành trình trên GHN <ExternalLink className="size-4" />
              </a>
            </section>
          )}

          <section className="rounded-xl border bg-card p-4 shadow-xs">
            {bundled ? (
              <>
                <h2 className="font-semibold">Sản phẩm trong gói hàng</h2>
                {blocks.map((b, i) => (
                  <div key={i} className="mt-3">
                    <h3 className="text-sm font-medium text-muted-foreground">{b.group_name || 'Sản phẩm'}</h3>
                    <ItemList items={b.items} />
                  </div>
                ))}
              </>
            ) : (
              <>
                <h2 className="font-semibold">{o.group_name || 'Sản phẩm'}</h2>
                <ItemList items={o.items} className="mt-2" />
              </>
            )}
            <dl className="mt-2 grid gap-1 border-t pt-3 text-sm">
              <div className="flex justify-between">
                <dt>Tổng tiền hàng</dt>
                <dd className="font-medium tabular-nums">{formatVND(totalAmount)}</dd>
              </div>
              {paidAmount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <dt>Đã thanh toán</dt>
                  <dd className="tabular-nums">− {formatVND(paidAmount)}</dd>
                </div>
              )}
            </dl>
            {o.status !== 'cancelled' && o.status !== 'returned' && (
              <div className="mt-3 flex items-center justify-between rounded-lg bg-secondary px-3 py-3">
                <span className="text-sm font-medium">
                  {o.amount_due ? (o.shipment ? 'Trả khi nhận hàng' : 'Còn phải trả') : 'Thanh toán'}
                </span>
                <span className="text-xl font-bold tabular-nums">{o.amount_due ? formatVND(o.amount_due) : 'Đã đủ ✓'}</span>
              </div>
            )}
            {o.shipment && o.amount_due > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Phí ship (nếu có) do nhân viên giao hàng báo khi giao.</p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function ItemList({ items, className }: { items: PublicOrderView['items']; className?: string }) {
  return (
    <ul className={cn('divide-y', className)}>
      {items.map((it, i) => (
        <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
          <span className="min-w-0">
            <span className="block truncate">{it.product_name}</span>
            <span className="text-muted-foreground">
              <span className={cn('mr-1.5 inline-flex rounded-md border px-1.5 text-xs font-bold', sizeTone(it.size))}>{it.size}</span>
              {formatNumber(it.quantity)} × {formatVND(it.unit_price)}
            </span>
          </span>
          <span className="shrink-0 font-medium tabular-nums">{formatVND(it.line_total)}</span>
        </li>
      ))}
    </ul>
  )
}
