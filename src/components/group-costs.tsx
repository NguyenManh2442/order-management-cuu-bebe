import { ChevronRight, HandCoins, PiggyBank, Receipt } from 'lucide-react'
import { Link } from 'react-router'
import { COST_CATEGORIES, COST_CATEGORY_LABELS } from '@shared/constants'
import { computeCosts, computeProfit, type CostLine } from '@shared/costs'
import { computeGroupStats } from '@shared/stats'
import type { GroupCost, OrderView } from '@shared/types'
import { cn, formatNumber, formatVND } from '@/lib/utils'
import { StatCard } from './stats'

/** "1,2 mét/sp × 60 sp × 85.000 ₫" — để người bán kiểm tra lại cách tính. */
export function costFormula(line: Pick<CostLine, 'basis' | 'quantity' | 'unit' | 'unit_price'>, itemCount: number): string {
  const unit = line.unit ? ` ${line.unit}` : ''
  const qty = line.basis === 'per_item' ? `${formatNumber(line.quantity)}${unit}/sp × ${formatNumber(itemCount)} sp` : `${formatNumber(line.quantity)}${unit}`
  return `${qty} × ${formatVND(line.unit_price)}`
}

/** Số sản phẩm dùng để nhân chi phí: mọi đơn chưa hủy (đơn hoàn vẫn tính vì hàng đã làm ra). */
export function costItemCount(orders: OrderView[]): number {
  return computeGroupStats(orders, {}, []).item_count
}

/** Dòng tóm tắt trên trang nhóm, bấm để mở màn hình chi phí riêng. */
export function GroupCostsLink({ groupId, costs, orders }: { groupId: string; costs: GroupCost[]; orders: OrderView[] }) {
  const summary = computeCosts(costs, costItemCount(orders))
  const profit = computeProfit(orders, summary.total)
  return (
    <Link
      to={`/groups/${groupId}/costs`}
      className="mt-4 flex min-w-0 items-center gap-3 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:bg-secondary/40"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
        <PiggyBank className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">Chi phí & lãi dự kiến</span>
        <span className="block truncate text-sm text-muted-foreground">
          {costs.length
            ? `Chi phí ${formatVND(summary.total)} · ${profit.expected_profit >= 0 ? 'lãi' : 'lỗ'} ${formatVND(Math.abs(profit.expected_profit))}`
            : 'Chưa nhập chi phí — bấm để thêm'}
        </span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
    </Link>
  )
}

/** Nội dung màn hình "Chi phí & lãi dự kiến" của một nhóm. */
export function GroupCostsView({ groupId, costs, orders }: { groupId: string; costs: GroupCost[]; orders: OrderView[] }) {
  const itemCount = costItemCount(orders)
  const summary = computeCosts(costs, itemCount)
  const profit = computeProfit(orders, summary.total)

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Tính theo <b className="text-foreground">{formatNumber(itemCount)} sản phẩm</b> đã đặt (không tính đơn đã hủy). Khoản
        "theo mỗi sản phẩm" tự cập nhật khi có đơn mới.
      </p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatCard tone="rose" icon={Receipt} label="Tổng chi phí" value={formatVND(summary.total)} />
        <StatCard
          tone="zinc"
          icon={HandCoins}
          label="Chi phí / sản phẩm"
          value={itemCount ? formatVND(summary.per_item) : '—'}
        />
        <StatCard
          tone="blue"
          icon={Receipt}
          label="Doanh thu dự kiến"
          value={formatVND(profit.expected_revenue)}
          hint="Đơn chưa hủy, chưa hoàn"
        />
        <StatCard
          tone={profit.expected_profit >= 0 ? 'emerald' : 'rose'}
          icon={PiggyBank}
          label={profit.expected_profit >= 0 ? 'Lãi dự kiến' : 'Lỗ dự kiến'}
          value={formatVND(Math.abs(profit.expected_profit))}
          hint={
            profit.expected_revenue > 0
              ? `${Math.round((profit.expected_profit / profit.expected_revenue) * 100)}% doanh thu`
              : undefined
          }
        />
      </div>

      {!costs.length ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          Chưa nhập chi phí. Thêm vải, phụ liệu, công may… để biết đợt bán này lãi bao nhiêu.
        </p>
      ) : (
        <div className="grid gap-4">
          {COST_CATEGORIES.filter((cat) => summary.lines.some((l) => l.category === cat)).map((cat) => (
            <div key={cat}>
              <div className="mb-1 flex justify-between text-sm font-medium">
                <span>{COST_CATEGORY_LABELS[cat]}</span>
                <span className="tabular-nums">{formatVND(summary.by_category[cat])}</span>
              </div>
              <ul className="divide-y rounded-lg border">
                {summary.lines
                  .filter((l) => l.category === cat)
                  .map((l) => (
                    <li key={l.id}>
                      <Link
                        to={`/groups/${groupId}/costs/${l.id}/edit`}
                        className="flex min-w-0 items-center gap-2 px-3 py-2 hover:bg-secondary/40"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{l.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{costFormula(l, itemCount)}</span>
                        </span>
                        <span className={cn('shrink-0 text-sm font-semibold tabular-nums', !l.amount && 'text-muted-foreground')}>
                          {formatVND(l.amount)}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
