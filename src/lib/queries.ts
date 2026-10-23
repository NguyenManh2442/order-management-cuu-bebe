import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { GhnEnv, GhnPlace, GhnQuote, GhnSettingsView, GhnShop } from '@shared/ghn'
import type {
  GhnDraft,
  GhnSettingsInput,
  GhnShipmentInput,
  GroupCostInput,
  GroupInput,
  LoginInput,
  OrderInput,
} from '@shared/schemas'
import type {
  AppConfig,
  BulkStatusResult,
  Customer,
  CustomerDetail,
  CustomerLookup,
  CustomerSummary,
  GroupCost,
  GroupDetail,
  GroupWithStats,
  Order,
  OrderGroup,
  OrderView,
  PublicOrderView,
  SessionUser,
} from '@shared/types'
import type { OrderStatus } from '@shared/constants'
import { api } from './api'

export const keys = {
  me: ['me'] as const,
  config: ['config'] as const,
  groups: ['groups'] as const,
  group: (id: string) => ['groups', id] as const,
  orders: ['orders'] as const,
  order: (id: string) => ['orders', id] as const,
  customers: ['customers'] as const,
  customer: (id: string) => ['customers', id] as const,
  phone: (phone: string) => ['customers', 'lookup', phone] as const,
  ghnSettings: ['ghn', 'settings'] as const,
  ghnProvinces: ['ghn', 'provinces'] as const,
  ghnWards: (provinceId: number) => ['ghn', 'wards', provinceId] as const,
  ghnOldProvinces: ['ghn', 'old', 'provinces'] as const,
  ghnDistricts: (provinceId: number) => ['ghn', 'old', 'districts', provinceId] as const,
  ghnOldWards: (districtId: number) => ['ghn', 'old', 'wards', districtId] as const,
}

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: () => api.get<SessionUser>('/auth/me').catch(() => null), staleTime: Infinity })

export const useLoginHints = () =>
  useQuery({ queryKey: ['hints'], queryFn: () => api.get<{ demo_login: boolean }>('/auth/hints'), staleTime: Infinity })

export const useConfig = () =>
  useQuery({ queryKey: keys.config, queryFn: () => api.get<AppConfig>('/config'), staleTime: Infinity })

export const useGroups = () => useQuery({ queryKey: keys.groups, queryFn: () => api.get<GroupWithStats[]>('/groups') })

export const useGroup = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.group(id), queryFn: () => api.get<GroupDetail>(`/groups/${id}`), enabled: enabled && !!id })

export const useOrders = () => useQuery({ queryKey: keys.orders, queryFn: () => api.get<OrderView[]>('/orders') })

export const useOrder = (id: string | undefined) =>
  useQuery({ queryKey: keys.order(id ?? ''), queryFn: () => api.get<OrderView>(`/orders/${id}`), enabled: !!id })

export const useCustomers = () =>
  useQuery({ queryKey: keys.customers, queryFn: () => api.get<CustomerSummary[]>('/customers') })

export const useCustomer = (id: string) =>
  useQuery({ queryKey: keys.customer(id), queryFn: () => api.get<CustomerDetail>(`/customers/${id}`), enabled: !!id })

export function lookupCustomerQuery(phone: string) {
  return {
    queryKey: keys.phone(phone),
    queryFn: () => api.get<CustomerLookup | null>(`/customers/lookup?phone=${encodeURIComponent(phone)}`),
    staleTime: 60_000,
  }
}

/** Mọi thay đổi đơn hàng đều ảnh hưởng thống kê nhóm, danh sách đơn và khách. */
function useInvalidateAll() {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.groups }),
      qc.invalidateQueries({ queryKey: keys.orders }),
      qc.invalidateQueries({ queryKey: keys.customers }),
    ])
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<SessionUser>('/auth/login', input),
    onSuccess: (user) => {
      qc.clear()
      qc.setQueryData(keys.me, user)
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      qc.clear()
      qc.setQueryData(keys.me, null)
    },
  })
}

export function useSaveGroup(id?: string) {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: GroupInput) =>
      id ? api.put<OrderGroup>(`/groups/${id}`, input) : api.post<OrderGroup>('/groups', input),
    onSuccess: invalidate,
  })
}

export function useSaveCost(groupId: string, costId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: GroupCostInput) =>
      costId
        ? api.put<GroupCost>(`/groups/${groupId}/costs/${costId}`, input)
        : api.post<GroupCost>(`/groups/${groupId}/costs`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.group(groupId) }),
  })
}

export function useDeleteCost(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: Pick<GroupCost, 'id' | 'updated_at'>) =>
      api.del(`/groups/${groupId}/costs/${c.id}?expected_updated_at=${encodeURIComponent(c.updated_at)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.group(groupId) }),
  })
}

export function useSaveOrder(id?: string) {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: OrderInput) =>
      id ? api.put<OrderView>(`/orders/${id}`, input) : api.post<OrderView>('/orders', input),
    onSuccess: invalidate,
  })
}

export function useUpdateOrderStatus() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (v: { order: Pick<Order, 'id' | 'updated_at'>; status: OrderStatus }) =>
      api.patch<Order>(`/orders/${v.order.id}/status`, { status: v.status, expected_updated_at: v.order.updated_at }),
    onSettled: invalidate,
  })
}

// ---------- Giao Hàng Nhanh ----------

/** Danh mục địa chỉ GHN ít thay đổi: giữ trong bộ nhớ cả phiên. */
export const useGhnProvinces = (enabled = true) =>
  useQuery({
    queryKey: keys.ghnProvinces,
    queryFn: () => api.get<GhnPlace[]>('/ghn/provinces'),
    staleTime: Infinity,
    enabled,
  })

export const useGhnWards = (provinceId: number) =>
  useQuery({
    queryKey: keys.ghnWards(provinceId),
    queryFn: () => api.get<GhnPlace[]>(`/ghn/wards?province_id=${provinceId}`),
    staleTime: Infinity,
    enabled: provinceId > 0,
  })

export const useGhnOldProvinces = (enabled: boolean) =>
  useQuery({
    queryKey: keys.ghnOldProvinces,
    queryFn: () => api.get<GhnPlace[]>('/ghn/old/provinces'),
    staleTime: Infinity,
    enabled,
  })

export const useGhnDistricts = (provinceId: number) =>
  useQuery({
    queryKey: keys.ghnDistricts(provinceId),
    queryFn: () => api.get<GhnPlace[]>(`/ghn/old/districts?province_id=${provinceId}`),
    staleTime: Infinity,
    enabled: provinceId > 0,
  })

export const useGhnOldWards = (districtId: number) =>
  useQuery({
    queryKey: keys.ghnOldWards(districtId),
    queryFn: () => api.get<GhnPlace[]>(`/ghn/old/wards?district_id=${districtId}`),
    staleTime: Infinity,
    enabled: districtId > 0,
  })

export const useGhnSettings = (enabled = true) =>
  useQuery({ queryKey: keys.ghnSettings, queryFn: () => api.get<GhnSettingsView>('/ghn/settings'), enabled })

export const useGhnShops = () =>
  useMutation({ mutationFn: (v: { env: GhnEnv; token: string }) => api.post<GhnShop[]>('/ghn/settings/shops', v) })

/** Danh mục tỉnh/phường theo token/shop đang nhập (chưa lưu) trên màn thiết lập. */
export const useGhnSetupPlaces = (v: { env: GhnEnv; token: string; shop_id: string; province_id: number }, enabled: boolean) =>
  useQuery({
    queryKey: ['ghn', 'setup-places', v.env, v.token, v.shop_id, v.province_id],
    queryFn: () => api.post<GhnPlace[]>('/ghn/settings/places', v),
    staleTime: Infinity,
    retry: false,
    enabled,
  })

export function useSaveGhnSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: GhnSettingsInput) => api.put<GhnSettingsView>('/ghn/settings', input),
    onSuccess: (view) => {
      qc.setQueryData(keys.ghnSettings, view)
      // Đổi tài khoản/môi trường GHN: danh mục địa chỉ và cấu hình phải tải lại.
      return Promise.all([qc.invalidateQueries({ queryKey: keys.config }), qc.invalidateQueries({ queryKey: ['ghn'] })])
    },
  })
}

export function useSaveGhnDraft(orderId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (draft: GhnDraft | null) =>
      draft ? api.put<Order>(`/orders/${orderId}/ghn/draft`, draft) : api.del<Order>(`/orders/${orderId}/ghn/draft`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.orders }),
  })
}

export const useGhnPreview = (orderId: string) =>
  useMutation({ mutationFn: (input: GhnShipmentInput) => api.post<GhnQuote>(`/orders/${orderId}/ghn/preview`, input) })

export function useCreateGhnShipment(orderId: string) {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: GhnShipmentInput) => api.post<Order>(`/orders/${orderId}/ghn`, input),
    onSuccess: invalidate,
  })
}

export function useSyncGhnShipment() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (orderId: string) => api.post<Order>(`/orders/${orderId}/ghn/sync`),
    onSettled: invalidate,
  })
}

export function useCancelGhnShipment() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (order: Pick<Order, 'id' | 'updated_at'>) =>
      api.post<Order>(`/orders/${order.id}/ghn/cancel`, { expected_updated_at: order.updated_at }),
    onSettled: invalidate,
  })
}

export function useBulkOrderStatus() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (v: { orders: Pick<Order, 'id' | 'updated_at'>[]; status: OrderStatus }) =>
      api.post<BulkStatusResult>('/orders/bulk-status', {
        status: v.status,
        orders: v.orders.map((o) => ({ id: o.id, expected_updated_at: o.updated_at })),
      }),
    onSettled: invalidate,
  })
}

/** Lấy link tra cứu cho khách (regenerate = đổi link, link cũ hết hiệu lực). */
export function usePublicLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { orderId: string; regenerate: boolean }) =>
      api.post<{ token: string }>(`/orders/${v.orderId}/public-link`, { regenerate: v.regenerate }),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: keys.order(v.orderId) }),
  })
}

export const usePublicOrder = (token: string) =>
  useQuery({
    queryKey: ['public-order', token],
    queryFn: () => api.get<PublicOrderView>(`/public/orders/${encodeURIComponent(token)}`),
    retry: false,
  })

export const useBulkPrintGhn = () =>
  useMutation({
    mutationFn: (orderIds: string[]) =>
      api.post<{ url: string; count: number; skipped: string[] }>('/ghn/print', { order_ids: orderIds }),
  })

export const usePrintGhnLabel = () =>
  useMutation({ mutationFn: (orderId: string) => api.post<{ url: string }>(`/orders/${orderId}/ghn/print`) })

export function useSyncAllGhn() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: () => api.post<{ checked: number; updated: number; failed: number }>('/ghn/sync'),
    onSettled: invalidate,
  })
}

export function useDeleteCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: Pick<Customer, 'id' | 'updated_at'>) =>
      api.del(`/customers/${c.id}?expected_updated_at=${encodeURIComponent(c.updated_at)}`),
    onSuccess: (_data, c) => {
      qc.removeQueries({ queryKey: keys.customer(c.id) })
      return qc.invalidateQueries({ queryKey: keys.customers })
    },
  })
}

export function useDeleteOrder() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (order: Pick<Order, 'id' | 'updated_at'>) =>
      api.del(`/orders/${order.id}?expected_updated_at=${encodeURIComponent(order.updated_at)}`),
    onSuccess: invalidate,
  })
}
