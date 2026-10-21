import { ClipboardList, MapPin, MessageCircle, PackageCheck, Phone, Plus, Trash2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { computeDashboardStats } from '@shared/stats'
import { OrderList } from '@/components/order-list'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { StatCard } from '@/components/stats'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { errorMessage } from '@/lib/api'
import { useCustomer, useDeleteCustomer } from '@/lib/queries'
import { formatVND } from '@/lib/utils'

export function CustomerDetailPage() {
  const id = useParams().id!
  const { data, isPending, error, refetch } = useCustomer(id)
  const navigate = useNavigate()
  const remove = useDeleteCustomer()
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (isPending) return <ListSkeleton rows={3} />
  if (error) return <ErrorState error={error} onRetry={refetch} />

  const { customer: c, orders } = data
  const stats = computeDashboardStats(orders)
  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={c.phone}
        back="/customers"
        actions={
          <>
            <Button
              variant="destructive-outline"
              size="icon"
              aria-label="Xóa khách"
              title="Xóa khách"
              onClick={() =>
                orders.length
                  ? toast.error(`Khách còn ${orders.length} đơn hàng. Xóa các đơn đó trước rồi mới xóa được khách.`, { duration: 6000 })
                  : setConfirmDelete(true)
              }
            >
              <Trash2 />
            </Button>
            <Button asChild>
              <Link to={`/orders/new?phone=${encodeURIComponent(c.phone)}`}>
                <Plus /> <span className="hidden sm:inline">Tạo đơn cho khách</span>
                <span className="sm:hidden">Đơn</span>
              </Link>
            </Button>
          </>
        }
      />
      <Card>
        <CardContent className="grid gap-3">
          {c.address && (
            <p className="flex gap-2 text-sm">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 break-words">{c.address}</span>
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button asChild size="lg" className="md:h-10 md:text-sm">
              <a href={`tel:${c.phone}`}>
                <Phone /> Gọi điện
              </a>
            </Button>
            {c.facebook_url && (
              <Button asChild size="lg" variant="outline" className="md:h-10 md:text-sm">
                <a href={c.facebook_url} target="_blank" rel="noopener noreferrer">
                  <MessageCircle /> Facebook
                </a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 grid grid-cols-3 gap-2 md:gap-3">
        <StatCard tone="blue" icon={ClipboardList} label="Số đơn" value={stats.total} />
        <StatCard tone="cyan" icon={PackageCheck} label="Đã giao" value={stats.by_status.delivered} />
        <StatCard tone="emerald" icon={Wallet} label="Đã mua" value={formatVND(stats.revenue)} />
      </div>

      <h2 className="mt-6 mb-3 font-semibold">Lịch sử đơn hàng</h2>
      {orders.length ? <OrderList orders={orders} showGroup /> : <EmptyState title="Khách chưa có đơn nào" />}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Xóa khách ${c.name}?`}
        description={`Khách ${c.phone} sẽ bị xóa khỏi danh sách và không khôi phục được. Lần sau nhập lại SĐT này sẽ tạo khách mới.`}
        confirmLabel="Xóa khách"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(c, {
            onSuccess: () => {
              toast.success(`Đã xóa khách ${c.name}`)
              navigate('/customers', { replace: true })
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
    </>
  )
}
