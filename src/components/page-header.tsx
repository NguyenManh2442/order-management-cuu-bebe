import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Đường dẫn quay lại khi không có lịch sử (mở link trực tiếp). */
  back?: string
  actions?: React.ReactNode
}) {
  const navigate = useNavigate()
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-4 flex min-h-14 items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:mb-6 md:border-0 md:bg-transparent md:px-0 md:py-0">
      {back && (
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2 shrink-0"
          aria-label="Quay lại"
          onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate(back))}
        >
          <ArrowLeft className="size-5!" />
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold md:text-2xl">{title}</h1>
        {subtitle && <div className="truncate text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
