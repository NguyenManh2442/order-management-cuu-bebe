import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Printer, Truck, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ORDER_STATUS_LABELS, type OrderStatus } from '@shared/constants'
import { isActiveShipment, SHIPPABLE_STATUSES } from '@shared/ghn'
import type { Order, OrderView } from '@shared/types'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DropdownMenu } from '@/components/ui/dropdown'
import { api, errorMessage } from '@/lib/api'
import { bulkShipmentInput } from '@/lib/ghn-defaults'
import { keys, useBulkOrderStatus, useBulkPrintGhn, useConfig } from '@/lib/queries'
import { cn, formatVND } from '@/lib/utils'
import { ORDER_STATUS_OPTIONS } from './status'

export interface OrderSelection {
  isSelected: (id: string) => boolean
  toggle: (id: string) => void
  setMany: (ids: string[], on: boolean) => void
  clear: () => void
  /** Các đơn đang chọn, chỉ trong danh sách đang hiển thị (đổi bộ lọc thì đơn bị ẩn không còn tính). */
  selected: OrderView[]
}

export function useOrderSelection(orders: OrderView[]): OrderSelection {
  const [ids, setIds] = useState<Set<string>>(new Set())
  const selected = useMemo(() => orders.filter((o) => ids.has(o.id)), [orders, ids])
  return {
    isSelected: (id) => ids.has(id),
    toggle: (id) =>
      setIds((prev) => {
        const next = new Set(prev)
        if (!next.delete(id)) next.add(id)
        return next
      }),
    setMany: (list, on) =>
      setIds((prev) => {
        const next = new Set(prev)
        for (const id of list) {
          if (on) next.add(id)
          else next.delete(id)
        }
        return next
      }),
    clear: () => setIds(new Set()),
    selected,
  }
}

export function SelectCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
  className,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
  label: string
  className?: string
}) {
  return (
    // Vùng bấm lớn (44px) cho điện thoại; nằm trên link phủ của card.
    <label className={cn('relative z-10 -m-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center', className)}>
      <input
        type="checkbox"
        className="size-5 cursor-pointer accent-primary"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate && !checked
        }}
        onChange={onChange}
        onClick={(e) => e.stopPropagation()}
        aria-label={label}
      />
    </label>
  )
}

/** Thanh thao tác cho các đơn đã chọn — nổi ở đáy màn hình (trên thanh điều hướng của điện thoại). */
export function BulkActionBar({ selection }: { selection: OrderSelection }) {
  const { data: config } = useConfig()
  const bulkStatus = useBulkOrderStatus()
  const print = useBulkPrintGhn()
  /** Đơn đã chọn lúc mở hộp thoại — giữ cố định để danh sách tải lại giữa chừng không đổi tập đơn. */
  const [pendingStatus, setPendingStatus] = useState<{ status: OrderStatus; orders: OrderView[] } | null>(null)
  const [ghnOrders, setGhnOrders] = useState<OrderView[] | null>(null)
  const { selected } = selection
  const printable = selected.filter(isActiveShipment)

  const runStatus = ({ status, orders }: { status: OrderStatus; orders: OrderView[] }) =>
    bulkStatus.mutate(
      { orders, status },
      {
        onSuccess: (r) => {
          setPendingStatus(null)
          if (r.updated) toast.success(`Đã chuyển ${r.updated} đơn sang "${ORDER_STATUS_LABELS[status]}"`)
          else if (!r.skipped.length) toast.info('Các đơn đã ở trạng thái này')
          if (r.skipped.length) {
            toast.warning(`${r.skipped.length} đơn chưa đổi`, {
              description: r.skipped.map((s) => `${s.order_code || 'Đơn đã xóa'}: ${s.reason}`).join('\n'),
              duration: 10000,
            })
          }
          // Giữ lại các đơn chưa đổi được để người bán xử lý tiếp.
          selection.clear()
          selection.setMany(r.skipped.map((x) => x.id), true)
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    )

  const onPrint = () => {
    // Mở tab ngay khi bấm để trình duyệt không chặn popup, có link rồi mới chuyển trang.
    const win = window.open('', '_blank')
    if (win) win.opener = null
    print.mutate(
      printable.map((o) => o.id),
      {
        onSuccess: ({ url, count, skipped }) => {
          if (win) win.location.href = url
          else window.location.href = url
          toast.success(`Đã mở trang in ${count} nhãn${skipped.length ? `, bỏ qua ${skipped.length} đơn` : ''}`)
        },
        onError: (err) => {
          win?.close()
          toast.error(errorMessage(err))
        },
      },
    )
  }

  return (
    <>
      {selected.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 px-3 md:bottom-4 md:left-60">
          <div className="pointer-events-auto mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border bg-card p-2 shadow-xl">
            <span className="px-2 text-sm font-semibold whitespace-nowrap">Đã chọn {selected.length}</span>
            <DropdownMenu<OrderStatus | ''>
              value=""
              options={ORDER_STATUS_OPTIONS}
              minWidth={190}
              disabled={bulkStatus.isPending}
              onChange={(s) => s && setPendingStatus({ status: s, orders: selected })}
              renderTrigger={({ ref, open, buttonProps }) => (
                <Button ref={ref} variant="outline" size="sm" {...buttonProps} loading={bulkStatus.isPending}>
                  Đổi trạng thái <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
                </Button>
              )}
            />
            {config?.ghn && (
              <Button variant="ghn-soft" size="sm" onClick={() => setGhnOrders(selected)}>
                <Truck /> Gửi GHN
              </Button>
            )}
            {config?.ghn && printable.length > 0 && (
              <Button variant="violet" size="sm" onClick={onPrint} loading={print.isPending}>
                <Printer /> In {printable.length} nhãn
              </Button>
            )}
            <Button variant="ghost" size="sm" className="ml-auto" onClick={selection.clear} aria-label="Bỏ chọn">
              <X /> <span className="hidden sm:inline">Bỏ chọn</span>
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingStatus}
        onOpenChange={(o) => !o && setPendingStatus(null)}
        title={`Chuyển ${pendingStatus?.orders.length ?? 0} đơn sang "${pendingStatus ? ORDER_STATUS_LABELS[pendingStatus.status] : ''}"?`}
        description={
          pendingStatus?.status === 'cancelled'
            ? 'Đơn đã hủy không còn được tính vào số lượng đặt. Vận đơn GHN (nếu có) KHÔNG tự hủy — hủy riêng trong từng đơn.'
            : 'Đơn đã ở trạng thái này sẽ giữ nguyên. Đơn vừa bị người khác sửa sẽ được bỏ qua và báo lại.'
        }
        confirmLabel="Đổi trạng thái"
        destructive={pendingStatus?.status === 'cancelled'}
        loading={bulkStatus.isPending}
        onConfirm={() => pendingStatus && runStatus(pendingStatus)}
      />
      {ghnOrders && (
        <BulkGhnDialog
          orders={ghnOrders}
          onClose={(allOk) => {
            setGhnOrders(null)
            if (allOk) selection.clear()
          }}
        />
      )}
    </>
  )
}

type GhnResult = { order: OrderView; ok: boolean; message: string }

/**
 * Tạo vận đơn GHN cho nhiều đơn: chỉ đơn đã có địa chỉ GHN (khách cũ hoặc nháp đầy đủ).
 * Gửi lần lượt từng đơn qua đúng API tạo một vận đơn, nên mỗi đơn vẫn được kiểm tra như khi tạo tay.
 */

function BulkGhnDialog({ orders, onClose }: { orders: OrderView[]; onClose: (allOk: boolean) => void }) {
  const { data: config } = useConfig()
  const qc = useQueryClient()
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<GhnResult[] | null>(null)

  const plan = useMemo(() => {
    const ready: { order: OrderView; input: ReturnType<typeof bulkShipmentInput> & { ok: true } }[] = []
    const skipped: { order: OrderView; reason: string }[] = []
    for (const o of orders) {
      if (isActiveShipment(o)) skipped.push({ order: o, reason: `Đã có vận đơn ${o.ghn_order_code}` })
      else if (!SHIPPABLE_STATUSES.includes(o.status)) skipped.push({ order: o, reason: `Đơn đang "${ORDER_STATUS_LABELS[o.status]}"` })
      else if (!config?.ghn) skipped.push({ order: o, reason: 'Chưa thiết lập GHN' })
      else {
        const r = bulkShipmentInput(o, config.ghn)
        if (r.ok) ready.push({ order: o, input: r })
        else skipped.push({ order: o, reason: r.reason })
      }
    }
    return { ready, skipped }
  }, [orders, config])

  const totalCod = plan.ready.reduce((s, r) => s + r.input.input.cod_amount, 0)

  const run = async () => {
    setRunning(true)
    const out: GhnResult[] = []
    for (const { order, input } of plan.ready) {
      try {
        const created = await api.post<Order>(`/orders/${order.id}/ghn`, input.input)
        out.push({ order, ok: true, message: created.ghn_order_code })
      } catch (err) {
        out.push({ order, ok: false, message: errorMessage(err) })
      }
      setResults([...out])
    }
    setRunning(false)
    await Promise.all([keys.orders, keys.groups, keys.customers].map((queryKey) => qc.invalidateQueries({ queryKey })))
    const okCount = out.filter((r) => r.ok).length
    if (okCount) toast.success(`Đã tạo ${okCount} vận đơn GHN`)
  }

  const done = results !== null && !running
  const allOk = done && results.every((r) => r.ok)
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !running && onClose(allOk)}
      title={done ? 'Kết quả gửi GHN' : `Gửi ${plan.ready.length} đơn sang GHN?`}
      confirmVariant="ghn"
      confirmLabel={done ? 'Xong' : running ? `Đang gửi ${results?.length ?? 0}/${plan.ready.length}…` : 'Tạo vận đơn'}
      cancelLabel={done ? 'Đóng' : 'Quay lại'}
      loading={running}
      onConfirm={() => (done || !plan.ready.length ? onClose(allOk) : run())}
      description={
        <span className="grid max-h-[55vh] gap-3 overflow-y-auto text-left">
          {results ? (
            <span className="grid gap-1">
              {results.map((r) => (
                <span key={r.order.id} className={cn('block', r.ok ? 'text-emerald-700' : 'text-destructive')}>
                  <b className="font-mono">{r.order.order_code}</b>: {r.ok ? `vận đơn ${r.message}` : r.message}
                </span>
              ))}
            </span>
          ) : (
            <>
              {plan.ready.length > 0 && (
                <span className="block">
                  Dùng địa chỉ GHN đã lưu của khách (hoặc bản nháp) và thiết lập mặc định. Tổng thu hộ:{' '}
                  <b className="text-foreground">{formatVND(totalCod)}</b>. Phí ship tính theo bảng giá GHN.
                </span>
              )}
              {plan.skipped.length > 0 && (
                <span className="grid gap-1 rounded-lg bg-amber-50 p-2 text-amber-900">
                  <b>Bỏ qua {plan.skipped.length} đơn:</b>
                  {plan.skipped.map((s) => (
                    <span key={s.order.id} className="block">
                      <span className="font-mono">{s.order.order_code}</span> — {s.reason}
                    </span>
                  ))}
                </span>
              )}
              {!plan.ready.length && <span className="block">Không có đơn nào gửi được tự động.</span>}
            </>
          )}
        </span>
      }
    />
  )
}
