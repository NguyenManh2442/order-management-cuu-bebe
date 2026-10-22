import { Plus } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { GroupCostsView } from '@/components/group-costs'
import { PageHeader } from '@/components/page-header'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { useGroup } from '@/lib/queries'

/** Màn hình riêng cho chi phí & lãi của một nhóm — tách khỏi trang nhóm để không lẫn với danh sách đơn. */
export function GroupCostsPage() {
  const id = useParams().id!
  const { data, isPending, error, refetch } = useGroup(id)

  return (
    <>
      <PageHeader
        title="Chi phí & lãi dự kiến"
        subtitle={data?.group.name}
        back={`/groups/${id}`}
        actions={
          <Button asChild>
            <Link to={`/groups/${id}/costs/new`}>
              <Plus /> <span className="hidden sm:inline">Thêm khoản chi</span>
              <span className="sm:hidden">Thêm</span>
            </Link>
          </Button>
        }
      />
      {isPending ? (
        <ListSkeleton rows={3} />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <GroupCostsView groupId={id} costs={data.costs ?? []} orders={data.orders} />
      )}
    </>
  )
}
