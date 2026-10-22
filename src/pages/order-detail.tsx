import { Ban, MapPin, MessageCircle, Pencil, Phone, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { codMismatch } from '@shared/ghn'
import { OPEN_ORDER_STATUSES, amountDueNow } from '@shared/stats'
import { CustomerRiskBanner } from '@/components/customer-risk'
import { GhnShipmentCard } from '@/components/ghn-shipment'
import { PageHeader } from '@/components/page-header'
import { PublicLinkCard } from '@/components/public-link'
import { sizeTone } from '@/components/stats'
import { ErrorState, ListSkeleton } from '@/components/states'
import { StatusSelect } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { errorMessage } from '@/lib/api'
import { useDeleteOrder, useOrder, useUpdateOrderStatus } from '@/lib/queries'
import { cn, formatDateTime, formatNumber, formatVND } from '@/lib/utils'

export function OrderDetailPage() {
  const id = useParams().id!
  const navigate = useNavigate()
  const { data: order, isPending, error, refetch } = useOrder(id)
  const cancel = useUpdateOrderStatus()
  const remove = useDeleteOrder()
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null)

  if (isPending) return <ListSkeleton rows={3} />
  if (error) return <ErrorState error={error} onRetry={refetch} />

  const c = order.customer
  const isOpen = OPEN_ORDER_STATUSES.includes(order.status)
  return (
    <>
      <PageHeader
        title={<span className="font-mono">{order.order_code}</span>}
        subtitle={formatDateTime(order.created_at)}
        back={`/groups/${order.group_id}`}
        actions={
          <Button asChild variant="outline">
            <Link to={`/orders/${id}/edit`}>
              <Pencil /> Sửa
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div className="grid min-w-0 gap-4">
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Trạng thái — bấm để đổi</div>
                <StatusSelect order={order} size="lg" className="mt-1" />
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Tổng tiền</div>
                <div className="text-2xl font-bold tabular-nums">{formatVND(order.total_amount)}</div>
                {order.paid_amount > 0 && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Đã trả {formatVND(order.paid_amount)}</span>
                    {isOpen && (amountDueNow(order) ? (
                      <b className="tabular-nums"> · còn thu {formatVND(amountDueNow(order))}</b>
                    ) : (
                      <b className="text-emerald-700"> · đã thanh toán đủ</b>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sản phẩm</CardTitle>
              <Link to={`/groups/${order.group_id}`} className="truncate text-sm text-blue-700 hover:underline">
                {order.group_name}
              </Link>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {order.items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{it.product_name}</div>
                      <div className="text-sm text-muted-foreground">
                        <span className={cn('mr-1.5 inline-flex rounded-md border px-1.5 py-0.5 text-xs font-bold', sizeTone(it.size))}>
                          {it.size}
                        </span>
                        {formatNumber(it.quantity)} × {formatVND(it.unit_price)}
                      </div>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums">{formatVND(it.line_total)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex justify-between border-t pt-3 font-semibold">
                <span>Tổng cộng</span>
                <span className="tabular-nums">{formatVND(order.total_amount)}</span>
              </div>
              {order.paid_amount > 0 && (
                <>
                  <div className="mt-1 flex justify-between text-sm text-muted-foreground">
                    <span>Đã cọc / chuyển khoản</span>
                    <span className="tabular-nums">− {formatVND(order.paid_amount)}</span>
                  </div>
                  {isOpen && (
                    <div className="mt-1 flex justify-between font-semibold">
                      <span>Còn phải thu</span>
                      <span className="tabular-nums">{formatVND(amountDueNow(order))}</span>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {order.note && (
            <Card>
              <CardHeader>
                <CardTitle>Ghi chú</CardTitle>
              </CardHeader>
              <CardContent className="text-sm whitespace-pre-line">{order.note}</CardContent>
            </Card>
          )}
        </div>

        <div className="grid min-w-0 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Khách hàng</CardTitle>
              <Link to={`/customers/${c.id}`} className="text-sm text-blue-700 hover:underline">
                Lịch sử đơn
              </Link>
            </CardHeader>
            <CardContent className="grid gap-3">
              <CustomerRiskBanner history={order.customer_history} />
              <div>
                <div className="font-semibold">{c.name}</div>
                <div className="text-sm text-muted-foreground">{c.phone}</div>
              </div>
              {c.address && (
                <p className="flex gap-2 text-sm">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 break-words">{c.address}</span>
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button asChild size="lg" className="md:h-10 md:text-sm">
                  <a href={`tel:${c.phone}`}>
                    <Phone /> Gọi điện
                  </a>
                </Button>
                {c.facebook_url ? (
                  <Button asChild size="lg" variant="outline" className="md:h-10 md:text-sm">
                    <a href={c.facebook_url} target="_blank" rel="noopener noreferrer">
                      <MessageCircle /> Facebook
                    </a>
                  </Button>
                ) : (
                  <Button size="lg" variant="outline" disabled className="md:h-10 md:text-sm">
                    Chưa có FB
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {codMismatch(order) && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <b>Thu hộ trên GHN ({formatVND(order.ghn_cod_amount)}) khác số còn phải thu ({formatVND(amountDueNow(order))}).</b>{' '}
              Sửa đơn trong app không cập nhật sang GHN — sửa COD trên trang GHN, hoặc hủy vận đơn rồi tạo lại.
            </div>
          )}
          <GhnShipmentCard order={order} />
          <PublicLinkCard order={order} />

          <div className="grid gap-2 text-xs text-muted-foreground">
            <span>Tạo lúc: {formatDateTime(order.created_at)}</span>
            <span>Cập nhật: {formatDateTime(order.updated_at)}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={order.status === 'cancelled'} onClick={() => setConfirm('cancel')}>
              <Ban /> Hủy đơn
            </Button>
            <Button variant="destructive-outline" onClick={() => setConfirm('delete')}>
              <Trash2 /> Xóa đơn
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Hủy đơn ${order.order_code}?`}
        description="Đơn chuyển sang trạng thái Đã hủy và không còn được tính vào số lượng đặt. Có thể đổi lại trạng thái sau."
        confirmLabel="Hủy đơn"
        destructive
        loading={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(
            { order, status: 'cancelled' },
            {
              onSuccess: () => {
                toast.success('Đã hủy đơn')
                setConfirm(null)
              },
              onError: (err) => toast.error(errorMessage(err)),
            },
          )
        }
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Xóa vĩnh viễn đơn ${order.order_code}?`}
        description="Đơn sẽ bị xóa khỏi Google Sheets và không khôi phục được. Nếu chỉ là khách không lấy hàng, nên dùng Hủy đơn."
        confirmLabel="Xóa vĩnh viễn"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(order, {
            onSuccess: () => {
              toast.success(`Đã xóa đơn ${order.order_code}`)
              navigate(`/groups/${order.group_id}`, { replace: true })
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
    </>
  )
}
