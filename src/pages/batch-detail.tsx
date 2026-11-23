import { CheckCheck, ListChecks, Pencil, Plus, Printer, RotateCcw, Trash2, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { isActiveShipment } from '@shared/ghn'
import { normalizeSize } from '@shared/phone'
import { sortSizes } from '@shared/stats'
import type { OrderView } from '@shared/types'
import { BulkActionBar, BulkGhnDialog, useOrderSelection, usePrintLabels } from '@/components/bulk-actions'
import { ExportCsvButton } from '@/components/order-filters'
import { OrderList } from '@/components/order-list'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { sizeTone } from '@/components/stats'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input, Label } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'
import { useBatch, useConfig, useDeleteBatch, useUpdateBatch } from '@/lib/queries'
import { cn, formatDateTime, formatNumber } from '@/lib/utils'
import { BatchStatusBadge, Progress } from './batches'

type View = 'all' | 'noship' | 'unprinted' | 'printed'

export function BatchDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data, isPending, error, refetch } = useBatch(id)
  const { data: config } = useConfig()
  const update = useUpdateBatch(id)
  const remove = useDeleteBatch()
  const print = usePrintLabels()
  const [view, setView] = useState<View>('all')
  const [ghnOrders, setGhnOrders] = useState<OrderView[] | null>(null)
  const [editNote, setEditNote] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const groups = useMemo(() => {
    const orders = data?.orders ?? []
    const live = orders.filter((o) => o.status !== 'cancelled')
    const shipped = orders.filter(isActiveShipment)
    return {
      all: orders,
      // Đơn còn hiệu lực chưa có vận đơn: cần tạo vận đơn GHN.
      noship: live.filter((o) => !isActiveShipment(o)),
      // Có nhãn nhưng chưa in: việc cần làm tiếp theo.
      unprinted: shipped.filter((o) => !o.printed_at),
      printed: orders.filter((o) => o.printed_at),
      shipped,
      live,
    }
  }, [data])
  const visible = groups[view]
  const selection = useOrderSelection(visible)

  const sizeTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const o of groups.live) {
      for (const it of o.items) totals.set(normalizeSize(it.size), (totals.get(normalizeSize(it.size)) ?? 0) + it.quantity)
    }
    return sortSizes(totals.keys(), config?.sizes ?? []).map((size) => ({ size, quantity: totals.get(size)! }))
  }, [groups.live, config])
  const itemCount = sizeTotals.reduce((s, x) => s + x.quantity, 0)

  if (isPending) return <ListSkeleton />
  if (error) return <ErrorState error={error} onRetry={refetch} />
  const { batch } = data

  const save = (patch: { note?: string; status?: 'open' | 'done' }, message: string, after?: () => void) =>
    update.mutate(
      { note: patch.note ?? batch.note, status: patch.status ?? batch.status, expected_updated_at: batch.updated_at },
      {
        onSuccess: () => {
          toast.success(message)
          after?.()
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    )

  const tabs: { key: View; label: string }[] = [
    { key: 'all', label: 'Tất cả' },
    { key: 'noship', label: 'Chưa có vận đơn' },
    { key: 'unprinted', label: 'Chưa in' },
    { key: 'printed', label: 'Đã in' },
  ]

  return (
    <>
      <PageHeader
        title={<span className="font-mono">{batch.code}</span>}
        subtitle={batch.note || `Tạo ${formatDateTime(batch.created_at)}`}
        back="/batches"
        actions={<ExportCsvButton orders={groups.all} filename={`lo-xuat-${batch.code}`} />}
      />

      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <BatchStatusBadge status={batch.status} />
          <span className="text-sm text-muted-foreground">
            <b className="text-foreground tabular-nums">{formatNumber(groups.all.length)}</b> đơn ·{' '}
            <b className="text-foreground tabular-nums">{formatNumber(itemCount)}</b> sản phẩm
            {groups.all.length > groups.live.length && ` · ${groups.all.length - groups.live.length} đơn đã hủy`}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditNote(batch.note)}>
              <Pencil /> Ghi chú
            </Button>
            {batch.status === 'open' ? (
              <Button variant="success" size="sm" loading={update.isPending} onClick={() => save({ status: 'done' }, `Đã hoàn tất lô ${batch.code}`)}>
                <CheckCheck /> Hoàn tất lô
              </Button>
            ) : (
              <Button variant="outline" size="sm" loading={update.isPending} onClick={() => save({ status: 'open' }, `Đã mở lại lô ${batch.code}`)}>
                <RotateCcw /> Mở lại lô
              </Button>
            )}
          </div>
        </div>

        {groups.all.length > 0 && (
          <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs">
            <div className="grid gap-3 sm:grid-cols-2">
              <Progress label="Đã có vận đơn GHN" done={groups.shipped.length} total={groups.live.length} tone="orange" />
              <Progress label="Đã in nhãn" done={groups.shipped.length - groups.unprinted.length} total={groups.shipped.length} tone="violet" />
            </div>
            {sizeTotals.length > 0 && (
              <div className="flex flex-wrap items-center gap-1" aria-label="Số lượng theo size của cả lô (không tính đơn hủy)">
                <span className="mr-1 text-xs text-muted-foreground">Soạn hàng:</span>
                {sizeTotals.map(({ size, quantity }) => (
                  <span key={size} className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs whitespace-nowrap tabular-nums', sizeTone(size))}>
                    <b className="font-bold">{size}</b>
                    <span className="opacity-70">×</span>
                    <b className="font-bold">{formatNumber(quantity)}</b>
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {config?.ghn && groups.noship.length > 0 && (
                <Button variant="ghn" onClick={() => setGhnOrders(groups.noship)}>
                  <Truck /> Tạo vận đơn cho {groups.noship.length} đơn
                </Button>
              )}
              {config?.ghn && groups.unprinted.length > 0 && (
                <Button variant="violet" loading={print.isPending} onClick={() => print.run(groups.unprinted)}>
                  <Printer /> In {groups.unprinted.length} nhãn chưa in
                </Button>
              )}
              {config?.ghn && groups.shipped.length > 0 && groups.unprinted.length === 0 && (
                <Button variant="outline" loading={print.isPending} onClick={() => print.run(groups.shipped)}>
                  <Printer /> In lại {groups.shipped.length} nhãn
                </Button>
              )}
              <Button asChild variant="outline">
                <Link to="/orders?batch=none">
                  <Plus /> Thêm đơn
                </Link>
              </Button>
            </div>
            {config?.ghn && groups.noship.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Đơn cần gửi chung một gói với đơn khác của cùng khách: tạo vận đơn riêng ở từng đơn (nút “Gửi GHN”) để chọn gộp.
              </p>
            )}
          </section>
        )}

        {!groups.all.length ? (
          <EmptyState
            title="Lô chưa có đơn nào"
            description="Ở trang Đơn hàng, tích chọn các đơn rồi bấm “Vào lô xuất” và chọn lô này."
            action={
              <Button asChild size="lg">
                <Link to="/orders?batch=none">
                  <Plus /> Chọn đơn chưa vào lô
                </Link>
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Lọc đơn trong lô">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={view === t.key}
                  onClick={() => {
                    setView(t.key)
                    selection.clear()
                  }}
                  className={cn(
                    'h-9 rounded-full border px-3 text-sm whitespace-nowrap transition-colors',
                    view === t.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
                  )}
                >
                  {t.label} <span className="tabular-nums opacity-80">({groups[t.key].length})</span>
                </button>
              ))}
              {/* Danh sách chỉ chọn được trang đang hiện (20 đơn); lô dài hơn thì cần nút chọn cả lô. */}
              {visible.length > 20 && (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => selection.setMany(visible.map((o) => o.id), true)}>
                  <ListChecks /> Chọn cả {visible.length} đơn
                </Button>
              )}
            </div>
            {visible.length ? (
              <OrderList orders={visible} showGroup hideBatch selection={selection} />
            ) : (
              <EmptyState title="Không có đơn nào ở mục này" />
            )}
          </>
        )}

        <Button variant="destructive-outline" className="justify-self-start" onClick={() => setConfirmDelete(true)}>
          <Trash2 /> Xóa lô
        </Button>
      </div>

      <BulkActionBar selection={selection} batchId={batch.id} />
      {ghnOrders && (
        <BulkGhnDialog
          orders={ghnOrders}
          onClose={() => {
            setGhnOrders(null)
          }}
        />
      )}
      <ConfirmDialog
        open={editNote !== null}
        onOpenChange={(o) => !o && !update.isPending && setEditNote(null)}
        title={`Ghi chú lô ${batch.code}`}
        confirmLabel="Lưu"
        loading={update.isPending}
        onConfirm={() => save({ note: editNote ?? '' }, 'Đã lưu ghi chú', () => setEditNote(null))}
        description={
          <span className="grid gap-1 text-left">
            <Label htmlFor="batch-note-edit" className="text-xs">
              Ghi chú
            </Label>
            <Input
              id="batch-note-edit"
              value={editNote ?? ''}
              maxLength={200}
              placeholder="Ví dụ: Xuất sáng thứ 2, nhóm váy Noel"
              onChange={(e) => setEditNote(e.target.value)}
            />
          </span>
        }
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Xóa lô ${batch.code}?`}
        description={`${groups.all.length} đơn trong lô sẽ trở về “chưa vào lô”. Đơn hàng, vận đơn và dấu đã in vẫn giữ nguyên.`}
        confirmLabel="Xóa lô"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(batch.id, {
            onSuccess: () => {
              toast.success(`Đã xóa lô ${batch.code}`)
              navigate('/batches', { replace: true })
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
    </>
  )
}
