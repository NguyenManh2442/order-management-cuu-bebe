import { zodResolver } from '@hookform/resolvers/zod'
import { Calculator, ChevronDown, CornerDownLeft, FileText, MapPin, PackagePlus, Save, Send, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { MAX_BUNDLE_ORDERS, bundleCandidates, formatGhnAddress, isActiveShipment, type GhnPlace } from '@shared/ghn'
import { ghnShipmentInputSchema, type GhnDraft, type GhnShipmentInput } from '@shared/schemas'
import { amountDue } from '@shared/stats'
import type { OrderView } from '@shared/types'
import { FormSection, MoneyInput, StickyFormBar, useUnsavedChangesGuard } from '@/components/form-helpers'
import { GhnSettingsForm } from '@/components/ghn-settings-form'
import { PageHeader } from '@/components/page-header'
import { PlacePicker, guessPlace } from '@/components/place-picker'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Dropdown } from '@/components/ui/dropdown'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'
import { readDraft, shipmentDefaults } from '@/lib/ghn-defaults'
import { PAYMENT_OPTIONS, REQUIRED_NOTE_OPTIONS } from '@/lib/ghn-options'
import {
  useConfig,
  useCreateGhnShipment,
  useCustomer,
  useGhnPreview,
  useGhnDistricts,
  useGhnOldProvinces,
  useGhnOldWards,
  useGhnProvinces,
  useGhnSettings,
  useGhnWards,
  useOrder,
  useSaveGhnDraft,
} from '@/lib/queries'
import { cn, formatDate, formatDateTime, formatNumber, formatVND } from '@/lib/utils'

const itemCount = (o: OrderView) => o.items.reduce((s, i) => s + i.quantity, 0)

const intValue = (v: string) => {
  const digits = v.replace(/\D/g, '').slice(0, 6)
  return digits ? Number(digits) : 0
}

export function OrderShipPage() {
  const id = useParams().id!
  const navigate = useNavigate()
  const { data: config } = useConfig()
  const ghn = config?.ghn ?? null
  const order = useOrder(id)
  const preview = useGhnPreview(id)
  const create = useCreateGhnShipment(id)
  const saveDraft = useSaveGhnDraft(id)
  const settings = useGhnSettings(!!config && !ghn)
  // Đơn khác của cùng khách (mọi nhóm) để chọn gửi chung một vận đơn.
  const customer = useCustomer(order.data?.customer_id ?? '')
  const candidates = useMemo(
    () => (order.data && customer.data ? bundleCandidates(order.data, customer.data.orders) : []),
    [order.data, customer.data],
  )
  /** Số đơn gửi kèm trong nháp nhưng nay không còn gửi được (đã gửi riêng, đã hủy…). */
  const [staleBundle, setStaleBundle] = useState(0)
  /** null = tự quyết: ít đơn thì mở sẵn, nhiều đơn thì thu gọn cho đỡ dài. */
  const [bundleOpen, setBundleOpen] = useState<boolean | null>(null)

  const form = useForm<GhnShipmentInput>({ resolver: zodResolver(ghnShipmentInputSchema) })
  const { errors, isDirty } = form.formState
  const guard = useUnsavedChangesGuard(isDirty && !create.isSuccess)
  /** Thông tin đã kiểm tra hợp lệ, chờ người dùng xác nhận mới gửi GHN. */
  const [confirmValues, setConfirmValues] = useState<GhnShipmentInput | null>(null)
  const isNew = useWatch({ control: form.control, name: 'is_new_address' }) ?? true
  const provinceId = useWatch({ control: form.control, name: 'province_id' }) ?? 0
  const districtId = useWatch({ control: form.control, name: 'district_id' }) ?? 0
  const wardId = useWatch({ control: form.control, name: 'ward_id' }) ?? 0
  const street = useWatch({ control: form.control, name: 'street' }) ?? ''
  const bundle = useWatch({ control: form.control, name: 'bundle' }) ?? []
  const bundled = candidates.filter((c) => bundle.some((b) => b.id === c.id))
  /** Đơn đã chọn gửi kèm nhưng vừa không còn gửi được (người khác vừa gửi riêng / đổi trạng thái) — tiền vẫn đang cộng trong COD. */
  const lostBundle = (customer.data?.orders ?? []).filter((x) => bundle.some((b) => b.id === x.id) && !candidates.includes(x))
  const bundleFull = bundle.length >= MAX_BUNDLE_ORDERS

  // Hệ mới: Tỉnh → Phường. Hệ cũ: Tỉnh → Quận/Huyện → Phường (mã khác nhau giữa hai hệ).
  const newProvinces = useGhnProvinces(!!ghn && isNew)
  const oldProvinces = useGhnOldProvinces(!!ghn && !isNew)
  const districts = useGhnDistricts(isNew ? 0 : provinceId)
  const newWards = useGhnWards(isNew ? provinceId : 0)
  const oldWards = useGhnOldWards(isNew ? 0 : districtId)
  const provinces = isNew ? newProvinces : oldProvinces
  const wards = isNew ? newWards : oldWards

  // Nạp giá trị ban đầu một lần.
  const initialized = useRef(false)
  /** Đang tự đoán tỉnh → quận → phường từ địa chỉ khách (dừng khi người dùng tự chọn). */
  const guessing = useRef(false)
  useEffect(() => {
    // Chờ danh sách đơn của khách để khôi phục các đơn gửi kèm trong nháp.
    if (initialized.current || !order.data || !ghn || (customer.isPending && !customer.error)) return
    const draft = readDraft(order.data.ghn_draft)
    const { bundle_ids = [], ...draftValues } = draft?.values ?? {}
    const valid = bundle_ids.filter((bid) => candidates.some((c) => c.id === bid))
    setStaleBundle(bundle_ids.length - valid.length)
    const values = { ...shipmentDefaults(order.data, ghn), ...draftValues, bundle: valid.map((bid) => ({ id: bid })) }
    form.reset(values)
    guessing.current = !draft && !values.province_id && !!order.data.customer.address
    initialized.current = true
  }, [order.data, ghn, form, customer.isPending, customer.error, candidates])

  // Khách chưa có địa chỉ GHN: đoán dần từng cấp khi danh mục tải về.
  useEffect(() => {
    if (!guessing.current || !order.data) return
    const address = order.data.customer.address
    const v = form.getValues()
    const step = (list: GhnPlace[] | undefined, field: 'province_id' | 'district_id' | 'ward_id') => {
      if (!list) return // chờ danh mục
      const hit = guessPlace(address, list)
      if (hit) form.setValue(field, hit.id)
      if (!hit || field === 'ward_id') guessing.current = false
    }
    if (!v.province_id) step(provinces.data, 'province_id')
    else if (!v.is_new_address && !v.district_id) step(districts.data, 'district_id')
    else if (!v.ward_id) step(wards.data, 'ward_id')
    else guessing.current = false
  }, [provinces.data, districts.data, wards.data, order.data, form, isNew, provinceId, districtId])

  const setAddressMode = (next: boolean) => {
    if (next === isNew) return
    form.setValue('is_new_address', next, { shouldDirty: true })
    form.setValue('province_id', 0, { shouldDirty: true })
    form.setValue('district_id', 0, { shouldDirty: true })
    form.setValue('ward_id', 0, { shouldDirty: true })
    form.clearErrors(['province_id', 'district_id', 'ward_id'])
    guessing.current = !!order.data?.customer.address
  }

  /** Chọn / bỏ đơn gửi kèm: cộng / trừ phần còn thu vào COD (khối lượng người bán tự nhập). */
  const toggleBundle = (c: OrderView, on: boolean) => {
    const current = form.getValues('bundle') ?? []
    form.setValue('bundle', on ? [...current, { id: c.id }] : current.filter((b) => b.id !== c.id), { shouldDirty: true })
    const cod = form.getValues('cod_amount') ?? 0
    form.setValue('cod_amount', Math.max(0, cod + (on ? 1 : -1) * amountDue(c)), { shouldDirty: true, shouldValidate: true })
  }

  // Đổi thông tin thì phí đã tính không còn đúng.
  const watched = JSON.stringify(useWatch({ control: form.control }))
  const resetPreview = preview.reset
  useEffect(() => {
    resetPreview()
  }, [watched, resetPreview])

  if (!config || order.isPending) return <ListSkeleton rows={3} />
  if (order.error) return <ErrorState error={order.error} onRetry={order.refetch} />
  const o = order.data
  const back = `/orders/${id}`

  if (!ghn) {
    // Chưa kết nối GHN: thiết lập ngay tại đây, lưu xong form tạo vận đơn tự hiện ra.
    return (
      <>
        <PageHeader title="Thiết lập Giao Hàng Nhanh" subtitle={`Cần kết nối GHN trước khi gửi đơn ${o.order_code}`} back={back} />
        {settings.isPending ? (
          <ListSkeleton rows={3} />
        ) : settings.error ? (
          <ErrorState error={settings.error} onRetry={settings.refetch} />
        ) : (
          <GhnSettingsForm view={settings.data} />
        )}
      </>
    )
  }
  if (isActiveShipment(o) || o.status === 'cancelled') {
    return (
      <>
        <PageHeader title="Gửi Giao Hàng Nhanh" back={back} />
        <EmptyState
          title={o.status === 'cancelled' ? 'Đơn đã hủy' : `Đơn đã có vận đơn ${o.ghn_order_code}`}
          description={o.status === 'cancelled' ? 'Không thể gửi giao hàng cho đơn đã hủy.' : 'Hủy vận đơn cũ trước nếu muốn tạo lại.'}
          action={
            <Button asChild variant="outline">
              <Link to={back}>Về đơn hàng</Link>
            </Button>
          }
        />
      </>
    )
  }

  const showBundle = bundleOpen ?? candidates.length <= 2
  const province = provinces.data?.find((p) => p.id === provinceId)
  const ward = wards.data?.find((w) => w.id === wardId)
  const district = isNew ? undefined : districts.data?.find((d) => d.id === districtId)
  const fullAddress =
    province && ward && (isNew || district)
      ? formatGhnAddress({ street, ward_name: ward.name, district_name: district?.name, province_name: province.name })
      : ''

  const onPreview = form.handleSubmit((values) =>
    preview.mutate(values, { onError: (err) => toast.error(errorMessage(err), { duration: 8000 }) }),
  )
  const draft = readDraft(o.ghn_draft)
  const onSaveDraft = () => {
    const values = form.getValues()
    const { bundle: picked = [], expected_updated_at: _, ...rest } = values
    const body: GhnDraft = { ...rest, bundle_ids: picked.map((b) => b.id) }
    saveDraft.mutate(body, {
      onSuccess: () => {
        // Đã lưu: không còn là thay đổi chưa lưu nữa.
        form.reset(values)
        toast.success('Đã lưu nháp — mở lại đơn này để làm tiếp')
      },
      onError: (err) => toast.error(errorMessage(err)),
    })
  }
  const onDiscardDraft = () =>
    saveDraft.mutate(null, {
      onSuccess: () => {
        if (ghn) form.reset({ ...shipmentDefaults(o, ghn), bundle: [] })
        setStaleBundle(0)
        toast.success('Đã bỏ nháp')
      },
      onError: (err) => toast.error(errorMessage(err)),
    })

  // Không tạo vận đơn ngay: hỏi xác nhận (kèm phí) trước, vì tạo xong là GHN đến lấy hàng.
  const onSubmit = form.handleSubmit((values) => {
    setConfirmValues(values)
    if (!preview.data) preview.mutate(values, { onError: () => undefined })
  })
  const onConfirmCreate = () => {
    if (!confirmValues) return
    create.mutate(
      {
        ...confirmValues,
        expected_updated_at: o.updated_at,
        // Gửi đúng các đơn đã chọn (kể cả đơn vừa không còn hợp lệ — server sẽ từ chối và báo rõ, thay vì
        // lặng lẽ bỏ đơn đó mà COD vẫn còn cộng tiền của nó). Kèm thời điểm sửa để phát hiện đơn vừa bị sửa.
        bundle: bundle.map((b) => ({
          id: b.id,
          expected_updated_at: customer.data?.orders.find((x) => x.id === b.id)?.updated_at,
        })),
      },
      {
        onSuccess: (saved) => {
          toast.success(
            `Đã tạo vận đơn GHN ${saved.ghn_order_code}` + (bundle.length ? ` (gửi chung ${bundle.length + 1} đơn)` : ''),
          )
          setConfirmValues(null)
          guard.allow()
          navigate(back, { replace: true })
        },
        onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
      },
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      onKeyDown={(e) => {
        // Enter (hay phím "Đi" trên điện thoại) trong ô nhập không được tự gửi đơn sang GHN.
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault()
      }}
    >
      <PageHeader
        title="Gửi Giao Hàng Nhanh"
        subtitle={
          <>
            <span className="font-mono">{o.order_code}</span> · {o.items_summary} · {formatVND(o.total_amount)}
            {ghn.env !== 'production' && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                {ghn.env === 'demo' ? 'GHN giả lập' : 'GHN thử nghiệm'}
              </span>
            )}
          </>
        }
        back={back}
      />

      {draft && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <span className="flex items-center gap-2">
            <FileText className="size-4 shrink-0" />
            Đang mở bản nháp{draft.savedAt && ` lưu lúc ${formatDateTime(draft.savedAt)}`}
          </span>
          <Button type="button" variant="ghost" size="sm" loading={saveDraft.isPending && saveDraft.variables === null} onClick={onDiscardDraft}>
            <Trash2 /> Bỏ nháp
          </Button>
        </div>
      )}

      {(candidates.length > 0 || staleBundle > 0 || lostBundle.length > 0) && (
        <section className="mb-4 rounded-xl border border-violet-200 bg-violet-50/60 p-4">
          <button
            type="button"
            className="flex w-full items-start justify-between gap-3 text-left"
            aria-expanded={showBundle}
            onClick={() => setBundleOpen(!showBundle)}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 font-semibold text-violet-900">
                <PackagePlus className="size-4 shrink-0" /> Gửi chung với đơn khác của khách
              </span>
              <span className="mt-0.5 block text-sm text-violet-900/80">
                {bundled.length > 0 && (
                  <b>
                    Đã chọn {bundled.length} (+{formatVND(bundled.reduce((s, c) => s + amountDue(c), 0))})
                  </b>
                )}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-violet-800">
              {showBundle ? 'Thu gọn' : 'Xem'}
              <ChevronDown className={cn('size-4 transition-transform', showBundle && 'rotate-180')} />
            </span>
          </button>
          {staleBundle > 0 && (
            <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
              {staleBundle} đơn gửi kèm trong nháp không còn gửi được (đã gửi riêng hoặc đổi trạng thái) — kiểm tra lại tiền thu hộ.
            </p>
          )}
          {lostBundle.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
              <span>
                <b className="font-mono">{lostBundle.map((x) => x.order_code).join(', ')}</b> vừa được gửi riêng hoặc đổi trạng thái — không
                gửi kèm được nữa.
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => lostBundle.forEach((x) => toggleBundle(x, false))}>
                Bỏ chọn & trừ tiền
              </Button>
            </div>
          )}
          {showBundle && bundleFull && (
            <p className="mt-2 text-sm text-violet-900/80">Đã chọn tối đa {MAX_BUNDLE_ORDERS} đơn gửi kèm cho một vận đơn.</p>
          )}
          {showBundle && (
            <ul className="mt-3 grid gap-2">
              {candidates.map((c) => {
                const checked = bundle.some((b) => b.id === c.id)
                const otherAddress = !!c.customer.address && !!o.customer.address && c.customer.address !== o.customer.address
                return (
                  <li key={c.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 text-sm transition-colors',
                        checked ? 'border-violet-400 ring-1 ring-violet-400' : 'hover:bg-secondary/40',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 size-5 shrink-0 accent-violet-600"
                        checked={checked}
                        disabled={!checked && bundleFull}
                        onChange={(e) => toggleBundle(c, e.target.checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span>
                            <b className="font-mono">{c.order_code}</b> · {c.group_name}
                          </span>
                          <span className="tabular-nums">
                            còn thu <b>{formatVND(amountDue(c))}</b>
                          </span>
                        </span>
                        <span className="block text-muted-foreground">
                          {c.items_summary} · {formatNumber(itemCount(c))} sản phẩm
                        </span>
                        {c.note && <span className="block text-xs text-muted-foreground italic">Ghi chú: {c.note}</span>}
                        {otherAddress && <span className="block text-xs text-amber-700">Lưu ý: đơn này ghi địa chỉ khác</span>}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      <div className="grid gap-4 pb-24 md:pb-0 lg:grid-cols-2 lg:items-start">
        <FormSection
          title="Người nhận"
          description="Tỉnh/phường chọn theo danh mục địa chỉ của GHN."
        >
          <div className="grid gap-4">
            <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-sm">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">Địa chỉ khách nhập khi tạo đơn</div>
                  <div className="font-medium break-words">{o.customer.address || '(chưa có địa chỉ)'}</div>
                  <div className="text-xs text-muted-foreground">
                    {o.customer.name} · {o.customer.phone}
                  </div>
                  {o.note && <div className="mt-1 text-xs whitespace-pre-line italic">Ghi chú đơn: {o.note}</div>}
                </div>
              </div>
              {o.customer.address && o.customer.address !== street && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-8"
                  onClick={() => form.setValue('street', o.customer.address, { shouldDirty: true, shouldValidate: true })}
                >
                  <CornerDownLeft /> Dùng làm số nhà, tên đường
                </Button>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tên người nhận" htmlFor="to_name" error={errors.to_name?.message} required>
                <Input id="to_name" {...form.register('to_name')} aria-invalid={!!errors.to_name} />
              </Field>
              <Field label="Số điện thoại" htmlFor="to_phone" error={errors.to_phone?.message} required>
                <Input id="to_phone" type="tel" inputMode="tel" {...form.register('to_phone')} aria-invalid={!!errors.to_phone} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
              <span className="text-sm font-medium">Địa chỉ nhận</span>
              <Switch
                checked={isNew}
                onCheckedChange={setAddressMode}
                label={
                  <span title="Bật: địa chỉ sau sáp nhập 01/07/2025 (Tỉnh/Thành → Phường/Xã). Tắt: địa chỉ cũ (Tỉnh → Quận/Huyện → Phường/Xã).">
                    Địa chỉ mới
                  </span>
                }
              />
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              {isNew
                ? 'Địa chỉ sau sáp nhập 01/07/2025: Tỉnh/Thành → Phường/Xã.'
                : 'Địa chỉ cũ: Tỉnh/Thành → Quận/Huyện → Phường/Xã (GHN tự chuyển sang địa chỉ mới).'}
            </p>
            <div className={cn('grid gap-4', isNew ? 'sm:grid-cols-2' : 'sm:grid-cols-3 lg:grid-cols-1 2xl:grid-cols-3')}>
              <Field label="Tỉnh - Thành phố" htmlFor="province" error={errors.province_id?.message ?? (provinces.error ? errorMessage(provinces.error) : undefined)} required>
                <PlacePicker
                  id="province"
                  places={provinces.data}
                  loading={provinces.isPending}
                  value={provinceId}
                  placeholder="Chọn Tỉnh - Thành phố"
                  invalid={!!errors.province_id}
                  onChange={(p) => {
                    guessing.current = false
                    if (p.id === provinceId) return
                    form.setValue('province_id', p.id, { shouldDirty: true, shouldValidate: true })
                    form.setValue('district_id', 0, { shouldDirty: true })
                    form.setValue('ward_id', 0, { shouldDirty: true })
                  }}
                />
              </Field>
              {!isNew && (
                <Field label="Quận - Huyện" htmlFor="district" error={errors.district_id?.message ?? (districts.error ? errorMessage(districts.error) : undefined)} required>
                  <PlacePicker
                    id="district"
                    places={districts.data}
                    loading={provinceId > 0 && districts.isPending}
                    disabled={!provinceId}
                    value={districtId}
                    placeholder="Chọn Quận - Huyện"
                    invalid={!!errors.district_id}
                    onChange={(d) => {
                      guessing.current = false
                      if (d.id === districtId) return
                      form.setValue('district_id', d.id, { shouldDirty: true, shouldValidate: true })
                      form.setValue('ward_id', 0, { shouldDirty: true })
                    }}
                  />
                </Field>
              )}
              <Field label="Phường - Xã" htmlFor="ward" error={errors.ward_id?.message ?? (wards.error ? errorMessage(wards.error) : undefined)} required>
                <PlacePicker
                  id="ward"
                  places={wards.data}
                  loading={(isNew ? provinceId : districtId) > 0 && wards.isPending}
                  disabled={isNew ? !provinceId : !districtId}
                  value={wardId}
                  placeholder="Chọn Phường - Xã"
                  invalid={!!errors.ward_id}
                  onChange={(w) => {
                    guessing.current = false
                    form.setValue('ward_id', w.id, { shouldDirty: true, shouldValidate: true })
                  }}
                />
              </Field>
            </div>
            <Field
              label="Số nhà, tên đường"
              htmlFor="street"
              error={errors.street?.message}
              required
            >
              <Input id="street" {...form.register('street')} aria-invalid={!!errors.street} />
            </Field>
            {fullAddress && (
              <p className="rounded-lg bg-secondary px-3 py-2 text-sm">
                <span className="text-muted-foreground">Địa chỉ gửi GHN: </span>
                {fullAddress}
              </p>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" {...form.register('save_address')} />
              Lưu địa chỉ này cho khách để lần sau tự điền
            </label>
          </div>
        </FormSection>

        <FormSection title="Kiện hàng & thu hộ">
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Tiền thu hộ (COD)"
                htmlFor="cod"
                error={errors.cod_amount?.message}
                hint={
                  bundled.length
                    ? `Gồm ${o.order_code} ${formatVND(amountDue(o))}` +
                      bundled.map((c) => ` + ${c.order_code} ${formatVND(amountDue(c))}`).join('') +
                      ` = ${formatVND(bundled.reduce((s, c) => s + amountDue(c), amountDue(o)))}.`
                    : o.paid_amount > 0
                      ? `Tổng đơn ${formatVND(o.total_amount)}, khách đã trả ${formatVND(o.paid_amount)} → còn thu ${formatVND(amountDue(o))}.`
                      : `Tổng đơn ${formatVND(o.total_amount)}. Nhập 0 nếu khách đã chuyển khoản.`
                }
              >
                <Controller
                  control={form.control}
                  name="cod_amount"
                  render={({ field }) => <MoneyInput id="cod" value={field.value} onChange={field.onChange} aria-invalid={!!errors.cod_amount} />}
                />
              </Field>
              <Field label="Khai giá (bảo hiểm)" htmlFor="insurance" error={errors.insurance_value?.message} hint="0 = không khai giá.">
                <Controller
                  control={form.control}
                  name="insurance_value"
                  render={({ field }) => <MoneyInput id="insurance" value={field.value} onChange={field.onChange} />}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ['weight', 'Nặng (gram)'],
                  ['length', 'Dài (cm)'],
                  ['width', 'Rộng (cm)'],
                  ['height', 'Cao (cm)'],
                ] as const
              ).map(([name, label]) => (
                <Field key={name} label={label} htmlFor={name} error={errors[name]?.message}>
                  <Controller
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <Input
                        id={name}
                        inputMode="numeric"
                        className="text-right tabular-nums"
                        value={field.value ? String(field.value) : ''}
                        onChange={(e) => field.onChange(intValue(e.target.value))}
                        aria-invalid={!!errors[name]}
                      />
                    )}
                  />
                </Field>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Người trả phí ship" htmlFor="payment">
                <Controller
                  control={form.control}
                  name="payment_type_id"
                  render={({ field }) => (
                    <Dropdown id="payment" value={field.value} onChange={field.onChange} options={PAYMENT_OPTIONS} />
                  )}
                />
              </Field>
              <Field label="Cho xem hàng" htmlFor="required_note">
                <Controller
                  control={form.control}
                  name="required_note"
                  render={({ field }) => (
                    <Dropdown id="required_note" value={field.value} onChange={field.onChange} options={REQUIRED_NOTE_OPTIONS} />
                  )}
                />
              </Field>
            </div>
            <Field label="Ghi chú cho tài xế" htmlFor="note" error={errors.note?.message}>
              <Textarea id="note" placeholder="Ví dụ: Gọi trước khi giao" {...form.register('note')} />
            </Field>
          </div>
        </FormSection>
      </div>

      {preview.data && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Phí GHN dự kiến: <b className="tabular-nums">{formatVND(preview.data.total_fee)}</b>
          {preview.data.expected_delivery_time && <> · Giao dự kiến: <b>{formatDate(preview.data.expected_delivery_time)}</b></>}
        </div>
      )}

      <StickyFormBar>
        <Button
          type="button"
          variant="info"
          size="lg"
          className="px-3 md:h-10 md:px-4 md:text-sm"
          loading={saveDraft.isPending && saveDraft.variables !== null}
          onClick={onSaveDraft}
          aria-label="Lưu nháp"
        >
          <Save /> <span className="sm:hidden">Nháp</span>
          <span className="hidden sm:inline">Lưu nháp</span>
        </Button>
        {/* Tính phí chiếm phần lớn chỗ: bấm thường xuyên; nút tạo đơn gọn lại để khó bấm nhầm. */}
        <Button
          type="button"
          variant="success"
          size="lg"
          className="min-w-0 flex-1 px-3 md:h-10 md:min-w-44 md:flex-none md:px-5 md:text-sm"
          loading={preview.isPending}
          onClick={onPreview}
        >
          <Calculator /> Tính phí
        </Button>
        <Button type="submit" variant="ghn" size="lg" className="shrink-0 px-3 md:h-10 md:px-4 md:text-sm" loading={create.isPending}>
          <Send /> <span className="sm:hidden">Gửi GHN</span>
          <span className="hidden sm:inline">Tạo đơn GHN</span>
        </Button>
      </StickyFormBar>
      <ConfirmDialog
        open={!!confirmValues}
        onOpenChange={(open) => !open && !create.isPending && setConfirmValues(null)}
        title={
          bundled.length
            ? `Tạo 1 vận đơn GHN cho ${bundled.length + 1} đơn?`
            : `Tạo vận đơn GHN cho ${o.order_code}?`
        }
        description={
          confirmValues && (
            <span className="grid gap-1 text-foreground">
              <span>
                <b>{confirmValues.to_name}</b> · {confirmValues.to_phone}
              </span>
              <span>{fullAddress}</span>
              {bundled.length > 0 && (
                <span>
                  Gửi chung: <b className="font-mono">{[o, ...bundled].map((c) => c.order_code).join(', ')}</b>
                </span>
              )}
              <span>
                Thu hộ: <b>{formatVND(confirmValues.cod_amount)}</b> · Phí GHN:{' '}
                <b>{preview.data ? formatVND(preview.data.total_fee) : preview.isPending ? 'đang tính…' : 'chưa tính được'}</b>
              </span>
              <span className="mt-1 text-muted-foreground">
                {ghn.env === 'production'
                  ? 'Đây là đơn THẬT: GHN sẽ đến lấy hàng và tính phí. Muốn lưu lại để gửi sau, chọn “Quay lại” rồi bấm “Lưu nháp”.'
                  : 'Môi trường thử nghiệm: đơn không giao thật.'}
              </span>
            </span>
          )
        }
        confirmLabel="Tạo vận đơn"
        confirmVariant="ghn"
        cancelLabel="Quay lại"
        loading={create.isPending}
        onConfirm={onConfirmCreate}
      />
      {guard.dialog}
    </form>
  )
}
