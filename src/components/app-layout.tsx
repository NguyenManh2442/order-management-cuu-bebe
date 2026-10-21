import { ChartColumn, ClipboardList, Layers, LogOut, Plus, Truck, Users } from 'lucide-react'
import { NavLink, Outlet, useLocation, useMatch } from 'react-router'
import { Button } from '@/components/ui/button'
import { useConfig, useLogout, useMe } from '@/lib/queries'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/groups', label: 'Nhóm đơn', short: 'Nhóm', icon: Layers },
  { to: '/orders', label: 'Đơn hàng', short: 'Đơn hàng', icon: ClipboardList },
  { to: '/customers', label: 'Khách hàng', short: 'Khách', icon: Users },
  { to: '/reports', label: 'Báo cáo', short: 'Báo cáo', icon: ChartColumn },
]

/** Nút "Tạo đơn" mở sẵn nhóm đang xem để thêm đơn nhanh. */
function useNewOrderLink() {
  const groupMatch = useMatch('/groups/:id')
  const id = groupMatch?.params.id
  return id && id !== 'new' ? `/orders/new?group=${id}` : '/orders/new'
}

export function AppLayout() {
  const { pathname } = useLocation()
  const { data: me } = useMe()
  const { data: config } = useConfig()
  const logout = useLogout()
  const newOrderLink = useNewOrderLink()
  // Màn form có thanh Lưu cố định dưới cùng → ẩn thanh điều hướng để không che.
  const isForm = /\/(new|edit|ship)$/.test(pathname) || pathname === '/settings/ghn'

  return (
    <div className="min-h-dvh md:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-card md:flex">
        <div className="px-5 py-5">
          <div className="text-lg font-bold tracking-tight">Đơn Hàng Mini</div>
          <div className="text-xs text-muted-foreground">Quản lý đơn bán online</div>
        </div>
        <div className="px-3">
          <Button asChild className="w-full justify-start">
            <NavLink to={newOrderLink}>
              <Plus /> Tạo đơn hàng
            </NavLink>
          </Button>
        </div>
        <nav className="mt-4 grid gap-1 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
                  isActive && 'bg-secondary text-foreground',
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-3 pb-2">
          <NavLink
            to="/settings/ghn"
            className={({ isActive }) =>
              cn(
                'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
                isActive && 'bg-secondary text-foreground',
              )
            }
          >
            <Truck className="size-4" />
            Thiết lập GHN
          </NavLink>
        </div>
        <div className="border-t p-3">
          <div className="flex items-center justify-between gap-2 px-2">
            <span className="truncate text-sm">{me?.username}</span>
            <Button variant="ghost" size="sm" onClick={() => logout.mutate()} loading={logout.isPending}>
              <LogOut /> Thoát
            </Button>
          </div>
        </div>
      </aside>

      {config?.data_source === 'demo' && (
        <div className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
          Chế độ DEMO — dữ liệu mẫu trong bộ nhớ, không ghi vào Google Sheets
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 pb-28 md:px-8 md:py-8 md:pb-8">
        <Outlet />
      </main>

      {!isForm && (
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur md:hidden" aria-label="Điều hướng chính">
          <div className="grid h-16 grid-cols-5">
            {NAV.slice(0, 2).map((item) => (
              <BottomLink key={item.to} {...item} />
            ))}
            <NavLink to={newOrderLink} className="flex flex-col items-center justify-center" aria-label="Tạo đơn">
              <span className="-mt-5 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background">
                <Plus className="size-7" />
              </span>
              <span className="text-[11px] font-medium">Tạo đơn</span>
            </NavLink>
            {NAV.slice(2).map((item) => (
              <BottomLink key={item.to} {...item} />
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}

function BottomLink({ to, short, icon: Icon }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground',
          isActive && 'text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={cn('size-5', isActive && 'stroke-[2.5]')} />
          {short}
        </>
      )}
    </NavLink>
  )
}
