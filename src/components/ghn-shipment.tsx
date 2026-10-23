import { ExternalLink, FileText, Printer, RefreshCw, Truck, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import {
  GHN_CANCELLABLE_STATUSES,
  ghnStatusLabel,
  ghnTrackingUrl,
  isActiveShipment,
  SHIPPABLE_STATUSES,
} from '@shared/ghn'
import type { Order } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { errorMessage } from '@/lib/api'
import { useCancelGhnShipment, useConfig, usePrintGhnLabel, useSyncGhnShipment } from '@/lib/queries'
import { cn, formatDate, formatDateTime, formatVND } from '@/lib/utils'

function ghnTone(status: string): string {
  if (status === 'delivered') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'cancel') return 'bg-zinc-100 text-zinc-600 border-zinc-200'
  if (['delivery_fail', 'return_fail', 'exception', 'lost', 'damage', 'scrap'].includes(status)) {
    return 'bg-rose-50 text-rose-700 border-rose-200'
  }
  if (status.includes('return')) return 'bg-orange-50 text-orange-800 border-orange-200'
  return 'bg-cyan-50 text-cyan-800 border-cyan-200'
}

export function GhnStatusBadge({ status, className }: { status: string; className?: string }) {
  return <Badge className={cn(ghnTone(status), className)}>{ghnStatusLabel(status)}</Badge>
}


/**
 * Trong danh sách đơn: có vận đơn thì hiện mã + trạng thái, chưa có thì hiện nút "Tạo đơn GHN"
 * (chưa thiết lập GHN thì trang tạo đơn hiện form thiết lập trước).
 */
export function GhnListAction({ order, compact, className }: { order: Order; compact?: boolean; className?: string }) {
  if (isActiveShipment(order) || !SHIPPABLE_STATUSES.includes(order.status)) {
    return <GhnInline order={order} stacked={compact} className={className} />
  }
  const label = order.ghn_draft ? 'Tiếp tục nháp GHN' : order.ghn_order_code ? 'Tạo lại đơn GHN' : 'Tạo đơn GHN'
  return (
    <Button asChild size="sm" variant={order.ghn_draft ? 'info' : 'ghn-soft'} className={cn('relative z-10 h-8 px-2.5 text-xs', className)}>
      <Link to={`/orders/${order.id}/ship`} title={label} onClick={(e) => e.stopPropagation()}>
        {order.ghn_draft ? <FileText /> : <Truck />}
        {compact ? (order.ghn_draft ? 'Nháp' : 'Gửi GHN') : label}
      </Link>
    </Button>
  )
}

/** Mã vận đơn + trạng thái GHN thu gọn, dùng trong danh sách đơn. */
export function GhnInline({
  order,
  stacked,
  className,
}: {
  order: Pick<Order, 'ghn_order_code' | 'ghn_status'>
  /** Trạng thái xuống dòng dưới mã vận đơn (cột hẹp trong bảng). */
  stacked?: boolean
  className?: string
}) {
  if (!order.ghn_order_code) return null
  return (
    <span
      className={cn(
        'inline-flex gap-1.5 text-xs text-muted-foreground',
        stacked ? 'flex-col items-start gap-1' : 'items-center',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <Truck className="size-3.5 shrink-0" />
        <span className="font-mono">{order.ghn_order_code}</span>
      </span>
      <GhnStatusBadge status={order.ghn_status} className="px-1.5 py-0" />
    </span>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right break-words">{children}</span>
    </div>
  )
}

export function GhnShipmentCard({ order }: { order: Order & { ghn_bundle?: string[] } }) {
  const { data: config } = useConfig()
  const sync = useSyncGhnShipment()
  const cancel = useCancelGhnShipment()
  const print = usePrintGhnLabel()
  const [confirmCancel, setConfirmCancel] = useState(false)

  if (!config) return null
  const enabled = !!config.ghn
  const active = isActiveShipment(order)
  const canCreate = !active && order.status !== 'cancelled'
  /** Đơn khác cùng gói hàng (gửi chung vận đơn). */
  const bundle = active ? (order.ghn_bundle ?? []) : []
  /** Đơn gửi kèm (không phải đơn đã tạo vận đơn): phí ship ghi ở đơn chính. */
  const isCompanion = bundle.length > 0 && order.ghn_client_code.replace(/-R\d+$/, '') !== order.order_code

  const onPrint = () => {
    // Mở tab ngay trong lúc bấm để trình duyệt không chặn popup, rồi mới gán link khi có token.
    const win = window.open('', '_blank')
    if (win) win.opener = null
    print.mutate(order.id, {
      onSuccess: ({ url }) => {
        if (win) win.location.href = url
        else window.location.href = url
      },
      onError: (err) => {
        win?.close()
        toast.error(errorMessage(err))
      },
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="size-4" /> Giao Hàng Nhanh
        </CardTitle>
        {order.ghn_order_code && <GhnStatusBadge status={order.ghn_status} />}
      </CardHeader>
      <CardContent className="grid gap-3">
        {order.ghn_order_code && (
          <div className={cn('grid gap-1.5', !active && 'opacity-60')}>
            <Row label="Mã vận đơn">
              <a
                href={ghnTrackingUrl(order.ghn_order_code)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono font-medium text-blue-700 hover:underline"
              >
                {order.ghn_order_code} <ExternalLink className="size-3.5" />
              </a>
            </Row>
            {bundle.length > 0 && <Row label="Gửi chung với">{bundle.join(', ')}</Row>}
            <Row label="Phí ship">{isCompanion ? 'Ghi ở đơn chính của gói' : formatVND(order.ghn_fee)}</Row>
            <Row label={bundle.length ? 'Thu hộ (phần đơn này)' : 'Thu hộ (COD)'}>{formatVND(order.ghn_cod_amount)}</Row>
            {order.ghn_expected_delivery && active && <Row label="Giao dự kiến">{formatDate(order.ghn_expected_delivery)}</Row>}
            {order.ghn_to_address && <Row label="Giao đến">{order.ghn_to_address}</Row>}
            {order.ghn_status_at && <Row label="GHN cập nhật">{formatDateTime(order.ghn_status_at)}</Row>}
          </div>
        )}

        {active && enabled && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="info"
              loading={sync.isPending}
              onClick={() =>
                sync.mutate(order.id, {
                  onSuccess: (o) => toast.success(`GHN: ${ghnStatusLabel(o.ghn_status)}`),
                  onError: (err) => toast.error(errorMessage(err)),
                })
              }
            >
              <RefreshCw /> Cập nhật
            </Button>
            <Button variant="violet" loading={print.isPending} onClick={onPrint}>
              <Printer /> In nhãn
            </Button>
            {GHN_CANCELLABLE_STATUSES.includes(order.ghn_status) && (
              <Button variant="destructive-outline" className="col-span-2" onClick={() => setConfirmCancel(true)}>
                <XCircle /> Hủy vận đơn
              </Button>
            )}
          </div>
        )}

        {canCreate && (
          <>
            {order.ghn_status === 'cancel' && (
              <p className="text-sm text-muted-foreground">Vận đơn trên đã hủy. Có thể tạo vận đơn mới.</p>
            )}
            <Button asChild variant={order.ghn_draft ? 'info' : 'ghn'} size="lg" className="md:h-10 md:text-sm">
              <Link to={`/orders/${order.id}/ship`}>
                {order.ghn_draft ? <FileText /> : <Truck />}
                {!enabled
                  ? 'Thiết lập & tạo đơn GHN'
                  : order.ghn_draft
                    ? 'Tiếp tục nháp GHN'
                    : order.ghn_order_code
                      ? 'Tạo lại đơn GHN'
                      : 'Tạo đơn GHN'}
              </Link>
            </Button>
          </>
        )}
        {!enabled && active && (
          <p className="text-sm text-muted-foreground">
            GHN chưa được thiết lập nên không cập nhật được.{' '}
            <Link to="/settings/ghn" className="text-blue-700 hover:underline">
              Thiết lập
            </Link>
          </p>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={`Hủy vận đơn ${order.ghn_order_code}?`}
        description={
          (bundle.length ? `Vận đơn này gửi chung với ${bundle.join(', ')} — các đơn đó cũng về chưa gửi. ` : '') +
          'GHN sẽ không đến lấy hàng nữa. Đơn hàng trong app vẫn giữ, có thể tạo vận đơn mới sau.'
        }
        confirmLabel="Hủy vận đơn"
        cancelLabel="Quay lại"
        destructive
        loading={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(order, {
            onSuccess: () => {
              toast.success('Đã hủy vận đơn GHN')
              setConfirmCancel(false)
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
    </Card>
  )
}
