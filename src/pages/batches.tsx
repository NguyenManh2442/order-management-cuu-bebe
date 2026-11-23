import { Boxes, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { BATCH_STATUS_LABELS, type BatchStatus } from '@shared/constants'
import type { BatchSummary } from '@shared/types'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input, Label } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'
import { useBatches, useCreateBatch } from '@/lib/queries'
import { cn, formatDateTime, formatNumber } from '@/lib/utils'

export function BatchStatusBadge({ status, className }: { status: BatchStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        status === 'open' ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800',
        className,
      )}
    >
      {BATCH_STATUS_LABELS[status]}
    </span>
  )
}

/** Thanh tiến độ nhỏ: "Vận đơn 3/5". */
export function Progress({ label, done, total, tone }: { label: string; done: number; total: number; tone: 'orange' | 'violet' }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  const complete = total > 0 && done >= total
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-semibold tabular-nums', complete && 'text-emerald-700')}>
          {formatNumber(done)}/{formatNumber(total)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn('h-full rounded-full', complete ? 'bg-emerald-500' : tone === 'orange' ? 'bg-orange-400' : 'bg-violet-400')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function BatchCard({ batch }: { batch: BatchSummary }) {
  return (
    <li className="relative grid gap-3 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:bg-secondary/40">
      <Link to={`/batches/${batch.id}`} className="absolute inset-0 rounded-xl" aria-label={`Mở lô ${batch.code}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-base font-semibold">{batch.code}</div>
          {batch.note && <div className="truncate text-sm">{batch.note}</div>}
          <div className="text-xs text-muted-foreground">Tạo {formatDateTime(batch.created_at)}</div>
        </div>
        <BatchStatusBadge status={batch.status} className="shrink-0" />
      </div>
      <div className="text-sm">
        <b className="tabular-nums">{formatNumber(batch.order_count)}</b> đơn ·{' '}
        <b className="tabular-nums">{formatNumber(batch.item_count)}</b> sản phẩm
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Progress label="Đã có vận đơn" done={batch.shipped_count} total={batch.order_count} tone="orange" />
        <Progress label="Đã in nhãn" done={batch.printed_count} total={batch.shipped_count} tone="violet" />
      </div>
    </li>
  )
}

export function BatchesPage() {
  const { data: batches, isPending, error, refetch } = useBatches()
  const create = useCreateBatch()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [note, setNote] = useState('')
  const open = batches?.filter((b) => b.status === 'open') ?? []
  const done = batches?.filter((b) => b.status === 'done') ?? []

  const submit = () =>
    create.mutate(
      { note, order_ids: [] },
      {
        onSuccess: (b) => {
          toast.success(`Đã tạo lô ${b.code}`)
          setCreating(false)
          navigate(`/batches/${b.id}`)
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    )

  return (
    <>
      <PageHeader
        title="Lô xuất"
        subtitle="Gom đơn theo đợt xuất hàng để tạo vận đơn, in nhãn cùng lúc"
        back="/orders"
        actions={
          <Button
            onClick={() => {
              setNote('')
              setCreating(true)
            }}
          >
            <Plus /> <span className="hidden sm:inline">Tạo lô</span>
          </Button>
        }
      />
      <p className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
        Cách dùng: ở trang <b>Đơn hàng</b> lọc <b>Lô xuất → Chưa vào lô</b>, tích chọn các đơn sẽ xuất đợt này rồi bấm{' '}
        <b>Vào lô xuất</b>. Trong lô, tạo vận đơn và in nhãn cho cả lô; đơn nào đã in / chưa in hiện rõ từng đơn.
      </p>
      {isPending ? (
        <ListSkeleton rows={3} />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !batches.length ? (
        <EmptyState
          title="Chưa có lô xuất nào"
          description="Chọn đơn ở trang Đơn hàng rồi bấm “Vào lô xuất”, hoặc tạo lô trống trước."
          action={
            <Button asChild size="lg">
              <Link to="/orders?batch=none">
                <Boxes /> Chọn đơn chưa vào lô
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-6">
          {open.length > 0 && (
            <section className="grid gap-2">
              <h2 className="text-sm font-semibold text-muted-foreground">Đang xuất ({open.length})</h2>
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {open.map((b) => (
                  <BatchCard key={b.id} batch={b} />
                ))}
              </ul>
            </section>
          )}
          {done.length > 0 && (
            <section className="grid gap-2">
              <h2 className="text-sm font-semibold text-muted-foreground">Đã xong ({done.length})</h2>
              <ul className="grid gap-3 opacity-80 md:grid-cols-2 xl:grid-cols-3">
                {done.map((b) => (
                  <BatchCard key={b.id} batch={b} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      <ConfirmDialog
        open={creating}
        onOpenChange={(o) => !o && !create.isPending && setCreating(false)}
        title="Tạo lô xuất mới"
        confirmLabel="Tạo lô"
        loading={create.isPending}
        onConfirm={submit}
        description={
          <span className="grid gap-1 text-left">
            <Label htmlFor="new-batch-note" className="text-xs">
              Ghi chú (không bắt buộc)
            </Label>
            <Input
              id="new-batch-note"
              value={note}
              maxLength={200}
              placeholder="Ví dụ: Xuất sáng thứ 2, nhóm váy Noel"
              onChange={(e) => setNote(e.target.value)}
            />
          </span>
        }
      />
    </>
  )
}
