import { ChevronRight, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import type { CustomerSummary } from '@shared/types'
import { PhoneLink } from '@/components/contact-links'
import { CustomerRiskBadge } from '@/components/customer-risk'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'
import { useCustomers, useDeleteCustomer } from '@/lib/queries'
import { formatDate, searchKey } from '@/lib/utils'

const PAGE = 100

export function CustomersPage() {
  const { data: customers, isPending, error, refetch } = useCustomers()
  const [q, setQ] = useState('')
  const remove = useDeleteCustomer()
  const [toDelete, setToDelete] = useState<CustomerSummary | null>(null)

  const filtered = useMemo(() => {
    const key = searchKey(q)
    const digits = q.replace(/\D/g, '')
    if (!key) return customers ?? []
    return (customers ?? []).filter(
      (c) => searchKey(c.name).includes(key) || (digits.length >= 3 && c.phone.includes(digits)),
    )
  }, [customers, q])

  return (
    <>
      <PageHeader title="Khách hàng" subtitle={customers ? `${customers.length} khách` : undefined} />
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên hoặc số điện thoại…" className="pl-9" aria-label="Tìm khách hàng" />
      </div>
      {isPending ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !customers.length ? (
        <EmptyState title="Chưa có khách hàng" description="Khách được lưu tự động khi tạo đơn." />
      ) : !filtered.length ? (
        <EmptyState title="Không tìm thấy khách phù hợp" />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {filtered.slice(0, PAGE).map((c) => (
            <li key={c.id} className="relative flex min-w-0 items-center gap-3 rounded-xl border bg-card p-3 shadow-xs hover:bg-secondary/40">
              <Link to={`/customers/${c.id}`} className="absolute inset-0 rounded-xl" aria-label={`Xem khách ${c.name}`} />
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary font-semibold">
                {c.name.trim().split(/\s+/).at(-1)?.[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-medium">{c.name}</span>
                  <CustomerRiskBadge history={c.history} className="shrink-0" />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 text-sm">
                  <PhoneLink phone={c.phone} />
                  <span className="text-muted-foreground">
                    {c.order_count} đơn{c.last_order_at && ` · gần nhất ${formatDate(c.last_order_at)}`}
                  </span>
                </div>
              </div>
              {/* Xóa nhanh chỉ hiện với khách chưa có đơn (khách có đơn không xóa được). */}
              {c.order_count === 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative z-10 size-9 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Xóa khách ${c.name}`}
                  title="Xóa khách"
                  onClick={() => setToDelete(c)}
                >
                  <Trash2 />
                </Button>
              )}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && !remove.isPending && setToDelete(null)}
        title={`Xóa khách ${toDelete?.name ?? ''}?`}
        description={`Khách ${toDelete?.phone ?? ''} chưa có đơn nào. Xóa xong không khôi phục được.`}
        confirmLabel="Xóa khách"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          toDelete &&
          remove.mutate(toDelete, {
            onSuccess: () => {
              toast.success(`Đã xóa khách ${toDelete.name}`)
              setToDelete(null)
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
      {filtered.length > PAGE && (
        <p className="mt-3 text-center text-sm text-muted-foreground">Hiển thị {PAGE}/{filtered.length} — nhập từ khóa để thu hẹp.</p>
      )}
    </>
  )
}
