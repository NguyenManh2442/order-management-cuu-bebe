import { Plus, RefreshCw, Settings } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { BulkActionBar, useOrderSelection } from '@/components/bulk-actions'
import { DeliveryFailedCard, deliveryFailed } from '@/components/needs-attention'
import { ExportCsvButton, OrderFilters, useOrderFilters } from '@/components/order-filters'
import { OrderList } from '@/components/order-list'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/api'
import { useConfig, useGroups, useOrders, useSyncAllGhn } from '@/lib/queries'
import { dateKey } from '@/lib/utils'

export function OrdersPage() {
  const { data: orders, isPending, error, refetch } = useOrders()
  const { data: groups } = useGroups()
  const { filters, setFilter, clear, filtered, sizeOptions, dupCustomerCount } = useOrderFilters(orders)
  const { data: config } = useConfig()
  const syncGhn = useSyncAllGhn()
  const selection = useOrderSelection(filtered)

  return (
    <>
      <PageHeader
        title="Đơn hàng"
        subtitle={orders ? `${filtered.length}/${orders.length} đơn` : undefined}
        actions={
          <>
            {config?.ghn && (
              <Button
                variant="ghn-soft"
                loading={syncGhn.isPending}
                title="Lấy trạng thái mới nhất của mọi vận đơn GHN chưa hoàn tất"
                onClick={() =>
                  syncGhn.mutate(undefined, {
                    onSuccess: (r) =>
                      toast.success(
                        r.checked
                          ? `Đã kiểm tra ${r.checked} vận đơn GHN, cập nhật ${r.updated}` + (r.failed ? `, lỗi ${r.failed}` : '')
                          : 'Không có vận đơn GHN nào đang giao',
                      ),
                    onError: (err) => toast.error(errorMessage(err)),
                  })
                }
              >
                <RefreshCw /> <span className="hidden sm:inline">Đồng bộ GHN</span>
              </Button>
            )}
            <Button asChild variant="outline" size="icon" aria-label="Thiết lập GHN" title="Thiết lập Giao Hàng Nhanh">
              <Link to="/settings/ghn">
                <Settings />
              </Link>
            </Button>
            <ExportCsvButton orders={filtered} filename={`don-hang-${dateKey(new Date().toISOString())}`} />
            <Button asChild className="hidden md:inline-flex">
              <Link to="/orders/new">
                <Plus /> Tạo đơn
              </Link>
            </Button>
          </>
        }
      />
      <DeliveryFailedCard orders={deliveryFailed(orders)} className="mb-4" />
      <OrderFilters
        filters={filters}
        setFilter={setFilter}
        clear={clear}
        groups={groups}
        sizeOptions={sizeOptions}
        dupCustomerCount={dupCustomerCount}
      />
      <div className="mt-4">
        {isPending ? (
          <ListSkeleton />
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : !orders.length ? (
          <EmptyState
            title="Chưa có đơn hàng"
            description="Đơn mới tạo sẽ hiện ở đây, mới nhất ở trên cùng."
            action={
              <Button asChild size="lg">
                <Link to="/orders/new">
                  <Plus /> Tạo đơn đầu tiên
                </Link>
              </Button>
            }
          />
        ) : !filtered.length ? (
          <EmptyState title="Không có đơn phù hợp bộ lọc" action={<Button variant="outline" onClick={clear}>Xóa bộ lọc</Button>} />
        ) : (
          <OrderList orders={filtered} showGroup selection={selection} />
        )}
      </div>
      <BulkActionBar selection={selection} />
    </>
  )
}
