import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, PackageMinus, PackagePlus, Printer, Truck, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ORDER_STATUS_LABELS, type OrderStatus } from '@shared/constants'
import { isActiveShipment, SHIPPABLE_STATUSES } from '@shared/ghn'
import { normalizeSize } from '@shared/phone'
import { sortSizes } from '@shared/stats'
import type { Order, OrderView } from '@shared/types'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DropdownMenu } from '@/components/ui/dropdown'
import { api, errorMessage } from '@/lib/api'
import { bulkShipmentInput } from '@/lib/ghn-defaults'
import { Input, Label } from '@/components/ui/input'
import { keys, useBatches, useBatchOrders, useBulkOrderStatus, useBulkPrintGhn, useConfig, useCreateBatch, useSetPrinted } from '@/lib/queries'
import { cn, formatVND } from '@/lib/utils'
import { sizeTone } from './stats'
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

/**
 * In nhãn GHN của các đơn (đơn gửi chung chỉ in một nhãn); máy chủ ghi dấu "đã in" cho đơn.
 * Mở tab ngay khi bấm để trình duyệt không chặn popup, có link rồi mới chuyển trang.
 */
export function usePrintLabels() {
  const print = useBulkPrintGhn()
  const run = (orders: OrderView[], onDone?: () => void) => {
    const win = window.open('', '_blank')
    if (win) win.opener = null
    print.mutate(
      orders.map((o) => o.id),
      {
        onSuccess: ({ url, count, skipped }) => {
          if (win) win.location.href = url
          else window.location.href = url
          toast.success(`Đã mở trang in ${count} nhãn${skipped.length ? `, bỏ qua ${skipped.length} đơn` : ''}`)
          onDone?.()
        },
        onError: (err) => {
          win?.close()
          toast.error(errorMessage(err))
        },
      },
    )
  }
  return { run, isPending: print.isPending }
}

type PrintMark = '' | 'printed' | 'unprinted'
const PRINT_MARK_OPTIONS = [
  { value: 'printed' as const, label: 'Đánh dấu đã in', description: 'Đã in tay / in ngoài app' },
  { value: 'unprinted' as const, label: 'Đánh dấu chưa in', description: 'Cần in lại' },
]

/**
 * Thanh thao tác cho các đơn đã chọn — nổi ở đáy màn hình (trên thanh điều hướng của điện thoại).
 * batchId: đang xem trong một lô xuất → nút "Bỏ khỏi lô" thay cho "Vào lô".
 */
export function BulkActionBar({ selection, batchId }: { selection: OrderSelection; batchId?: string }) {
  const { data: config } = useConfig()
  const bulkStatus = useBulkOrderStatus()
  const print = usePrintLabels()
  const setPrinted = useSetPrinted()
  const batchOrders = useBatchOrders()
  /** Đơn đã chọn lúc mở hộp thoại — giữ cố định để danh sách tải lại giữa chừng không đổi tập đơn. */
  const [pendingStatus, setPendingStatus] = useState<{ status: OrderStatus; orders: OrderView[] } | null>(null)
  const [ghnOrders, setGhnOrders] = useState<OrderView[] | null>(null)
  const [batchFor, setBatchFor] = useState<OrderView[] | null>(null)
  const { selected } = selection
  const printable = selected.filter(isActiveShipment)

  const markPrinted = (mark: PrintMark) =>
    mark &&
    setPrinted.mutate(
      { order_ids: selected.map((o) => o.id), printed: mark === 'printed' },
      {
        onSuccess: (r) =>
          toast.success(
            r.changed
              ? `Đã đánh dấu ${r.changed} đơn ${mark === 'printed' ? 'đã in' : 'chưa in'}`
              : `Các đơn đã ở trạng thái ${mark === 'printed' ? 'đã in' : 'chưa in'}`,
          ),
        onError: (err) => toast.error(errorMessage(err)),
      },
    )

  const removeFromBatch = () =>
    batchId &&
    batchOrders.mutate(
      { batchId, action: 'remove', order_ids: selected.map((o) => o.id) },
      {
        onSuccess: (r) => {
          toast.success(`Đã bỏ ${r.changed} đơn khỏi lô`)
          selection.clear()
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    )
  /** Tổng số lượng từng size của các đơn đang chọn (để soạn / đặt hàng theo lô). */
  const sizeTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const o of selected) {
      for (const it of o.items) {
        const size = normalizeSize(it.size)
        totals.set(size, (totals.get(size) ?? 0) + it.quantity)
      }
    }
    const sizes = sortSizes(totals.keys(), config?.sizes ?? [])
    return { sizes: sizes.map((size) => ({ size, quantity: totals.get(size)! })), total: [...totals.values()].reduce((a, b) => a + b, 0) }
  }, [selected, config])

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
              <Button variant="violet" size="sm" onClick={() => print.run(printable)} loading={print.isPending}>
                <Printer /> In {printable.length} nhãn
              </Button>
            )}
            <DropdownMenu<PrintMark>
              value=""
              options={PRINT_MARK_OPTIONS}
              minWidth={200}
              disabled={setPrinted.isPending}
              onChange={markPrinted}
              renderTrigger={({ ref, open, buttonProps }) => (
                <Button ref={ref} variant="outline" size="sm" {...buttonProps} loading={setPrinted.isPending}>
                  Đã in? <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
                </Button>
              )}
            />
            {batchId ? (
              <Button variant="outline" size="sm" onClick={removeFromBatch} loading={batchOrders.isPending}>
                <PackageMinus /> Bỏ khỏi lô
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setBatchFor(selected)}>
                <PackagePlus /> Vào lô xuất
              </Button>
            )}
            <Button variant="ghost" size="sm" className="ml-auto" onClick={selection.clear} aria-label="Bỏ chọn">
              <X /> <span className="hidden sm:inline">Bỏ chọn</span>
            </Button>
            {sizeTotals.total > 0 && (
              <div className="flex w-full flex-wrap items-center gap-1 border-t px-2 pt-2" aria-label="Số lượng theo size của các đơn đã chọn">
                {sizeTotals.sizes.map(({ size, quantity }) => (
                  <span
                    key={size}
                    className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs whitespace-nowrap tabular-nums', sizeTone(size))}
                  >
                    <b className="font-bold">{size}</b>
                    <span className="opacity-70">×</span>
                    <b className="font-bold">{quantity.toLocaleString('vi-VN')}</b>
                  </span>
                ))}
                <span className="ml-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  Tổng SL: <b className="text-foreground">{sizeTotals.total.toLocaleString('vi-VN')}</b>
                </span>
              </div>
            )}
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
      {batchFor && (
        <AssignBatchDialog
          orders={batchFor}
          onClose={(ok) => {
            setBatchFor(null)
            if (ok) selection.clear()
          }}
        />
      )}
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
export function BulkGhnDialog({ orders, onClose }: { orders: OrderView[]; onClose: (allOk: boolean) => void }) {
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
    await Promise.all([keys.orders, keys.groups, keys.customers, keys.batches].map((queryKey) => qc.invalidateQueries({ queryKey })))
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

const NEW_BATCH = '__new__'

/**
 * Đưa các đơn đã chọn vào một lô xuất đang mở, hoặc tạo lô mới.
 * Mỗi đơn chỉ thuộc một lô: đơn đang ở lô khác sẽ được chuyển sang (báo trước).
 */
function AssignBatchDialog({ orders, onClose }: { orders: OrderView[]; onClose: (ok: boolean) => void }) {
  const navigate = useNavigate()
  const { data: batches, isPending: loading } = useBatches()
  const create = useCreateBatch()
  const add = useBatchOrders()
  const open = useMemo(() => (batches ?? []).filter((b) => b.status === 'open'), [batches])
  const [choice, setChoice] = useState<string>('')
  const [note, setNote] = useState('')
  const target = choice || (loading ? '' : NEW_BATCH)
  const elsewhere = orders.filter((o) => o.batch_id && o.batch_id !== target)
  const busy = create.isPending || add.isPending

  const done = (code: string, id: string, moved: number) => {
    toast.success(`Đã đưa ${orders.length} đơn vào lô ${code}${moved ? ` (chuyển ${moved} đơn từ lô khác)` : ''}`, {
      action: { label: 'Mở lô', onClick: () => navigate(`/batches/${id}`) },
    })
    onClose(true)
  }

  const submit = () => {
    const ids = orders.map((o) => o.id)
    if (target === NEW_BATCH) {
      create.mutate(
        { note, order_ids: ids },
        { onSuccess: (b) => done(b.code, b.id, elsewhere.length), onError: (err) => toast.error(errorMessage(err)) },
      )
    } else {
      const batch = open.find((b) => b.id === target)
      add.mutate(
        { batchId: target, action: 'add', order_ids: ids },
        { onSuccess: (r) => done(batch?.code ?? '', target, r.moved), onError: (err) => toast.error(errorMessage(err)) },
      )
    }
  }

  const option = (active: boolean) =>
    cn('flex w-full items-start gap-3 rounded-lg border p-3 text-left text-sm', active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-secondary')

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !busy && onClose(false)}
      title={`Đưa ${orders.length} đơn vào lô xuất`}
      confirmLabel={target === NEW_BATCH ? 'Tạo lô và thêm đơn' : 'Thêm vào lô'}
      loading={busy}
      onConfirm={submit}
      description={
        <span className="grid max-h-[55vh] gap-2 overflow-y-auto text-left">
          <span className="block">Gom các đơn của một đợt xuất hàng để tạo vận đơn, in nhãn, đổi trạng thái cùng lúc.</span>
          <span className="grid gap-2" role="radiogroup" aria-label="Chọn lô xuất">
            <button type="button" role="radio" aria-checked={target === NEW_BATCH} className={option(target === NEW_BATCH)} onClick={() => setChoice(NEW_BATCH)}>
              <PackagePlus className="mt-0.5 size-4 shrink-0" />
              <b className="text-foreground">Tạo lô mới</b>
            </button>
            {target === NEW_BATCH && (
              <span className="grid gap-1 pl-1">
                <Label htmlFor="batch-note" className="text-xs text-muted-foreground">
                  Ghi chú cho lô mới (không bắt buộc)
                </Label>
                <Input id="batch-note" value={note} maxLength={200} placeholder="Ví dụ: Xuất sáng thứ 2, nhóm váy Noel" onChange={(e) => setNote(e.target.value)} />
              </span>
            )}
            {open.map((b) => (
              <button key={b.id} type="button" role="radio" aria-checked={target === b.id} className={option(target === b.id)} onClick={() => setChoice(b.id)}>
                <span className="grid min-w-0 flex-1">
                  <b className="font-mono text-foreground">{b.code}</b>
                  {b.note && <span className="truncate">{b.note}</span>}
                </span>
                <span className="shrink-0 text-xs whitespace-nowrap">{b.order_count} đơn</span>
              </button>
            ))}
          </span>
          {elsewhere.length > 0 && (
            <span className="block rounded-lg bg-amber-50 p-2 text-amber-900">
              {elsewhere.length} đơn đang ở lô khác ({[...new Set(elsewhere.map((o) => o.batch_code))].join(', ')}) sẽ được chuyển sang lô này.
            </span>
          )}
        </span>
      }
    />
  )
}
