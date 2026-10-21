import { ClipboardList, Lock, LockOpen, Pencil, Plus, Shirt, Users, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { ORDER_STATUS_LABELS } from '@shared/constants'
import { computeGroupStats } from '@shared/stats'
import { ExportCsvButton, OrderFilters, useOrderFilters } from '@/components/order-filters'
import { OrderList } from '@/components/order-list'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { SizeStatsGrid, StatCard } from '@/components/stats'
import { GroupStatusBadge } from '@/components/status'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { errorMessage } from '@/lib/api'
import { slugify } from '@/lib/csv'
import { useConfig, useGroup, useSaveGroup } from '@/lib/queries'
import { dateKey, formatNumber, formatVND } from '@/lib/utils'

export function GroupDetailPage() {
  const id = useParams().id!
  const { data, isPending, error, refetch } = useGroup(id)
  const { data: config } = useConfig()
  const { filters, setFilter, clear, filtered } = useOrderFilters(data?.orders)
  const [includeCancelled, setIncludeCancelled] = useState(false)
  const [confirmToggle, setConfirmToggle] = useState(false)
  const save = useSaveGroup(id)

  // Thống kê theo trạng thái + khoảng ngày đang lọc (không theo ô tìm kiếm).
  const stats = useMemo(() => {
    const orders = (data?.orders ?? []).filter((o) => {
      const d = dateKey(o.created_at)
      return (!filters.from || d >= filters.from) && (!filters.to || d <= filters.to)
    })
    return computeGroupStats(orders, { status: filters.status, includeCancelled }, config?.sizes ?? [])
  }, [data, filters.status, filters.from, filters.to, includeCancelled, config])

  if (isPending) return <ListSkeleton />
  if (error) return <ErrorState error={error} onRetry={refetch} />

  const { group, orders } = data
  const isOpen = group.status === 'open'
  const toggleStatus = () =>
    save.mutate(
      {
        name: group.name,
        description: group.description,
        product_name: group.product_name,
        default_unit_price: group.default_unit_price,
        status: isOpen ? 'closed' : 'open',
        expected_updated_at: group.updated_at,
      },
      {
        onSuccess: () => {
          toast.success(isOpen ? 'Đã đóng nhóm' : 'Đã mở lại nhóm')
          setConfirmToggle(false)
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    )

  const scopeLabel = filters.status
    ? `Chỉ đơn "${ORDER_STATUS_LABELS[filters.status]}"`
    : includeCancelled
      ? 'Tất cả đơn, gồm đơn đã hủy'
      : 'Không tính đơn đã hủy'

  return (
    <>
      <PageHeader
        title={group.name}
        subtitle={group.product_name || undefined}
        back="/groups"
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Sửa nhóm">
              <Link to={`/groups/${id}/edit`}>
                <Pencil />
              </Link>
            </Button>
            {isOpen && (
              <Button asChild className="hidden md:inline-flex">
                <Link to={`/orders/new?group=${id}`}>
                  <Plus /> Thêm đơn
                </Link>
              </Button>
            )}
          </>
        }
      />

      <section className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <GroupStatusBadge status={group.status} />
        {group.default_unit_price > 0 && (
          <span className="text-sm text-muted-foreground">Giá: {formatVND(group.default_unit_price)}</span>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setConfirmToggle(true)}>
          {isOpen ? <Lock /> : <LockOpen />}
          {isOpen ? 'Đóng nhóm' : 'Mở lại nhóm'}
        </Button>
        {group.description && <p className="w-full text-sm whitespace-pre-line text-muted-foreground">{group.description}</p>}
      </section>

      <section className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        <StatCard tone="blue" icon={ClipboardList} label="Đơn hàng" value={formatNumber(stats.order_count)} />
        <StatCard tone="violet" icon={Users} label="Khách hàng" value={formatNumber(stats.customer_count)} />
        <StatCard tone="amber" icon={Shirt} label="Sản phẩm" value={formatNumber(stats.item_count)} />
        <StatCard
          tone="emerald"
          icon={Wallet}
          label="Doanh thu (đã giao)"
          value={formatVND(stats.revenue)}
          hint={`Tổng tiền: ${formatVND(stats.total_amount)}`}
        />
      </section>

      <section className="mt-4 rounded-xl border bg-card p-4 shadow-xs">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Số lượng theo size</h2>
            <p className="text-xs text-muted-foreground">{scopeLabel}</p>
          </div>
          {!filters.status && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={includeCancelled}
                onChange={(e) => setIncludeCancelled(e.target.checked)}
              />
              Gồm đơn đã hủy
            </label>
          )}
        </div>
        <SizeStatsGrid sizes={stats.sizes} total={stats.item_count} />
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold">
            Danh sách đơn{' '}
            <span className="font-normal text-muted-foreground">
              ({filtered.length}
              {filtered.length !== orders.length && `/${orders.length}`})
            </span>
          </h2>
          <ExportCsvButton orders={filtered} filename={`don-hang-${slugify(group.name)}-${dateKey(new Date().toISOString())}`} />
        </div>
        <OrderFilters filters={filters} setFilter={setFilter} clear={clear} searchPlaceholder="Tìm khách, SĐT, mã đơn…" />
        {isOpen && (
          <Button asChild size="lg" className="mt-3 w-full md:hidden">
            <Link to={`/orders/new?group=${id}`}>
              <Plus /> Thêm đơn vào nhóm
            </Link>
          </Button>
        )}
        <div className="mt-3">
          {!orders.length ? (
            <EmptyState
              title="Nhóm chưa có đơn hàng"
              description={isOpen ? 'Thêm đơn đầu tiên cho nhóm này.' : 'Nhóm đã đóng.'}
              action={
                isOpen && (
                  <Button asChild className="hidden md:inline-flex">
                    <Link to={`/orders/new?group=${id}`}>
                      <Plus /> Thêm đơn
                    </Link>
                  </Button>
                )
              }
            />
          ) : !filtered.length ? (
            <EmptyState title="Không có đơn phù hợp bộ lọc" />
          ) : (
            <OrderList orders={filtered} />
          )}
        </div>
      </section>

      <ConfirmDialog
        open={confirmToggle}
        onOpenChange={setConfirmToggle}
        title={isOpen ? `Đóng nhóm "${group.name}"?` : `Mở lại nhóm "${group.name}"?`}
        description={
          isOpen
            ? 'Không thêm được đơn mới vào nhóm đã đóng. Đơn cũ và thống kê vẫn được giữ, vẫn sửa được trạng thái đơn.'
            : 'Nhóm sẽ nhận đơn mới trở lại.'
        }
        confirmLabel={isOpen ? 'Đóng nhóm' : 'Mở lại'}
        loading={save.isPending}
        onConfirm={toggleStatus}
      />
    </>
  )
}
