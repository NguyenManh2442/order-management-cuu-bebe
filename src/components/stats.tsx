import type { LucideIcon } from 'lucide-react'
import type { OrderStatus } from '@shared/constants'
import type { SizeStat } from '@shared/types'
import { cn, formatNumber } from '@/lib/utils'

export type StatTone = 'blue' | 'violet' | 'amber' | 'emerald' | 'cyan' | 'rose' | 'zinc' | 'orange'

/** Mỗi loại số liệu một màu để nhìn lướt là phân biệt được. */
const TONES: Record<StatTone, { card: string; label: string; value: string; icon: string }> = {
  blue: { card: 'border-blue-200 bg-blue-50', label: 'text-blue-800', value: 'text-blue-950', icon: 'bg-blue-100 text-blue-700' },
  violet: { card: 'border-violet-200 bg-violet-50', label: 'text-violet-800', value: 'text-violet-950', icon: 'bg-violet-100 text-violet-700' },
  amber: { card: 'border-amber-200 bg-amber-50', label: 'text-amber-800', value: 'text-amber-950', icon: 'bg-amber-100 text-amber-700' },
  emerald: { card: 'border-emerald-200 bg-emerald-50', label: 'text-emerald-800', value: 'text-emerald-950', icon: 'bg-emerald-100 text-emerald-700' },
  cyan: { card: 'border-cyan-200 bg-cyan-50', label: 'text-cyan-800', value: 'text-cyan-950', icon: 'bg-cyan-100 text-cyan-700' },
  rose: { card: 'border-rose-200 bg-rose-50', label: 'text-rose-800', value: 'text-rose-950', icon: 'bg-rose-100 text-rose-700' },
  zinc: { card: 'border-zinc-200 bg-zinc-50', label: 'text-zinc-600', value: 'text-zinc-900', icon: 'bg-zinc-100 text-zinc-600' },
  orange: { card: 'border-orange-200 bg-orange-50', label: 'text-orange-800', value: 'text-orange-950', icon: 'bg-orange-100 text-orange-700' },
}

/** Màu ô thống kê theo trạng thái đơn, khớp màu badge trạng thái. */
export const STATUS_TONE: Record<OrderStatus, StatTone> = {
  pending: 'amber',
  confirmed: 'blue',
  packing: 'violet',
  shipping: 'cyan',
  delivered: 'emerald',
  cancelled: 'zinc',
  returned: 'rose',
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'zinc',
  icon: Icon,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: StatTone
  icon?: LucideIcon
  className?: string
}) {
  const t = TONES[tone]
  return (
    <div className={cn('flex min-w-0 items-start gap-3 rounded-xl border p-3 shadow-xs md:p-4', t.card, className)}>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-xs font-medium md:text-sm', t.label)}>{label}</div>
        <div className={cn('mt-1 truncate text-xl font-bold tabular-nums md:text-2xl', t.value)}>{value}</div>
        {hint && <div className={cn('mt-0.5 truncate text-xs opacity-80', t.label)}>{hint}</div>}
      </div>
      {Icon && (
        <span className={cn('hidden size-9 shrink-0 items-center justify-center rounded-lg sm:flex', t.icon)}>
          <Icon className="size-5" />
        </span>
      )}
    </div>
  )
}

/** Bảng màu cho size; mỗi size luôn một màu cố định ở mọi màn hình. */
const SIZE_TONES = [
  'border-sky-200 bg-sky-50 text-sky-900',
  'border-violet-200 bg-violet-50 text-violet-900',
  'border-amber-200 bg-amber-50 text-amber-900',
  'border-emerald-200 bg-emerald-50 text-emerald-900',
  'border-rose-200 bg-rose-50 text-rose-900',
  'border-cyan-200 bg-cyan-50 text-cyan-900',
  'border-orange-200 bg-orange-50 text-orange-900',
  'border-lime-200 bg-lime-50 text-lime-900',
]

/** "S: 12 · M: 25 · L: 18" — bỏ size bằng 0 cho gọn. */
export function SizeSummary({ sizes, className }: { sizes: SizeStat[]; className?: string }) {
  const nonZero = sizes.filter((s) => s.quantity > 0)
  if (!nonZero.length) return <p className={cn('text-sm text-muted-foreground', className)}>Chưa có sản phẩm</p>
  return (
    <p className={cn('text-sm break-words', className)}>
      {nonZero.map((s, i) => (
        <span key={s.size}>
          {i > 0 && <span className="text-muted-foreground"> · </span>}
          <span className="text-muted-foreground">{s.size}:</span>{' '}
          <span className="font-semibold tabular-nums">{formatNumber(s.quantity)}</span>
        </span>
      ))}
    </p>
  )
}

/** Màu của một size: cùng tên size → cùng màu (băm tên, không phụ thuộc thứ tự hiển thị). */
export function sizeTone(size: string): string {
  let h = 0
  for (const ch of size.toUpperCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return SIZE_TONES[h % SIZE_TONES.length]
}

/** Thẻ size nhỏ tự xuống dòng — không gây cuộn ngang trên điện thoại. */
export function SizeStatsGrid({ sizes, total }: { sizes: SizeStat[]; total: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
      {sizes.map((s) => (
        <div
          key={s.size}
          className={cn(
            'rounded-lg border px-2 py-2 text-center',
            s.quantity === 0 ? 'border-border bg-card text-muted-foreground opacity-60' : sizeTone(s.size),
          )}
        >
          <div className="truncate text-xs font-medium opacity-75">{s.size}</div>
          <div className="text-lg font-semibold tabular-nums">{formatNumber(s.quantity)}</div>
        </div>
      ))}
      <div className="rounded-lg border border-primary bg-primary px-2 py-2 text-center text-primary-foreground">
        <div className="text-xs font-medium opacity-80">Tổng</div>
        <div className="text-lg font-semibold tabular-nums">{formatNumber(total)}</div>
      </div>
    </div>
  )
}
