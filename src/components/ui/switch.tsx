import { cn } from '@/lib/utils'

/** Công tắc bật/tắt (role="switch"), bấm cả vào nhãn được. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  id,
  className,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: React.ReactNode
  id?: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn('inline-flex items-center gap-2 text-sm font-medium', className)}
    >
      <span
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-orange-500' : 'bg-zinc-300',
        )}
      >
        <span
          className={cn(
            'inline-block size-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5.5' : 'translate-x-0.5',
          )}
        />
      </span>
      {label}
    </button>
  )
}
