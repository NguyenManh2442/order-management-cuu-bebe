import { ClipboardList, HandCoins, LogOut, Shirt, Wallet } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from '@shared/constants'
import { computeDashboardStats, type DashboardStats } from '@shared/stats'
import type { GroupWithStats, OrderView } from '@shared/types'
import { DeliveryFailedCard, deliveryFailed } from '@/components/needs-attention'
import { PageHeader } from '@/components/page-header'
import { ErrorState, ListSkeleton } from '@/components/states'
import { STATUS_TONE, StatCard } from '@/components/stats'
import { STATUS_DOT } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MultiDropdown } from '@/components/ui/dropdown'
import { Label } from '@/components/ui/input'
import { useConfig, useGroups, useLogout, useMe, useOrders } from '@/lib/queries'
import { cn, formatNumber, formatVND } from '@/lib/utils'

const HIGHLIGHT: OrderStatus[] = ['pending', 'shipping', 'delivered', 'cancelled']

export function ReportsPage() {
  const orders = useOrders()
  const groups = useGroups()
  const { data: me } = useMe()
  const { data: config } = useConfig()
  const logout = useLogout()
  const [params, setParams] = useSearchParams()

  // Nhóm đang chọn lưu trên URL (?groups=id1,id2) để quay lại / chia sẻ đúng góc nhìn. Rỗng = tất cả nhóm.
  const known = new Set(groups.data?.map((g) => g.id))
  const selected = (params.get('groups') ?? '').split(',').filter((id) => id && (!groups.data || known.has(id)))
  const setSelected = (ids: string[]) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (ids.length) next.set('groups', ids.join(','))
        else next.delete('groups')
        return next
      },
      { replace: true },
    )

  // selected là mảng mới mỗi lần render: nhớ theo chuỗi id để không lọc lại thừa.
  const selectedKey = selected.join(',')
  const scoped = useMemo(() => {
    const ids = selectedKey ? selectedKey.split(',') : []
    return (orders.data ?? []).filter((o) => !ids.length || ids.includes(o.group_id))
  }, [orders.data, selectedKey])
  /** Link sang danh sách đơn: một nhóm thì lọc luôn theo nhóm đó. */
  const ordersLink = (status: OrderStatus) =>
    selected.length === 1 ? `/orders?status=${status}&group=${selected[0]}` : `/orders?status=${status}`
  const scopeLabel = !selected.length
    ? 'Tất cả nhóm'
    : selected.length === 1
      ? (groups.data?.find((g) => g.id === selected[0])?.name ?? '1 nhóm')
      : `${selected.length} nhóm đã chọn`

  return (
    <>
      <PageHeader title="Báo cáo" subtitle={scopeLabel} />
      {groups.data && groups.data.length > 0 && (
        <div className="mb-4 grid max-w-md gap-1">
          <Label className="text-xs text-muted-foreground">Nhóm đơn</Label>
          <MultiDropdown
            aria-label="Chọn nhóm để xem báo cáo"
            values={selected}
            onChange={setSelected}
            placeholder="Tất cả nhóm"
            summary={(n) => `${n} nhóm đã chọn`}
            options={groups.data.map((g) => ({
              value: g.id,
              label: g.name,
              description: `${g.status === 'closed' ? 'Đã đóng · ' : ''}${formatNumber(g.stats.order_count)} đơn`,
            }))}
          />
        </div>
      )}
      {orders.isPending ? (
        <ListSkeleton rows={2} />
      ) : orders.error ? (
        <ErrorState error={orders.error} onRetry={orders.refetch} />
      ) : (
        <>
          <DeliveryFailedCard orders={deliveryFailed(scoped)} className="mb-4" />
          <ReportBody stats={computeDashboardStats(scoped)} items={itemCount(scoped)} ordersLink={ordersLink} />
          {groups.data && selected.length > 0 && (
            <GroupComparison
              groups={groups.data.filter((g) => selected.includes(g.id))}
              orders={scoped}
              title={selected.length > 1 ? 'So sánh các nhóm đã chọn' : 'Chi tiết nhóm'}
            />
          )}
        </>
      )}

      <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border bg-card p-4 md:hidden">
        <div className="min-w-0 text-sm">
          <div className="truncate">
            Đăng nhập: <b>{me?.username}</b>
          </div>
          <div className="text-xs text-muted-foreground">
            Dữ liệu: {config?.data_source === 'sheets' ? 'Google Sheets' : 'Demo (bộ nhớ)'}
          </div>
        </div>
        <Button variant="outline" onClick={() => logout.mutate()} loading={logout.isPending}>
          <LogOut /> Đăng xuất
        </Button>
      </div>
    </>
  )
}

/** Tổng số sản phẩm, không tính đơn đã hủy (như thống kê trong trang nhóm). */
function itemCount(orders: OrderView[]): number {
  return orders.filter((o) => o.status !== 'cancelled').reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0)
}

function ReportBody({
  stats,
  items,
  ordersLink,
}: {
  stats: DashboardStats
  items: number
  ordersLink: (status: OrderStatus) => string
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        <StatCard tone="blue" icon={ClipboardList} label="Tổng số đơn" value={formatNumber(stats.total)} />
        <StatCard tone="violet" icon={Shirt} label="Tổng số sản phẩm" value={formatNumber(items)} hint="Không tính đơn đã hủy" />
        <StatCard tone="emerald" icon={Wallet} label="Doanh thu" value={formatVND(stats.revenue)} hint="Đơn đã giao" />
        <StatCard tone="amber" icon={HandCoins} label="Còn phải thu" value={formatVND(stats.outstanding)} hint="Đơn đang xử lý" />
        {HIGHLIGHT.map((s) => (
          <Link key={s} to={ordersLink(s)} className="block rounded-xl transition-opacity hover:opacity-80">
            <StatCard
              tone={STATUS_TONE[s]}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <span className={cn('size-2 rounded-full', STATUS_DOT[s])} />
                  {ORDER_STATUS_LABELS[s]}
                </span>
              }
              value={formatNumber(stats.by_status[s])}
            />
          </Link>
        ))}
      </div>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Theo trạng thái</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2">
            {(Object.keys(stats.by_status) as OrderStatus[]).map((s) => {
              const n = stats.by_status[s]
              const pct = stats.total ? (n / stats.total) * 100 : 0
              return (
                <li key={s}>
                  <Link to={ordersLink(s)} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 text-sm hover:underline">
                    <span className="truncate">{ORDER_STATUS_LABELS[s]}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-secondary">
                      <span className={cn('block h-full rounded-full', STATUS_DOT[s])} style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-right font-semibold tabular-nums">{n}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  )
}

/** Mỗi nhóm một dòng: thanh tỉ lệ trạng thái + số đơn, khách, sản phẩm, doanh thu, còn phải thu. */
function GroupComparison({ groups, orders, title }: { groups: GroupWithStats[]; orders: OrderView[]; title: string }) {
  const rows = groups.map((g) => {
    const list = orders.filter((o) => o.group_id === g.id)
    const active = list.filter((o) => o.status !== 'cancelled')
    return {
      group: g,
      stats: computeDashboardStats(list),
      customers: new Set(active.map((o) => o.customer_id)).size,
      items: itemCount(list),
    }
  })
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Link to="/groups" className="text-sm text-blue-700 hover:underline">
          Tất cả nhóm
        </Link>
      </CardHeader>
      <CardContent>
        {!rows.length ? (
          <p className="text-sm text-muted-foreground">Chưa có nhóm nào.</p>
        ) : (
          <ul className="divide-y">
            {rows.map(({ group: g, stats, customers, items }) => (
              <li key={g.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <Link to={`/groups/${g.id}`} className="min-w-0 truncate font-medium hover:underline">
                    {g.name}
                    {g.status === 'closed' && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(đã đóng)</span>}
                  </Link>
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{formatNumber(stats.total)} đơn</span>
                </div>
                <StatusBar stats={stats} />
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  <Metric label="Khách" value={formatNumber(customers)} />
                  <Metric label="Sản phẩm" value={formatNumber(items)} />
                  <Metric label="Doanh thu (đã giao)" value={formatVND(stats.revenue)} strong />
                  <Metric label="Còn phải thu" value={formatVND(stats.outstanding)} />
                </dl>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-nums', strong && 'font-semibold')}>{value}</dd>
    </div>
  )
}

/** Thanh ngang chia theo tỉ lệ trạng thái, kèm chú thích số đơn mỗi trạng thái có đơn. */
function StatusBar({ stats }: { stats: DashboardStats }) {
  const present = ORDER_STATUSES.filter((s) => stats.by_status[s] > 0)
  if (!stats.total) return <p className="text-xs text-muted-foreground">Chưa có đơn.</p>
  return (
    <div className="grid gap-1.5">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-secondary">
        {present.map((s) => (
          <span
            key={s}
            className={cn('h-full', STATUS_DOT[s])}
            style={{ width: `${(stats.by_status[s] / stats.total) * 100}%` }}
            title={`${ORDER_STATUS_LABELS[s]}: ${stats.by_status[s]}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {present.map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className={cn('size-2 rounded-full', STATUS_DOT[s])} />
            {ORDER_STATUS_LABELS[s]} <b className="text-foreground tabular-nums">{stats.by_status[s]}</b>
          </span>
        ))}
      </div>
    </div>
  )
}
