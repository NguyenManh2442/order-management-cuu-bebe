import { useEffect, useRef, type ComponentProps } from 'react'
import { useBlocker } from 'react-router'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { cn, formatNumber } from '@/lib/utils'

const moneyText = (n: number) => (Number.isFinite(n) && n > 0 ? formatNumber(n) : '')

/**
 * Đặt lại nội dung ô (đã định dạng) mà giữ con trỏ sau đúng số chữ số như trước —
 * gán value thẳng thì trình duyệt đẩy con trỏ về cuối mỗi lần thêm / bớt dấu chấm.
 */
function setKeepingCaret(el: HTMLInputElement, text: string) {
  const before = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/\D/g, '').length
  el.value = text
  let pos = 0
  for (let seen = 0; pos < text.length && seen < before; pos++) if (/\d/.test(text[pos])) seen++
  el.setSelectionRange(pos, pos)
}

/** Ô nhập tiền hiển thị "350.000", lưu số nguyên. Bàn phím số trên điện thoại. */
export function MoneyInput({
  value,
  onChange,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange'> & { value: number; onChange: (v: number) => void }) {
  return (
    <div className="relative min-w-0">
      <Input
        inputMode="numeric"
        autoComplete="off"
        value={moneyText(value)}
        placeholder="0"
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 10)
          const next = digits ? Number(digits) : 0
          // Định dạng ngay trong ô: React thấy giá trị trùng nên không ghi đè (con trỏ giữ nguyên chỗ).
          setKeepingCaret(e.target, moneyText(next))
          onChange(next)
        }}
        className={cn('pr-8 text-right tabular-nums', className)}
        {...props}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">₫</span>
    </div>
  )
}

/** Thanh nút cố định đáy màn hình trên điện thoại, nằm cuối form trên desktop. */
export function StickyFormBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'pb-safe fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur md:static md:mt-6 md:border-0 md:bg-transparent md:pb-0 md:backdrop-blur-none',
        className,
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-0 md:py-0">{children}</div>
    </div>
  )
}

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('min-w-0 rounded-xl border bg-card p-4 shadow-xs md:p-5', className)}>
      <div className="mb-4">
        <h2 className="font-semibold">{title}</h2>
        {description && <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>}
      </div>
      {children}
    </section>
  )
}

/**
 * Hỏi lại khi rời form còn thay đổi chưa lưu (chuyển trang trong app hoặc đóng tab).
 * Gọi allow() ngay trước khi tự điều hướng sau khi lưu thành công.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const allowed = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowed.current && currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      if (!allowed.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const dialog = (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => !open && blocker.reset?.()}
      title="Bỏ thay đổi chưa lưu?"
      description="Thông tin bạn vừa nhập sẽ bị mất."
      confirmLabel="Bỏ thay đổi"
      cancelLabel="Ở lại"
      destructive
      onConfirm={() => blocker.proceed?.()}
    />
  )
  return {
    allow: () => {
      allowed.current = true
    },
    dialog,
  }
}
