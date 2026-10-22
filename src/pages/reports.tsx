import { ClipboardList, HandCoins, LogOut, Wallet } from 'lucide-react'
import { Link } from 'react-router'
import { ORDER_STATUS_LABELS, type OrderStatus } from '@shared/constants'
import { computeDashboardStats } from '@shared/stats'
import { DeliveryFailedCard, deliveryFailed } from '@/components/needs-attention'
import { PageHeader } from '@/components/page-header'
import { ErrorState, ListSkeleton } from '@/components/states'
import { STATUS_TONE, SizeSummary, StatCard } from '@/components/stats'
import { STATUS_DOT } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfig, useGroups, useLogout, useMe, useOrders } from '@/lib/queries'
import { cn, formatNumber, formatVND } from '@/lib/utils'

const HIGHLIGHT: OrderStatus[] = ['pending', 'shipping', 'delivered', 'cancelled']

export function ReportsPage() {
  const orders = useOrders()
  const groups = useGroups()
  const { data: me } = useMe()
  const { data: config } = useConfig()
  const logout = useLogout()

  return (
    <>
      <PageHeader title="Báo cáo" subtitle="Tổng quan tất cả đơn hàng" />
      {orders.isPending ? (
        <ListSkeleton rows={2} />
      ) : orders.error ? (
        <ErrorState error={orders.error} onRetry={orders.refetch} />
      ) : (
        <>
          <DeliveryFailedCard orders={deliveryFailed(orders.data)} className="mb-4" />
          <ReportBody stats={computeDashboardStats(orders.data)} />
        </>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Nhóm đang mở</CardTitle>
          <Link to="/groups" className="text-sm text-blue-700 hover:underline">
            Tất cả nhóm
          </Link>
        </CardHeader>
        <CardContent>
          {groups.isPending ? (
            <ListSkeleton rows={2} />
          ) : groups.error ? (
            <ErrorState error={groups.error} onRetry={groups.refetch} />
          ) : (
            <ul className="divide-y">
              {groups.data
                .filter((g) => g.status === 'open')
                .map((g) => (
                  <li key={g.id}>
                    <Link to={`/groups/${g.id}`} className="flex items-start justify-between gap-3 py-3 hover:bg-secondary/40">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{g.name}</div>
                        <SizeSummary sizes={g.stats.sizes} />
                      </div>
                      <div className="shrink-0 text-right text-sm">
                        <div className="font-semibold tabular-nums">{formatNumber(g.stats.item_count)} sp</div>
                        <div className="text-muted-foreground">{formatNumber(g.stats.order_count)} đơn</div>
                      </div>
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

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

function ReportBody({ stats }: { stats: ReturnType<typeof computeDashboardStats> }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        <StatCard tone="blue" icon={ClipboardList} label="Tổng số đơn" value={formatNumber(stats.total)} />
        <StatCard
          tone="emerald"
          icon={Wallet}
          label="Doanh thu (đơn đã giao)"
          value={formatVND(stats.revenue)}
          className="col-span-1 md:col-span-2"
        />
        <StatCard
          tone="amber"
          icon={HandCoins}
          label="Còn phải thu (đơn đang xử lý)"
          value={formatVND(stats.outstanding)}
          className="col-span-2 md:col-span-1"
        />
        {HIGHLIGHT.map((s) => (
          <Link key={s} to={`/orders?status=${s}`} className="block rounded-xl transition-opacity hover:opacity-80">
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
                  <Link to={`/orders?status=${s}`} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 text-sm hover:underline">
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
