import { useNavigate, useSearchParams } from 'react-router'
import { GhnSettingsForm } from '@/components/ghn-settings-form'
import { PageHeader } from '@/components/page-header'
import { ErrorState, ListSkeleton } from '@/components/states'
import { useGhnSettings } from '@/lib/queries'

export function GhnSettingsPage() {
  const { data, isPending, error, refetch } = useGhnSettings()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  // Chỉ nhận đường dẫn trong app để tránh chuyển hướng ra trang ngoài.
  const next = params.get('next')
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null

  return (
    <>
      <PageHeader
        title="Thiết lập Giao Hàng Nhanh"
        subtitle={safeNext ? 'Thiết lập xong sẽ quay lại tạo đơn GHN' : 'Kết nối tài khoản GHN để tạo vận đơn từ đơn hàng'}
        back={safeNext ?? '/orders'}
      />
      {isPending ? (
        <ListSkeleton rows={3} />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <GhnSettingsForm view={data} onSaved={() => safeNext && navigate(safeNext, { replace: true })} />
      )}
    </>
  )
}
