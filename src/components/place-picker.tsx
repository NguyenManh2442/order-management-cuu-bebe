import { ChevronDown, LoaderCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { GhnPlace } from '@shared/ghn'
import { Input } from '@/components/ui/input'
import { cn, searchKey } from '@/lib/utils'

const placeKeys = (p: GhnPlace) => [p.name, ...p.aliases].map(searchKey).filter((k) => k.length >= 2)

/**
 * Đoán tỉnh/phường từ địa chỉ gõ tự do ("12 Lê Lợi, P. Bến Thành, TP.HCM"):
 * lấy nơi có tên/biến thể khớp dài nhất để tránh nhầm tên ngắn.
 */
export function guessPlace(address: string, places: GhnPlace[]): GhnPlace | undefined {
  const text = ` ${searchKey(address).replace(/[^a-z0-9]+/g, ' ')} `
  let best: { place: GhnPlace; len: number } | undefined
  for (const p of places) {
    for (const k of placeKeys(p)) {
      const word = ` ${k.replace(/[^a-z0-9]+/g, ' ').trim()} `
      if (word.length > 4 && text.includes(word) && (!best || word.length > best.len)) best = { place: p, len: word.length }
    }
  }
  return best?.place
}

/** Ô chọn có tìm kiếm (không dấu, theo cả tên viết tắt) — danh sách phường/xã có thể tới vài trăm dòng. */
export function PlacePicker({
  id,
  places,
  value,
  onChange,
  placeholder,
  loading,
  disabled,
  invalid,
}: {
  id?: string
  places: GhnPlace[] | undefined
  value: number
  onChange: (place: GhnPlace) => void
  placeholder: string
  loading?: boolean
  disabled?: boolean
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = places?.find((p) => p.id === value)
  const matches = useMemo(() => {
    const k = searchKey(query)
    if (!places || !k) return places ?? []
    return places.filter((p) => placeKeys(p).some((x) => x.includes(k)))
  }, [places, query])

  const choose = (p: GhnPlace) => {
    onChange(p)
    setOpen(false)
    setQuery('')
  }

  return (
    <div
      className="relative min-w-0"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false)
          setQuery('')
        }
      }}
    >
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        disabled={disabled || loading}
        value={open ? query : (selected?.name ?? '')}
        placeholder={loading ? 'Đang tải…' : (selected?.name ?? placeholder)}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && open) {
            e.preventDefault()
            if (matches[0]) choose(matches[0])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        className="pr-9"
      />
      {loading ? (
        <LoaderCircle className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : (
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
      )}
      {open && places && (
        <ul role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-card py-1 shadow-lg">
          {matches.length ? (
            matches.map((p) => (
              <li key={p.id} role="option" aria-selected={p.id === value}>
                <button
                  type="button"
                  // Giữ focus trong ô để onBlur không đóng danh sách trước khi click.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(p)}
                  className={cn(
                    'w-full px-3 py-2.5 text-left text-base hover:bg-secondary md:py-2 md:text-sm',
                    p.id === value && 'bg-secondary font-medium',
                  )}
                >
                  {p.name}
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-muted-foreground">Không tìm thấy “{query}”</li>
          )}
        </ul>
      )}
    </div>
  )
}
