import { ChevronRight, Plus, Receipt, Scale, Wallet } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { EXPENSE_CATEGORY_LABELS } from '@shared/constants'
import { computeFinance, monthKey, type FinanceRow } from '@shared/finance'
import type { Expense } from '@shared/types'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { StatCard } from '@/components/stats'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dropdown } from '@/components/ui/dropdown'
import { useExpenses, useOrders } from '@/lib/queries'
import { cn, dateKey, formatDate, formatNumber, formatVND } from '@/lib/utils'

type By = 'month' | 'year'

const periodLabel = (period: string) => (period.length === 7 ? `Tháng ${Number(period.slice(5))}/${period.slice(0, 4)}` : `Năm ${period}`)

/**
 * Thu chi theo tháng / năm: doanh thu thực tế (đơn đã giao, theo ngày giao) và chi phí ngoài (chi phí chung,
 * không thuộc nhóm hàng). Chọn kỳ để xem / thêm khoản chi của kỳ đó. Lựa chọn lưu trên URL.
 */
export function FinancePage() {
  const orders = useOrders()
  const expenses = useExpenses()
  const [params, setParams] = useSearchParams()
  const thisYear = Number(dateKey(new Date().toISOString()).slice(0, 4))
  const by: By = params.get('by') === 'year' ? 'year' : 'month'
  const year = Number(params.get('year')) || thisYear
  /** Kỳ đang chọn để xem chi tiết khoản chi: "2026-11" hoặc "2026"; '' = cả năm đang xem. */
  const period = params.get('period') ?? ''

  const set = (next: Record<string, string>) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(next)) {
          if (v) p.set(k, v)
          else p.delete(k)
        }
        return p
      },
      { replace: true },
    )

  const rows = useMemo(
    () => (orders.data && expenses.data ? computeFinance(orders.data, expenses.data, by, year) : []),
    [orders.data, expenses.data, by, year],
  )
  /** Năm có số liệu (để chọn), luôn có năm nay. */
  const years = useMemo(() => {
    const set = new Set<number>([thisYear])
    if (orders.data && expenses.data) {
      for (const r of computeFinance(orders.data, expenses.data, 'year')) set.add(Number(r.period))
    }
    return [...set].sort((a, b) => b - a)
  }, [orders.data, expenses.data, thisYear])

  if (orders.isPending || expenses.isPending) return <ListSkeleton rows={3} />
  if (orders.error) return <ErrorState error={orders.error} onRetry={orders.refetch} />
  if (expenses.error) return <ErrorState error={expenses.error} onRetry={expenses.refetch} />

  const total = rows.reduce(
    (t, r) => ({ revenue: t.revenue + r.revenue, expenses: t.expenses + r.expenses, net: t.net + r.net, delivered: t.delivered + r.delivered_count }),
    { revenue: 0, expenses: 0, net: 0, delivered: 0 },
  )
  // Khoản chi hiện ở danh sách: theo kỳ đang chọn, không chọn thì cả năm (xem theo tháng) / tất cả (xem theo năm).
  const listScope = period || (by === 'month' ? String(year) : '')
  const listed = expenses.data.filter((e) => !listScope || e.date.startsWith(listScope))
  const newExpenseLink =
    period.length === 7 && monthKey(new Date().toISOString()) !== period
      ? `/finance/expenses/new?date=${period}-01`
      : '/finance/expenses/new'

  return (
    <>
      <PageHeader
        title="Thu chi"
        subtitle="Doanh thu thực tế và chi phí ngoài theo tháng, năm"
        actions={
          <Button asChild>
            <Link to={newExpenseLink}>
              <Plus /> <span className="hidden sm:inline">Thêm chi phí</span>
              <span className="sm:hidden">Chi phí</span>
            </Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="grid grid-cols-2 gap-1 rounded-lg border bg-card p-1" role="radiogroup" aria-label="Xem theo">
          {(['month', 'year'] as const).map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={by === b}
              onClick={() => set({ by: b === 'month' ? '' : b, period: '' })}
              className={cn(
                'h-9 rounded-md px-4 text-sm font-medium',
                by === b ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary',
              )}
            >
              Theo {b === 'month' ? 'tháng' : 'năm'}
            </button>
          ))}
        </div>
        {by === 'month' && (
          <Dropdown
            aria-label="Chọn năm"
            className="w-36"
            value={year}
            onChange={(y: number) => set({ year: y === thisYear ? '' : String(y), period: '' })}
            options={years.map((y) => ({ value: y, label: `Năm ${y}` }))}
          />
        )}
      </div>

      <section className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        <StatCard tone="emerald" icon={Wallet} label="Doanh thu" value={formatVND(total.revenue)} hint={`${formatNumber(total.delivered)} đơn đã giao`} />
        <StatCard tone="rose" icon={Receipt} label="Chi phí ngoài" value={formatVND(total.expenses)} />
        <StatCard
          tone={total.net < 0 ? 'orange' : 'blue'}
          icon={Scale}
          label="Còn lại"
          value={formatVND(total.net)}
          hint="Doanh thu − chi phí ngoài"
          className="col-span-2 md:col-span-1"
        />
        <StatCard
          tone="zinc"
          label={by === 'month' ? `Trung bình / tháng` : 'Trung bình / năm'}
          value={formatVND(averageRevenue(rows))}
          hint="Doanh thu các kỳ có bán"
          className="hidden md:block"
        />
      </section>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{by === 'month' ? `Từng tháng năm ${year}` : 'Từng năm'}</CardTitle>
          <span className="hidden text-xs text-muted-foreground sm:inline">Bấm một dòng để xem khoản chi</span>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          {!rows.length ? (
            <p className="px-4 text-sm text-muted-foreground">Chưa có số liệu.</p>
          ) : (
            <PeriodTable
              rows={rows}
              selected={period}
              onSelect={(p) =>
                by === 'year' ? set({ by: '', year: p === String(thisYear) ? '' : p, period: '' }) : set({ period: period === p ? '' : p })
              }
              by={by}
            />
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Chi phí ngoài {listScope ? `— ${periodLabel(listScope)}` : '— tất cả'}</CardTitle>
          {period && (
            <Button variant="ghost" size="sm" onClick={() => set({ period: '' })}>
              Xem cả {by === 'month' ? `năm ${year}` : 'các năm'}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {!listed.length ? (
            <EmptyState
              title="Chưa có khoản chi"
              description="Ví dụ: quảng cáo, bao bì, phí ship hoàn hàng… (chi phí vải, công may của từng nhóm hàng nhập ở trang nhóm)."
              action={
                <Button asChild variant="outline">
                  <Link to={newExpenseLink}>
                    <Plus /> Thêm chi phí
                  </Link>
                </Button>
              }
            />
          ) : (
            <ExpenseList expenses={listed} />
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Doanh thu = tổng tiền các đơn <b>Đã giao</b>, tính vào tháng giao hàng (đơn hủy / hoàn không tính). Chi phí nguyên liệu,
        công thợ của từng nhóm hàng xem ở mục “Chi phí & lãi dự kiến” trong trang nhóm.
      </p>
    </>
  )
}

/** Số tiền: dạng gọn trên điện thoại (8,11 tr · 450 k) để bảng 4 cột không xuống dòng, đầy đủ từ màn sm. */
function Money({ value }: { value: number }) {
  if (!value) return <>—</>
  const abs = Math.abs(value)
  const short =
    abs >= 1_000_000
      ? `${(value / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tr`
      : abs >= 1_000
        ? `${(value / 1_000).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} k`
        : formatVND(value)
  return (
    <>
      <span className="whitespace-nowrap sm:hidden">{short}</span>
      <span className="hidden whitespace-nowrap sm:inline">{formatVND(value)}</span>
    </>
  )
}

function averageRevenue(rows: FinanceRow[]): number {
  const selling = rows.filter((r) => r.revenue > 0)
  return selling.length ? Math.round(selling.reduce((s, r) => s + r.revenue, 0) / selling.length) : 0
}

function PeriodTable({
  rows,
  selected,
  onSelect,
  by,
}: {
  rows: FinanceRow[]
  selected: string
  onSelect: (period: string) => void
  by: By
}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.revenue, r.expenses)))
  return (
    <table className="w-full text-sm">
      <thead className="border-b text-left text-xs text-muted-foreground">
        <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium sm:[&>th]:px-4">
          <th>{by === 'month' ? 'Tháng' : 'Năm'}</th>
          <th className="hidden text-right sm:table-cell">Đơn giao</th>
          <th className="text-right">Doanh thu</th>
          <th className="text-right">Chi phí</th>
          <th className="text-right">Còn lại</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const empty = !r.revenue && !r.expenses
          return (
            <tr
              key={r.period}
              tabIndex={0}
              aria-selected={selected === r.period}
              onClick={() => onSelect(r.period)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(r.period))}
              className={cn(
                'cursor-pointer border-b last:border-0 hover:bg-secondary/40 [&>td]:px-3 [&>td]:py-2.5 sm:[&>td]:px-4',
                selected === r.period && 'bg-primary/5',
                empty && 'text-muted-foreground',
              )}
            >
              <td className="whitespace-nowrap">
                <span className="inline-flex items-center gap-1 font-medium">
                  {by === 'month' ? `Th. ${Number(r.period.slice(5))}` : r.period}
                  {by === 'year' && <ChevronRight className="size-3.5 text-muted-foreground" />}
                </span>
              </td>
              <td className="hidden text-right tabular-nums sm:table-cell">{r.delivered_count ? formatNumber(r.delivered_count) : '—'}</td>
              <td className="text-right tabular-nums">
                <Money value={r.revenue} />
                {r.revenue > 0 && (
                  <span className="mt-1 ml-auto block h-1 rounded-full bg-emerald-500" style={{ width: `${(r.revenue / max) * 100}%` }} />
                )}
              </td>
              <td className="text-right tabular-nums">
                <Money value={r.expenses} />
                {r.expenses > 0 && (
                  <span className="mt-1 ml-auto block h-1 rounded-full bg-rose-400" style={{ width: `${(r.expenses / max) * 100}%` }} />
                )}
              </td>
              <td className={cn('text-right font-semibold tabular-nums', r.net < 0 && 'text-rose-700')}>{empty ? '—' : <Money value={r.net} />}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ExpenseList({ expenses }: { expenses: Expense[] }) {
  const total = expenses.reduce((s, e) => s + e.amount, 0)
  return (
    <>
      <ul className="divide-y">
        {expenses.map((e) => (
          <li key={e.id}>
            <Link to={`/finance/expenses/${e.id}/edit`} className="flex items-start justify-between gap-3 py-2.5 hover:bg-secondary/40">
              <span className="min-w-0">
                <span className="block truncate font-medium">{e.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatDate(`${e.date}T12:00:00+07:00`)} · {EXPENSE_CATEGORY_LABELS[e.category]}
                  {e.note && ` · ${e.note}`}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{formatVND(e.amount)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-between border-t pt-3 font-semibold">
        <span>Tổng ({formatNumber(expenses.length)} khoản)</span>
        <span className="tabular-nums">{formatVND(total)}</span>
      </div>
    </>
  )
}
