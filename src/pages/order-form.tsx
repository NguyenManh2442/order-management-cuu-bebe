import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Minus, Plus, Save, Trash2, TriangleAlert, UserRoundCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useFieldArray, useForm, useWatch, type Control } from 'react-hook-form'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { MAX_ITEMS_PER_ORDER, ORDER_STATUS_LABELS, type OrderStatus } from '@shared/constants'
import { historyExcluding } from '@shared/customer-history'
import { isActiveShipment } from '@shared/ghn'
import { isValidPhone, normalizePhone, normalizeSize } from '@shared/phone'
import { orderInputSchema, type OrderInput } from '@shared/schemas'
import type { Customer, GroupWithStats, OrderView } from '@shared/types'
import { CustomerRiskBanner } from '@/components/customer-risk'
import { FormSection, MoneyInput, StickyFormBar, useUnsavedChangesGuard } from '@/components/form-helpers'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { ORDER_STATUS_OPTIONS } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Dropdown } from '@/components/ui/dropdown'
import { Field, Input, Textarea } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'
import { lookupCustomerQuery, useConfig, useGroup, useGroups, useOrder, useSaveOrder } from '@/lib/queries'
import { cn, formatVND } from '@/lib/utils'

const emptyCustomer = { name: '', phone: '', facebook_url: '', address: '' }

function defaultsForCreate(groups: GroupWithStats[], groupParam: string | null, phone: string | null): OrderInput {
  const open = groups.filter((g) => g.status === 'open')
  const group = open.find((g) => g.id === groupParam) ?? (open.length === 1 ? open[0] : undefined)
  return {
    group_id: group?.id ?? '',
    customer: { ...emptyCustomer, phone: phone ?? '' },
    items: [{ size: '', quantity: 1, unit_price: group?.default_unit_price ?? 0 }],
    status: 'pending',
    note: '',
    paid_amount: 0,
  }
}

function valuesFromOrder(o: OrderView): OrderInput {
  return {
    group_id: o.group_id,
    customer: {
      name: o.customer.name,
      phone: o.customer.phone,
      facebook_url: o.customer.facebook_url,
      address: o.customer.address,
    },
    items: o.items.length
      ? o.items.map((i) => ({ size: i.size, quantity: i.quantity, unit_price: i.unit_price }))
      : [{ size: '', quantity: 1, unit_price: 0 }],
    status: o.status,
    note: o.note,
    paid_amount: o.paid_amount,
    expected_updated_at: o.updated_at,
  }
}

export function OrderFormPage() {
  const { id } = useParams()
  const isEdit = !!id
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const groups = useGroups()
  const order = useOrder(id)
  const { data: config } = useConfig()
  const save = useSaveOrder(id)

  const form = useForm<OrderInput>({
    resolver: zodResolver(orderInputSchema),
    defaultValues: { group_id: '', customer: emptyCustomer, items: [{ size: '', quantity: 1, unit_price: 0 }], status: 'pending', note: '', paid_amount: 0 },
  })
  const { errors, isDirty } = form.formState
  const items = useFieldArray({ control: form.control, name: 'items' })
  const guard = useUnsavedChangesGuard(isDirty && !save.isSuccess)

  // Nạp giá trị ban đầu một lần khi dữ liệu về.
  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current) return
    if (isEdit && order.data) {
      form.reset(valuesFromOrder(order.data))
      initialized.current = true
    } else if (!isEdit && groups.data) {
      form.reset(defaultsForCreate(groups.data, params.get('group'), params.get('phone')))
      initialized.current = true
    }
  }, [isEdit, order.data, groups.data, params, form])

  const groupId = useWatch({ control: form.control, name: 'group_id' })
  const watchedItems = useWatch({ control: form.control, name: 'items' })
  const total = (watchedItems ?? []).reduce((s, i) => s + (Number(i?.quantity) || 0) * (Number(i?.unit_price) || 0), 0)
  const paid = useWatch({ control: form.control, name: 'paid_amount' }) ?? 0
  const due = Math.max(0, total - paid)
  const selectableGroups = useMemo(
    () => (groups.data ?? []).filter((g) => g.status === 'open' || g.id === order.data?.group_id),
    [groups.data, order.data],
  )
  const selectedGroup = groups.data?.find((g) => g.id === groupId)
  const sizes = config?.sizes ?? ['S', 'M', 'L', 'XL']

  if (groups.isPending || (isEdit && order.isPending)) return <ListSkeleton rows={3} />
  if (groups.error) return <ErrorState error={groups.error} onRetry={groups.refetch} />
  if (isEdit && order.error) return <ErrorState error={order.error} onRetry={order.refetch} />
  if (!isEdit && !selectableGroups.length) {
    return (
      <>
        <PageHeader title="Tạo đơn hàng" back="/orders" />
        <EmptyState
          title="Chưa có nhóm đang mở"
          description="Mỗi đơn thuộc một nhóm (mẫu sản phẩm / đợt bán). Hãy tạo nhóm trước."
          action={
            <Button asChild size="lg">
              <Link to="/groups/new">Tạo nhóm</Link>
            </Button>
          }
        />
      </>
    )
  }

  const onGroupChange = (newId: string) => {
    form.setValue('group_id', newId, { shouldDirty: true, shouldValidate: true })
    const price = groups.data?.find((g) => g.id === newId)?.default_unit_price ?? 0
    if (!price) return
    form.getValues('items').forEach((it, i) => {
      if (!it.unit_price) form.setValue(`items.${i}.unit_price`, price, { shouldDirty: true })
    })
  }

  const onSubmit = form.handleSubmit((values) =>
    save.mutate(values, {
      onSuccess: (saved) => {
        toast.success(isEdit ? `Đã lưu đơn ${saved.order_code}` : `Đã tạo đơn ${saved.order_code}`)
        guard.allow()
        const backToGroup = !isEdit && params.get('group') === saved.group_id
        navigate(backToGroup ? `/groups/${saved.group_id}` : `/orders/${saved.id}`, { replace: true })
      },
      onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
    }),
  )

  const backTo = isEdit ? `/orders/${id}` : params.get('group') ? `/groups/${params.get('group')}` : '/orders'

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader
        title={isEdit ? `Sửa đơn ${order.data?.order_code}` : 'Tạo đơn hàng'}
        subtitle={selectedGroup?.name}
        back={backTo}
      />

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="grid min-w-0 gap-4">
          <FormSection title="Nhóm đơn hàng">
            <Field label="Nhóm / mẫu sản phẩm" htmlFor="group_id" required error={errors.group_id?.message}>
              <Dropdown
                id="group_id"
                value={groupId}
                placeholder="— Chọn nhóm —"
                invalid={!!errors.group_id}
                onChange={onGroupChange}
                options={selectableGroups.map((g) => ({
                  value: g.id,
                  label: g.status === 'closed' ? `${g.name} (đã đóng)` : g.name,
                  description: g.product_name || undefined,
                }))}
              />
            </Field>
          </FormSection>

          <FormSection title="Khách hàng" description="Nhập SĐT trước — khách cũ sẽ được gợi ý thông tin.">
            <CustomerFields
              form={form}
              groupId={groupId}
              orderId={id}
              groupName={selectedGroup?.name}
              editing={order.data ? { customerId: order.data.customer_id, status: order.data.status } : undefined}
            />
          </FormSection>
        </div>

        <div className="grid min-w-0 gap-4">
          <FormSection title="Sản phẩm" description={selectedGroup?.product_name || undefined}>
            <div className="grid gap-3">
              {items.fields.map((field, index) => (
                <div key={field.id} className="grid gap-3 rounded-lg border bg-background p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {items.fields.length > 1 ? `Dòng ${index + 1}` : 'Size & số lượng'}
                    </span>
                    {items.fields.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" className="-mr-2 text-destructive" onClick={() => items.remove(index)}>
                        <Trash2 /> Bỏ dòng
                      </Button>
                    )}
                  </div>
                  <Field label="Size" required error={errors.items?.[index]?.size?.message}>
                    <Controller
                      control={form.control}
                      name={`items.${index}.size`}
                      render={({ field: f }) => <SizePicker value={f.value} onChange={f.onChange} sizes={sizes} invalid={!!errors.items?.[index]?.size} />}
                    />
                  </Field>
                  <div className="grid grid-cols-[auto_1fr] gap-3">
                    <Field label="Số lượng" required error={errors.items?.[index]?.quantity?.message}>
                      <Controller
                        control={form.control}
                        name={`items.${index}.quantity`}
                        render={({ field: f }) => <QuantityStepper value={f.value} onChange={f.onChange} />}
                      />
                    </Field>
                    <Field label="Đơn giá" required error={errors.items?.[index]?.unit_price?.message}>
                      <Controller
                        control={form.control}
                        name={`items.${index}.unit_price`}
                        render={({ field: f }) => <MoneyInput value={f.value} onChange={f.onChange} onBlur={f.onBlur} aria-label="Đơn giá" />}
                      />
                    </Field>
                  </div>
                  <LineTotal control={form.control} index={index} />
                </div>
              ))}
              {errors.items?.root?.message && <p className="text-sm text-destructive">{errors.items.root.message}</p>}
              {items.fields.length < MAX_ITEMS_PER_ORDER && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    items.append({
                      size: '',
                      quantity: 1,
                      unit_price: form.getValues('items').at(-1)?.unit_price || selectedGroup?.default_unit_price || 0,
                    })
                  }
                >
                  <Plus /> Thêm size khác
                </Button>
              )}
            </div>
          </FormSection>

          <FormSection title="Thanh toán & trạng thái">
            <div className="grid gap-4">
              <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-3">
                <span className="text-sm text-muted-foreground">Tổng tiền</span>
                <span className="text-xl font-bold tabular-nums">{formatVND(total)}</span>
              </div>
              <Field
                label="Đã cọc / chuyển khoản"
                htmlFor="paid_amount"
                error={errors.paid_amount?.message}
                hint="Tiền khách đã trả trước. Khi gửi GHN, tiền thu hộ (COD) tự lấy phần còn lại."
              >
                <div className="grid gap-2">
                  <Controller
                    control={form.control}
                    name="paid_amount"
                    render={({ field }) => (
                      <MoneyInput
                        id="paid_amount"
                        value={field.value ?? 0}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        aria-invalid={!!errors.paid_amount}
                      />
                    )}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={paid === 0 ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={() => form.setValue('paid_amount', 0, { shouldDirty: true, shouldValidate: true })}
                    >
                      Chưa trả
                    </Button>
                    <Button
                      type="button"
                      variant={total > 0 && paid === total ? 'secondary' : 'outline'}
                      size="sm"
                      disabled={!total}
                      onClick={() => form.setValue('paid_amount', total, { shouldDirty: true, shouldValidate: true })}
                    >
                      Đã trả đủ
                    </Button>
                  </div>
                </div>
              </Field>
              <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                <span className="text-sm text-muted-foreground">Còn phải thu</span>
                <span className={cn('text-lg font-bold tabular-nums', due === 0 && 'text-emerald-700')}>
                  {due === 0 && total > 0 ? 'Đã thanh toán đủ' : formatVND(due)}
                </span>
              </div>
              {order.data && isActiveShipment(order.data) && order.data.ghn_cod_amount !== due && (
                <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Đơn đã gửi GHN với thu hộ <b>{formatVND(order.data.ghn_cod_amount)}</b>. Lưu ở đây không đổi COD trên GHN —
                  sửa trên trang GHN, hoặc hủy vận đơn rồi tạo lại.
                </p>
              )}
              <Field label="Trạng thái đơn" htmlFor="status">
                <Controller
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <Dropdown id="status" value={field.value} options={ORDER_STATUS_OPTIONS} onChange={field.onChange} />
                  )}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Ghi chú">
            <Textarea
              rows={3}
              placeholder="Ví dụ: giao giờ hành chính, khách đã cọc…"
              aria-label="Ghi chú"
              aria-invalid={!!errors.note}
              {...form.register('note')}
            />
            {errors.note && <p className="mt-1 text-sm text-destructive">{errors.note.message}</p>}
          </FormSection>
        </div>
      </div>

      <StickyFormBar>
        <div className="min-w-0 flex-1 md:hidden">
          <div className="text-xs text-muted-foreground">{paid > 0 ? `Tổng ${formatVND(total)} · còn thu` : 'Tổng tiền'}</div>
          <div className="truncate text-lg font-bold tabular-nums">{formatVND(paid > 0 ? due : total)}</div>
        </div>
        <Button type="button" variant="outline" className="hidden md:inline-flex" onClick={() => navigate(backTo)}>
          Hủy
        </Button>
        <Button type="submit" size="lg" className="min-w-36 md:h-10 md:text-sm" loading={save.isPending}>
          <Save /> {isEdit ? 'Lưu đơn' : 'Tạo đơn'}
        </Button>
      </StickyFormBar>
      {guard.dialog}
    </form>
  )
}

function CustomerFields({
  form,
  groupId,
  orderId,
  groupName,
  editing,
}: {
  form: ReturnType<typeof useForm<OrderInput>>
  groupId: string
  /** Đơn đang sửa — không tính là trùng với chính nó. */
  orderId?: string
  groupName?: string
  /** Khi sửa đơn: không tính chính đơn này vào lịch sử hoàn/hủy của khách. */
  editing?: { customerId: string; status: OrderStatus }
}) {
  const { errors } = form.formState
  const phone = useWatch({ control: form.control, name: 'customer.phone' }) ?? ''
  const current = useWatch({ control: form.control, name: 'customer' })
  const valid = isValidPhone(phone)
  const group = useGroup(groupId, valid)
  // Cùng SĐT đã có đơn trong nhóm này: chỉ cảnh báo (khách có thể đặt thêm), vẫn cho lưu.
  const duplicates = useMemo(() => {
    if (!valid || !group.data) return []
    const key = normalizePhone(phone)
    return group.data.orders.filter((o) => o.id !== orderId && o.customer.phone === key)
  }, [valid, phone, group.data, orderId])
  const lookup = useQuery({ ...lookupCustomerQuery(normalizePhone(phone)), enabled: valid })
  const found = valid ? lookup.data : null
  const [autoFilledId, setAutoFilledId] = useState<string | null>(null)

  const apply = (c: Customer, onlyEmpty: boolean) => {
    const opts = { shouldDirty: true, shouldValidate: true }
    const cur = form.getValues('customer')
    if (!onlyEmpty || !cur.name.trim()) form.setValue('customer.name', c.name, opts)
    if (!onlyEmpty || !cur.facebook_url.trim()) form.setValue('customer.facebook_url', c.facebook_url, opts)
    if (!onlyEmpty || !cur.address.trim()) form.setValue('customer.address', c.address, opts)
  }

  // Khách cũ + chưa nhập tên → tự điền luôn để đỡ thao tác.
  useEffect(() => {
    if (found && found.id !== autoFilledId && !form.getValues('customer.name').trim()) {
      apply(found, true)
      setAutoFilledId(found.id)
    }
  }, [found])

  const history =
    found && editing?.customerId === found.id ? historyExcluding(found.history, editing.status) : found?.history

  const differs =
    found &&
    (found.name !== current?.name?.trim() ||
      found.address !== current?.address?.trim() ||
      found.facebook_url !== current?.facebook_url?.trim())

  return (
    <div className="grid gap-4">
      <Field label="Số điện thoại" htmlFor="phone" required error={errors.customer?.phone?.message}>
        <Input id="phone" type="tel" inputMode="tel" autoComplete="off" aria-invalid={!!errors.customer?.phone} {...form.register('customer.phone')} />
      </Field>
      {duplicates.length > 0 && (
        <div role="alert" className="grid gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="flex items-start gap-2 font-medium">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              SĐT này đã có {duplicates.length} đơn trong nhóm{groupName ? ` “${groupName}”` : ''}. Kiểm tra để tránh tạo trùng — vẫn lưu được nếu khách đặt thêm.
            </span>
          </p>
          <ul className="grid gap-1 pl-6">
            {duplicates.slice(0, 5).map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-2">
                {/* Mở tab mới để không mất thông tin đang nhập. */}
                <a href={`/orders/${o.id}`} target="_blank" rel="noopener" className="font-mono font-medium underline">
                  {o.order_code}
                </a>
                <span>{o.items_summary}</span>
                <span className="text-amber-800">· {ORDER_STATUS_LABELS[o.status]}</span>
              </li>
            ))}
            {duplicates.length > 5 && <li>… và {duplicates.length - 5} đơn khác</li>}
          </ul>
        </div>
      )}
      {found && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <UserRoundCheck className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {found.id === autoFilledId && !differs ? 'Đã điền thông tin khách cũ: ' : 'Khách cũ: '}
            <b>{found.name}</b>
            {found.address && <span className="text-emerald-800"> — {found.address}</span>}
          </span>
          {differs && (
            <Button type="button" size="sm" variant="outline" onClick={() => apply(found, false)}>
              Dùng thông tin này
            </Button>
          )}
        </div>
      )}
      <CustomerRiskBanner history={history} />
      <Field label="Tên khách hàng" htmlFor="customer_name" required error={errors.customer?.name?.message}>
        <Input id="customer_name" autoComplete="off" aria-invalid={!!errors.customer?.name} {...form.register('customer.name')} />
      </Field>
      <Field label="Link Facebook" htmlFor="facebook_url" error={errors.customer?.facebook_url?.message}>
        <Input id="facebook_url" type="url" inputMode="url" placeholder="facebook.com/…" autoComplete="off" {...form.register('customer.facebook_url')} />
      </Field>
      <Field label="Địa chỉ giao hàng" htmlFor="address" error={errors.customer?.address?.message}>
        <Textarea id="address" rows={2} {...form.register('customer.address')} />
      </Field>
    </div>
  )
}

function SizePicker({
  value,
  onChange,
  sizes,
  invalid,
}: {
  value: string
  onChange: (v: string) => void
  sizes: string[]
  invalid?: boolean
}) {
  const normalized = normalizeSize(value ?? '')
  const isCustom = !!normalized && !sizes.includes(normalized)
  const [editing, setEditing] = useState(isCustom)
  const chip = (active: boolean) =>
    cn(
      'h-11 min-w-12 rounded-lg border px-3 text-sm font-semibold transition-colors',
      active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
      invalid && !active && 'border-destructive/50',
    )
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Chọn size">
      {sizes.map((s) => (
        <button
          key={s}
          type="button"
          className={chip(normalized === s)}
          aria-pressed={normalized === s}
          onClick={() => {
            onChange(s)
            setEditing(false)
          }}
        >
          {s}
        </button>
      ))}
      {editing || isCustom ? (
        <Input
          autoFocus={editing && !isCustom}
          value={isCustom ? value : ''}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          placeholder="Size khác"
          className="h-11 w-28 uppercase"
          maxLength={20}
          aria-label="Size khác"
        />
      ) : (
        <button type="button" className={chip(false)} onClick={() => setEditing(true)}>
          Khác…
        </button>
      )}
    </div>
  )
}

function QuantityStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const n = Number.isFinite(value) ? value : 0
  return (
    <div className="flex h-11 items-center rounded-lg border border-input bg-card md:h-10">
      <button type="button" className="flex h-full w-10 items-center justify-center disabled:opacity-40" disabled={n <= 1} onClick={() => onChange(Math.max(1, n - 1))} aria-label="Giảm">
        <Minus className="size-4" />
      </button>
      <input
        inputMode="numeric"
        className="h-full w-12 bg-transparent text-center text-base font-semibold tabular-nums outline-none md:text-sm"
        value={n || ''}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 5)
          onChange(digits ? Number(digits) : 0)
        }}
        aria-label="Số lượng"
      />
      <button type="button" className="flex h-full w-10 items-center justify-center" onClick={() => onChange(n + 1)} aria-label="Tăng">
        <Plus className="size-4" />
      </button>
    </div>
  )
}

function LineTotal({ control, index }: { control: Control<OrderInput>; index: number }) {
  const item = useWatch({ control, name: `items.${index}` })
  const line = (Number(item?.quantity) || 0) * (Number(item?.unit_price) || 0)
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">Thành tiền</span>
      <span className="font-semibold tabular-nums">{formatVND(line)}</span>
    </div>
  )
}
