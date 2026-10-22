import { LoaderCircle } from 'lucide-react'
import { Navigate, Outlet, createBrowserRouter, useLocation } from 'react-router'
import { AppLayout } from '@/components/app-layout'
import { EmptyState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { useMe } from '@/lib/queries'
import { CostFormPage } from '@/pages/cost-form'
import { GroupCostsPage } from '@/pages/group-costs'
import { CustomerDetailPage } from '@/pages/customer-detail'
import { CustomersPage } from '@/pages/customers'
import { GroupDetailPage } from '@/pages/group-detail'
import { GroupFormPage } from '@/pages/group-form'
import { GroupsPage } from '@/pages/groups'
import { LoginPage } from '@/pages/login'
import { OrderDetailPage } from '@/pages/order-detail'
import { OrderFormPage } from '@/pages/order-form'
import { OrderShipPage } from '@/pages/order-ship'
import { GhnSettingsPage } from '@/pages/ghn-settings'
import { OrdersPage } from '@/pages/orders'
import { ReportsPage } from '@/pages/reports'
import { TrackPage } from '@/pages/track'
import { Link } from 'react-router'

function RequireAuth() {
  const { data: me, isPending } = useMe()
  const location = useLocation()
  if (isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return <Outlet />
}

function NotFound() {
  return (
    <div className="pt-10">
      <EmptyState
        title="Không tìm thấy trang"
        action={
          <Button asChild>
            <Link to="/groups">Về trang chủ</Link>
          </Button>
        }
      />
    </div>
  )
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  // Trang công khai cho khách: không cần đăng nhập.
  { path: '/t/:token', element: <TrackPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/groups" replace /> },
          { path: 'groups', element: <GroupsPage /> },
          { path: 'groups/new', element: <GroupFormPage /> },
          { path: 'groups/:id', element: <GroupDetailPage /> },
          { path: 'groups/:id/edit', element: <GroupFormPage /> },
          { path: 'groups/:id/costs', element: <GroupCostsPage /> },
          { path: 'groups/:id/costs/new', element: <CostFormPage /> },
          { path: 'groups/:id/costs/:costId/edit', element: <CostFormPage /> },
          { path: 'orders', element: <OrdersPage /> },
          { path: 'orders/new', element: <OrderFormPage /> },
          { path: 'orders/:id', element: <OrderDetailPage /> },
          { path: 'orders/:id/edit', element: <OrderFormPage /> },
          { path: 'orders/:id/ship', element: <OrderShipPage /> },
          { path: 'customers', element: <CustomersPage /> },
          { path: 'customers/:id', element: <CustomerDetailPage /> },
          { path: 'reports', element: <ReportsPage /> },
          { path: 'settings/ghn', element: <GhnSettingsPage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])
