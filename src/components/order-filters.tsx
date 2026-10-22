import { Download, Filter, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ORDER_STATUSES, type OrderStatus } from '@shared/constants'
import { normalizeSize } from '@shared/phone'
import { sortSizes } from '@shared/stats'
import type { OrderView } from '@shared/types'
import { Button } from '@/components/ui/button'
import { ORDER_STATUS_OPTIONS } from '@/components/status'
import { Dropdown } from '@/components/ui/dropdown'
import { Input, Label } from '@/components/ui/input'
import { downloadCsv, ordersToCsv } from '@/lib/csv'
import { useConfig } from '@/lib/queries'
import { cn, dateKey, searchKey } from '@/lib/utils'
import { toast } from 'sonner'

export interface OrderFilterState {
  q: string
  status: OrderStatus | ''
  from: string
  to: string
  group: string
  /** Đơn có ít nhất một dòng sản phẩm đúng size này. */
  size: string
}

export interface SizeOption {
  size: string
  /** Số đơn (trong danh sách đang xét) có size này. */
  count: number
}

/** Bộ lọc lưu trên URL để có thể chia sẻ/quay lại và để Báo cáo link thẳng tới "Đơn chờ xác nhận". */
export function useOrderFilters(orders: OrderView[] | undefined) {
  const [params, setParams] = useSearchParams()
  const filters: OrderFilterState = {
    q: params.get('q') ?? '',
    status: (ORDER_STATUSES as readonly string[]).includes(params.get('status') ?? '')
      ? (params.get('status') as OrderStatus)
      : '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    group: params.get('group') ?? '',
    size: normalizeSize(params.get('size') ?? ''),
  }
  const { data: config } = useConfig()

  const setFilter = (key: keyof OrderFilterState, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )

  const clear = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const k of ['q', 'status', 'from', 'to', 'group', 'size']) next.delete(k)
        return next
      },
      { replace: true },
    )

  const { q, status, from, to, group, size } = filters
  const filtered = useMemo(() => {
    if (!orders) return []
    const text = searchKey(q)
    const digits = q.replace(/\D/g, '')
    return orders.filter((o) => {
      if (status && o.status !== status) return false
      if (group && o.group_id !== group) return false
      if (size && !o.items.some((i) => normalizeSize(i.size) === size)) return false
      if (from || to) {
        const d = dateKey(o.created_at)
        if (from && d < from) return false
        if (to && d > to) return false
      }
      if (text) {
        const hit =
          searchKey(o.order_code).includes(text) ||
          searchKey(o.customer.name).includes(text) ||
          (digits.length >= 3 && o.customer.phone.includes(digits))
        if (!hit) return false
      }
      return true
    })
  }, [orders, q, status, from, to, group, size])

  /** Size để chọn: size cấu hình + size lạ đã có trong đơn, kèm số đơn mỗi size. */
  const sizeOptions = useMemo<SizeOption[]>(() => {
    const counts = new Map<string, number>()
    for (const o of orders ?? []) {
      for (const s of new Set(o.items.map((i) => normalizeSize(i.size)))) counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    const preferred = config?.sizes ?? []
    return sortSizes([...preferred.map(normalizeSize), ...counts.keys()], preferred).map((s) => ({ size: s, count: counts.get(s) ?? 0 }))
  }, [orders, config])

  return { filters, setFilter, clear, filtered, sizeOptions }
}

export function OrderFilters({
  filters,
  setFilter,
  clear,
  groups,
  sizeOptions,
  searchPlaceholder = 'Tìm mã đơn, tên khách, SĐT…',
}: {
  filters: OrderFilterState
  setFilter: (key: keyof OrderFilterState, value: string) => void
  clear: () => void
  groups?: { id: string; name: string }[]
  sizeOptions?: SizeOption[]
  searchPlaceholder?: string
}) {
  const advancedCount = [filters.status, filters.from, filters.to, filters.group, filters.size].filter(Boolean).length
  const [open, setOpen] = useState(advancedCount > 0)

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={filters.q}
            onChange={(e) => setFilter('q', e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9"
            aria-label="Tìm kiếm"
          />
        </div>
        <Button
          variant={advancedCount ? 'default' : 'outline'}
          className="h-11 md:hidden"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <Filter />
          {advancedCount > 0 ? advancedCount : 'Lọc'}
        </Button>
      </div>
      <div className={cn('grid grid-cols-2 gap-2 md:grid md:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]', !open && 'hidden md:grid')}>
        <div className="col-span-2 grid gap-1 md:col-span-1">
          <Label className="text-xs text-muted-foreground">Trạng thái</Label>
          <Dropdown
            aria-label="Lọc theo trạng thái"
            value={filters.status}
            onChange={(v: OrderStatus | '') => setFilter('status', v)}
            options={[{ value: '' as const, label: 'Tất cả trạng thái' }, ...ORDER_STATUS_OPTIONS]}
          />
        </div>
        {groups && (
          <div className="col-span-2 grid gap-1 md:col-span-1">
            <Label className="text-xs text-muted-foreground">Nhóm</Label>
            <Dropdown
              aria-label="Lọc theo nhóm"
              value={filters.group}
              onChange={(v: string) => setFilter('group', v)}
              options={[{ value: '', label: 'Tất cả nhóm' }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
            />
          </div>
        )}
        {sizeOptions && (
          <div className="col-span-2 grid gap-1 md:col-span-1">
            <Label className="text-xs text-muted-foreground">Size</Label>
            <Dropdown
              aria-label="Lọc theo size"
              value={filters.size}
              onChange={(v: string) => setFilter('size', v)}
              options={[
                { value: '', label: 'Tất cả size' },
                ...sizeOptions.map((o) => ({ value: o.size, label: o.size, description: `${o.count} đơn` })),
              ]}
            />
          </div>
        )}
        <div className="grid min-w-0 gap-1">
          <Label className="text-xs text-muted-foreground">Từ ngày</Label>
          <Input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} />
        </div>
        <div className="grid min-w-0 gap-1">
          <Label className="text-xs text-muted-foreground">Đến ngày</Label>
          <Input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} />
        </div>
        {(advancedCount > 0 || filters.q) && (
          <Button variant="ghost" className="col-span-2 justify-self-start md:col-span-1 md:self-end" onClick={clear}>
            <X /> Xóa bộ lọc
          </Button>
        )}
      </div>
    </div>
  )
}

export function ExportCsvButton({
  orders,
  filename,
  className,
}: {
  orders: OrderView[]
  filename: string
  className?: string
}) {
  return (
    <Button
      variant="outline"
      className={className}
      disabled={!orders.length}
      onClick={() => {
        downloadCsv(`${filename}.csv`, ordersToCsv(orders))
        toast.success(`Đã xuất ${orders.length} đơn ra CSV`)
      }}
    >
      <Download /> <span className="hidden sm:inline">Xuất CSV</span>
      <span className="sm:hidden">CSV</span>
    </Button>
  )
}
