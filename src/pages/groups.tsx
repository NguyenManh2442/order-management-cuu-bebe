import { ChevronRight, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { SizeSummary } from '@/components/stats'
import { GroupStatusBadge } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useGroups } from '@/lib/queries'
import { cn, formatNumber, searchKey } from '@/lib/utils'

export function GroupsPage() {
  const { data: groups, isPending, error, refetch } = useGroups()
  const [q, setQ] = useState('')
  const [showClosed, setShowClosed] = useState(false)

  const filtered = useMemo(() => {
    const key = searchKey(q)
    return (groups ?? []).filter(
      (g) =>
        (showClosed || g.status === 'open' || key) &&
        (!key || searchKey(g.name).includes(key) || searchKey(g.product_name).includes(key)),
    )
  }, [groups, q, showClosed])
  const closedCount = groups?.filter((g) => g.status === 'closed').length ?? 0

  return (
    <>
      <PageHeader
        title="Nhóm đơn hàng"
        subtitle="Mỗi nhóm là một mẫu sản phẩm hoặc một đợt bán"
        actions={
          <Button asChild>
            <Link to="/groups/new">
              <Plus /> <span className="hidden sm:inline">Tạo nhóm</span>
              <span className="sm:hidden">Nhóm</span>
            </Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên nhóm…" className="pl-9" aria-label="Tìm nhóm" />
        </div>
        {closedCount > 0 && (
          <label className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" className="size-4 accent-primary" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Hiện nhóm đã đóng ({closedCount})
          </label>
        )}
      </div>

      {isPending ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !groups.length ? (
        <EmptyState
          title="Chưa có nhóm đơn hàng"
          description="Tạo nhóm cho từng mẫu sản phẩm (ví dụ: Mẫu váy Noel) rồi thêm đơn của khách vào nhóm."
          action={
            <Button asChild size="lg">
              <Link to="/groups/new">
                <Plus /> Tạo nhóm đầu tiên
              </Link>
            </Button>
          }
        />
      ) : !filtered.length ? (
        <EmptyState title="Không có nhóm phù hợp" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((g) => (
            <li key={g.id}>
              <Link
                to={`/groups/${g.id}`}
                className={cn(
                  'flex h-full min-w-0 flex-col rounded-xl border bg-card p-4 shadow-xs transition-colors hover:bg-secondary/40',
                  g.status === 'closed' && 'bg-muted/50',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{g.name}</h2>
                    {g.product_name && <p className="truncate text-sm text-muted-foreground">{g.product_name}</p>}
                  </div>
                  <GroupStatusBadge status={g.status} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  <span className="rounded-md bg-blue-50 px-2 py-0.5 text-blue-800">
                    <b className="tabular-nums">{formatNumber(g.stats.order_count)}</b> đơn
                  </span>
                  <span className="rounded-md bg-amber-50 px-2 py-0.5 text-amber-800">
                    <b className="tabular-nums">{formatNumber(g.stats.item_count)}</b> sản phẩm
                  </span>
                  <span className="rounded-md bg-violet-50 px-2 py-0.5 text-violet-800">
                    <b className="tabular-nums">{formatNumber(g.stats.customer_count)}</b> khách
                  </span>
                </div>
                <SizeSummary sizes={g.stats.sizes} className="mt-1" />
                <span className="mt-3 flex items-center justify-end gap-1 text-sm font-medium">
                  Xem chi tiết <ChevronRight className="size-4" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
