import { Check, ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { fieldClass } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface DropdownOption<T extends string | number> {
  value: T
  label: ReactNode
  /** Chấm màu trước nhãn (ví dụ màu trạng thái). */
  dot?: string
  /** Dòng phụ nhỏ dưới nhãn. */
  description?: ReactNode
}

const MAX_MENU_HEIGHT = 340

/**
 * Danh sách chọn nổi, vẽ qua portal với vị trí cố định: không bị bảng cuộn ngang / card cắt mất,
 * tự lật lên trên khi gần đáy màn hình (ví dụ ngay trên thanh nút cố định).
 */
function useFloatingMenu(open: boolean, anchor: React.RefObject<HTMLElement | null>, minWidth: number) {
  const [style, setStyle] = useState<React.CSSProperties>({})
  const place = useCallback(() => {
    const el = anchor.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = Math.max(r.width, minWidth)
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8)
    const below = window.innerHeight - r.bottom - 8
    const above = r.top - 8
    const up = below < Math.min(MAX_MENU_HEIGHT, 200) && above > below
    setStyle({
      position: 'fixed',
      left,
      width,
      maxHeight: Math.min(MAX_MENU_HEIGHT, up ? above - 4 : below - 4),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    })
  }, [anchor, minWidth])

  useLayoutEffect(() => {
    if (!open) return
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])
  return style
}

/**
 * Lõi dùng chung: nút mở (do nơi dùng tự vẽ qua renderTrigger) + danh sách lựa chọn.
 * Bàn phím: ↑/↓ chọn, Enter/Space xác nhận, Esc/Tab đóng.
 */
export function DropdownMenu<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  minWidth = 200,
  renderTrigger,
}: {
  value: T
  options: DropdownOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  minWidth?: number
  renderTrigger: (props: {
    ref: React.RefObject<HTMLButtonElement | null>
    open: boolean
    selected: DropdownOption<T> | undefined
    buttonProps: React.ButtonHTMLAttributes<HTMLButtonElement>
  }) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const listId = useId()
  const style = useFloatingMenu(open, triggerRef, minWidth)
  const selectedIndex = options.findIndex((o) => o.value === value)

  const show = () => {
    if (disabled) return
    setActive(Math.max(0, selectedIndex))
    setOpen(true)
  }
  const close = (focusTrigger = true) => {
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }
  const choose = (i: number) => {
    const opt = options[i]
    if (!opt) return
    close()
    if (opt.value !== value) onChange(opt.value)
  }

  // Bấm ra ngoài thì đóng.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) close(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  // Giữ dòng đang chọn trong vùng nhìn thấy — chỉ cuộn trong menu (scrollIntoView sẽ cuộn cả trang).
  useEffect(() => {
    const menu = menuRef.current
    const item = menu?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    if (!open || !menu || !item) return
    if (item.offsetTop < menu.scrollTop) menu.scrollTop = item.offsetTop
    else if (item.offsetTop + item.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = item.offsetTop + item.offsetHeight - menu.clientHeight
    }
  }, [open, active])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        show()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      choose(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  return (
    <>
      {renderTrigger({
        ref: triggerRef,
        open,
        selected: options[selectedIndex],
        buttonProps: {
          type: 'button',
          disabled,
          'aria-haspopup': 'listbox',
          'aria-expanded': open,
          'aria-controls': open ? listId : undefined,
          onClick: (e) => {
            e.stopPropagation()
            if (open) close()
            else show()
          },
          onKeyDown,
        },
      })}
      {open &&
        createPortal(
          <ul
            ref={menuRef}
            id={listId}
            role="listbox"
            style={style}
            className="z-50 overflow-auto rounded-lg border bg-card py-1 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {options.map((o, i) => (
              <li
                key={String(o.value)}
                role="option"
                data-index={i}
                aria-selected={o.value === value}
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 px-3 py-2.5 text-base md:py-2 md:text-sm',
                  i === active && 'bg-secondary',
                  o.value === value && 'font-medium',
                )}
              >
                {o.dot && <span className={cn('size-2 shrink-0 rounded-full', o.dot)} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.description && <span className="block text-xs font-normal text-muted-foreground">{o.description}</span>}
                </span>
                {o.value === value && <Check className="size-4 shrink-0 text-muted-foreground" />}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  )
}

/** Ô chọn dạng ô nhập (cùng kiểu ô chọn tỉnh/phường GHN) — thay cho <select>. */
export function Dropdown<T extends string | number>({
  id,
  value,
  options,
  onChange,
  placeholder = 'Chọn…',
  disabled,
  invalid,
  className,
  'aria-label': ariaLabel,
}: {
  id?: string
  value: T
  options: DropdownOption<T>[]
  onChange: (value: T) => void
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
  'aria-label'?: string
}) {
  return (
    <DropdownMenu
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
      renderTrigger={({ ref, open, selected, buttonProps }) => (
        <button
          ref={ref}
          id={id}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          {...buttonProps}
          className={cn(
            fieldClass,
            'flex h-11 cursor-pointer items-center gap-2 pr-9 text-left md:h-10',
            open && 'border-ring ring-2 ring-ring/30',
            'relative',
            className,
          )}
        >
          {selected?.dot && <span className={cn('size-2 shrink-0 rounded-full', selected.dot)} />}
          <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown
            className={cn(
              'pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      )}
    />
  )
}

/**
 * Ô chọn nhiều: menu giữ mở để tích liên tục, có ô tìm khi danh sách dài.
 * Không chọn gì = hiện placeholder (thường hiểu là "tất cả").
 */
export function MultiDropdown<T extends string | number>({
  values,
  options,
  onChange,
  placeholder = 'Chọn…',
  /** Nhãn khi chọn nhiều, ví dụ (n) => `${n} nhóm`. */
  summary = (n) => `Đã chọn ${n}`,
  className,
  'aria-label': ariaLabel,
}: {
  values: T[]
  options: DropdownOption<T>[]
  onChange: (values: T[]) => void
  placeholder?: string
  summary?: (count: number) => string
  className?: string
  'aria-label'?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const listId = useId()
  const style = useFloatingMenu(open, triggerRef, 240)
  const searchable = options.length > 6
  const text = query.trim().toLowerCase()
  const shown = text ? options.filter((o) => String(typeof o.label === 'string' ? o.label : o.value).toLowerCase().includes(text)) : options

  const close = (focusTrigger = true) => {
    setOpen(false)
    setQuery('')
    if (focusTrigger) triggerRef.current?.focus()
  }
  const toggle = (v: T) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) close(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    const list = listRef.current
    const item = list?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    if (!open || !list || !item) return
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight
    }
  }, [open, active])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        setActive(0)
        setOpen(true)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(shown.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' || (e.key === ' ' && !(e.target instanceof HTMLInputElement))) {
      e.preventDefault()
      const opt = shown[active]
      if (opt) toggle(opt.value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  const chosen = options.filter((o) => values.includes(o.value))
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : (setActive(0), setOpen(true)))}
        onKeyDown={onKeyDown}
        className={cn(
          fieldClass,
          'relative flex h-11 cursor-pointer items-center gap-2 pr-9 text-left md:h-10',
          open && 'border-ring ring-2 ring-ring/30',
          className,
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !chosen.length && 'text-muted-foreground')}>
          {!chosen.length ? placeholder : chosen.length === 1 ? chosen[0].label : summary(chosen.length)}
        </span>
        <ChevronDown
          className={cn(
            'pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={style}
            className="z-50 flex flex-col overflow-hidden rounded-lg border bg-card shadow-lg"
            onKeyDown={onKeyDown}
          >
            {searchable && (
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                }}
                placeholder="Tìm…"
                aria-label="Tìm trong danh sách"
                className="border-b bg-transparent px-3 py-2.5 text-base outline-none md:py-2 md:text-sm"
              />
            )}
            <ul ref={listRef} id={listId} role="listbox" aria-multiselectable className="min-h-0 flex-1 overflow-auto py-1">
              {shown.map((o, i) => {
                const on = values.includes(o.value)
                return (
                  <li
                    key={String(o.value)}
                    role="option"
                    data-index={i}
                    aria-selected={on}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => toggle(o.value)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 px-3 py-2.5 text-base md:py-2 md:text-sm',
                      i === active && 'bg-secondary',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card',
                      )}
                    >
                      {on && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.description && <span className="block text-xs text-muted-foreground">{o.description}</span>}
                    </span>
                  </li>
                )
              })}
              {!shown.length && <li className="px-3 py-2 text-sm text-muted-foreground">Không có kết quả</li>}
            </ul>
            {values.length > 0 && (
              <button
                type="button"
                className="border-t px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-secondary md:py-2"
                onClick={() => onChange([])}
              >
                Bỏ chọn tất cả
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
