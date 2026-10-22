import { ShieldAlert } from 'lucide-react'
import { customerRisk } from '@shared/customer-history'
import type { CustomerHistory } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** Khung cảnh báo khách từng hoàn/hủy đơn — gợi ý thu cọc trước. Không có rủi ro thì không hiện gì. */
export function CustomerRiskBanner({ history, className }: { history: CustomerHistory | undefined; className?: string }) {
  if (!history) return null
  const { level, text } = customerRisk(history)
  if (level === 'none') return null
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
        level === 'high' ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-amber-300 bg-amber-50 text-amber-900',
        className,
      )}
    >
      <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      <span>
        <b>{text}.</b> {level === 'high' ? 'Nên thu cọc hoặc chuyển khoản trước khi gửi hàng.' : 'Cân nhắc thu cọc trước.'}
      </span>
    </div>
  )
}

/** Nhãn nhỏ trong danh sách: "Hoàn 2" / "Hủy 2". */
export function CustomerRiskBadge({ history, className }: { history: CustomerHistory | undefined; className?: string }) {
  if (!history) return null
  const { level, text } = customerRisk(history)
  if (level === 'none') return null
  const label = history.returned ? `Từng hoàn ${history.returned}` : `Từng hủy ${history.cancelled}`
  return (
    <Badge
      title={text}
      className={cn(
        'gap-1 px-1.5 py-0',
        level === 'high' ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-amber-300 bg-amber-50 text-amber-800',
        className,
      )}
    >
      <ShieldAlert className="size-3" />
      {label}
    </Badge>
  )
}
