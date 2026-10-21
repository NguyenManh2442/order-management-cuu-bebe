import { CheckCircle2, Copy, KeyRound, Save, Shuffle, TriangleAlert } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Controller, useForm, useWatch, type FieldPath } from 'react-hook-form'
import { toast } from 'sonner'
import {
  type GhnDefaults,
  type GhnEnv,
  type GhnSettingsView,
} from '@shared/ghn'
import { ghnSettingsInputSchema, type GhnSettingsInput } from '@shared/schemas'
import { FormSection, StickyFormBar } from '@/components/form-helpers'
import { PlacePicker } from '@/components/place-picker'
import { Button } from '@/components/ui/button'
import { Dropdown } from '@/components/ui/dropdown'
import { Field, Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'
import { PAYMENT_OPTIONS, REQUIRED_NOTE_OPTIONS } from '@/lib/ghn-options'
import { useGhnSetupPlaces, useGhnShops, useSaveGhnSettings } from '@/lib/queries'
import { cn } from '@/lib/utils'

interface FormValues {
  env: GhnEnv
  token: string
  shop_id: string
  webhook_secret: string
  use_sender: boolean
  sender: { name: string; phone: string; street: string; province_id: number; ward_id: number }
  defaults: GhnDefaults
}

function initialValues(v: GhnSettingsView): FormValues {
  return {
    env: v.env,
    token: '',
    shop_id: v.shop_id,
    webhook_secret: v.webhook_secret,
    use_sender: !!v.sender,
    sender: {
      name: v.sender?.name ?? '',
      phone: v.sender?.phone ?? '',
      street: v.sender?.street ?? '',
      province_id: v.sender?.province_id ?? 0,
      ward_id: v.sender?.ward_id ?? 0,
    },
    defaults: v.defaults,
  }
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success('Đã sao chép'),
    () => toast.error('Không sao chép được, hãy chọn và sao chép thủ công'),
  )
}

const intValue = (v: string) => {
  const digits = v.replace(/\D/g, '').slice(0, 6)
  return digits ? Number(digits) : 0
}

/** Kết nối GHN: token → chọn cửa hàng → địa chỉ lấy hàng → giá trị mặc định → webhook. */
export function GhnSettingsForm({ view, onSaved }: { view: GhnSettingsView; onSaved?: () => void }) {
  const form = useForm<FormValues>({ defaultValues: initialValues(view) })
  const { errors } = form.formState
  const shops = useGhnShops()
  const save = useSaveGhnSettings()

  const env = useWatch({ control: form.control, name: 'env' })
  const token = useWatch({ control: form.control, name: 'token' }).trim()
  const shopId = useWatch({ control: form.control, name: 'shop_id' })
  const useSender = useWatch({ control: form.control, name: 'use_sender' })
  const provinceId = useWatch({ control: form.control, name: 'sender.province_id' })
  const wardId = useWatch({ control: form.control, name: 'sender.ward_id' })
  const webhookSecret = useWatch({ control: form.control, name: 'webhook_secret' })

  // Token đã lưu chỉ dùng được cho đúng môi trường của nó.
  const savedTokenUsable = view.has_token && view.env === env
  const hasToken = !!token || savedTokenUsable
  const selectedShop = shops.data?.find((s) => String(s.id) === shopId)
  const credsChecked = !!selectedShop

  // Có token đã lưu thì tự tải danh sách cửa hàng khi mở form.
  const autoLoaded = useRef(false)
  const loadShops = shops.mutate
  useEffect(() => {
    if (autoLoaded.current || !view.has_token) return
    autoLoaded.current = true
    loadShops({ env: view.env, token: '' })
  }, [view, loadShops])

  // Đổi token/môi trường thì danh sách cửa hàng cũ không còn đúng.
  const resetShops = shops.reset
  const credsKey = `${env}|${token}`
  const lastCreds = useRef(credsKey)
  useEffect(() => {
    if (lastCreds.current === credsKey) return
    lastCreds.current = credsKey
    resetShops()
  }, [credsKey, resetShops])

  const placesEnabled = useSender && credsChecked
  const provinces = useGhnSetupPlaces({ env, token, shop_id: shopId, province_id: 0 }, placesEnabled)
  const wards = useGhnSetupPlaces({ env, token, shop_id: shopId, province_id: provinceId }, placesEnabled && provinceId > 0)

  // Địa chỉ khai báo bằng tên trong .env (chưa có mã): tìm mã theo tên khi danh mục về.
  useEffect(() => {
    if (!provinces.data || provinceId || !view.sender?.province_name) return
    const p = provinces.data.find((x) => x.name === view.sender!.province_name)
    if (p) form.setValue('sender.province_id', p.id)
  }, [provinces.data, provinceId, view.sender, form])
  useEffect(() => {
    if (!wards.data || wardId || !view.sender?.ward_name) return
    const w = wards.data.find((x) => x.name === view.sender!.ward_name)
    if (w) form.setValue('sender.ward_id', w.id)
  }, [wards.data, wardId, view.sender, form])

  const checkShops = () =>
    shops.mutate(
      { env, token },
      {
        onSuccess: (list) => {
          if (!list.length) toast.error('Token này chưa có cửa hàng nào trên GHN')
          else if (!list.some((s) => String(s.id) === form.getValues('shop_id'))) {
            form.setValue('shop_id', String(list[0].id), { shouldDirty: true })
          }
        },
        onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
      },
    )

  const onSubmit = form.handleSubmit((v) => {
    const input: GhnSettingsInput = {
      env: v.env,
      token: v.token.trim(),
      shop_id: v.shop_id,
      webhook_secret: v.webhook_secret.trim(),
      sender: v.use_sender ? v.sender : null,
      defaults: v.defaults,
    }
    const parsed = ghnSettingsInputSchema.safeParse(input)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        form.setError(issue.path.join('.') as FieldPath<FormValues>, { message: issue.message })
      }
      toast.error('Kiểm tra lại các ô báo lỗi')
      return
    }
    save.mutate(parsed.data, {
      onSuccess: () => {
        toast.success('Đã lưu thiết lập Giao Hàng Nhanh')
        form.reset({ ...v, token: '' })
        onSaved?.()
      },
      onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
    })
  })

  const webhookUrl = `${window.location.origin}/api/ghn/webhook`

  return (
    <form onSubmit={onSubmit} noValidate>
      {view.source === 'none' && view.demo_fallback && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Đang dùng <b>GHN giả lập</b> (chế độ demo). Lưu thiết lập bên dưới để kết nối GHN thật.
        </p>
      )}
      {view.read_only && (
        <p className="mb-4 flex gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {view.read_only}
        </p>
      )}
      {view.source === 'env' && !view.read_only && (
        <p className="mb-4 rounded-xl border bg-secondary px-4 py-3 text-sm">
          Đang dùng cấu hình từ file <code>.env</code>. Lưu ở đây sẽ ghi vào file thiết lập trên server và được ưu tiên hơn <code>.env</code>.
        </p>
      )}

      <div className="grid gap-4 pb-24 md:pb-0 lg:grid-cols-2 lg:items-start">
        <FormSection
          title="1. Kết nối"
          description={
            <>
              Token lấy ở trang Developer của GHN → <b>Quản lý token</b>. Token môi trường thử nghiệm và thật là khác nhau.
            </>
          }
        >
          <div className="grid gap-4">
            <Field label="Môi trường" htmlFor="ghn-env">
              <Controller
                control={form.control}
                name="env"
                render={({ field }) => (
                  <Dropdown
                    id="ghn-env"
                    value={field.value}
                    onChange={field.onChange}
                    options={[
                      { value: 'staging', label: 'Thử nghiệm (staging)', description: 'Đơn không giao thật', dot: 'bg-amber-500' },
                      { value: 'production', label: 'Thật (production)', description: 'GHN đến lấy hàng và tính phí', dot: 'bg-emerald-500' },
                    ]}
                  />
                )}
              />
            </Field>
            {env === 'production' && (
              <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                Mỗi lần bấm “Tạo đơn GHN” sẽ tạo vận đơn thật: GHN đến lấy hàng và tính phí.
              </p>
            )}
            <Field
              label="Token API"
              htmlFor="ghn-token"
              hint={savedTokenUsable ? `Đang dùng token …${view.token_hint}. Để trống để giữ nguyên.` : undefined}
            >
              <Input
                id="ghn-token"
                type="password"
                autoComplete="off"
                placeholder={savedTokenUsable ? `•••• ${view.token_hint}` : 'Dán token GHN'}
                {...form.register('token')}
              />
            </Field>
            <Button type="button" variant="info" disabled={!hasToken} loading={shops.isPending} onClick={checkShops}>
              <KeyRound /> Kiểm tra token & lấy cửa hàng
            </Button>

            {shops.data && shops.data.length > 0 && (
              <fieldset className="grid gap-2">
                <legend className="mb-1.5 text-sm font-medium">Cửa hàng</legend>
                {shops.data.map((s) => (
                  <label
                    key={s.id}
                    className={cn(
                      'flex cursor-pointer gap-3 rounded-lg border p-3 text-sm',
                      String(s.id) === shopId && 'border-primary bg-secondary',
                    )}
                  >
                    <input type="radio" value={String(s.id)} className="mt-0.5 size-4" {...form.register('shop_id')} />
                    <span className="min-w-0">
                      <span className="font-medium">{s.name}</span> <span className="text-muted-foreground">· mã {s.id}</span>
                      <span className={cn('block text-xs', s.address ? 'text-muted-foreground' : 'text-amber-700')}>
                        {s.address || 'Chưa có địa chỉ lấy hàng trên GHN — nhập ở mục 2'}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            {!shops.data && view.shop_id && (
              <p className="text-sm text-muted-foreground">Cửa hàng đang dùng: mã {view.shop_id}</p>
            )}
            {errors.shop_id && <p className="text-sm text-destructive">{errors.shop_id.message}</p>}
            {credsChecked && (
              <p className="flex items-center gap-1.5 text-sm text-emerald-700">
                <CheckCircle2 className="size-4" /> Token hợp lệ
              </p>
            )}
          </div>
        </FormSection>

        <FormSection
          title="2. Địa chỉ lấy hàng"
          description="Nơi tài xế GHN đến lấy hàng, hàng hoàn cũng trả về đây."
        >
          <div className="grid gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" {...form.register('use_sender')} />
              Nhập địa chỉ lấy hàng tại đây
            </label>
            {!useSender && (
              <p className="text-sm text-muted-foreground">
                {selectedShop && !selectedShop.address
                  ? 'Cửa hàng đã chọn chưa có địa chỉ trên GHN — bắt buộc nhập địa chỉ lấy hàng.'
                  : 'Dùng địa chỉ cửa hàng đã khai báo trên GHN.'}
              </p>
            )}
            {useSender && (
              <>
                {!credsChecked && (
                  <p className="text-sm text-amber-700">Bấm “Kiểm tra token & lấy cửa hàng” để chọn được tỉnh/phường.</p>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Tên người gửi" htmlFor="s-name" hint="Trống = tên cửa hàng">
                    <Input id="s-name" {...form.register('sender.name')} />
                  </Field>
                  <Field label="SĐT người gửi" htmlFor="s-phone" error={errors.sender?.phone?.message} hint="Trống = SĐT cửa hàng">
                    <Input id="s-phone" type="tel" inputMode="tel" {...form.register('sender.phone')} />
                  </Field>
                </div>
                <Field label="Tỉnh / Thành phố" htmlFor="s-province" error={errors.sender?.province_id?.message} required>
                  <PlacePicker
                    id="s-province"
                    places={provinces.data}
                    loading={placesEnabled && provinces.isPending}
                    disabled={!credsChecked}
                    value={provinceId}
                    placeholder="Gõ để tìm tỉnh/thành"
                    invalid={!!errors.sender?.province_id}
                    onChange={(p) => {
                      if (p.id === provinceId) return
                      form.setValue('sender.province_id', p.id, { shouldDirty: true })
                      form.setValue('sender.ward_id', 0, { shouldDirty: true })
                    }}
                  />
                </Field>
                <Field label="Phường / Xã" htmlFor="s-ward" error={errors.sender?.ward_id?.message} required>
                  <PlacePicker
                    id="s-ward"
                    places={wards.data}
                    loading={provinceId > 0 && wards.isPending && placesEnabled}
                    disabled={!credsChecked || !provinceId}
                    value={wardId}
                    placeholder={provinceId ? 'Gõ để tìm phường/xã' : 'Chọn tỉnh/thành trước'}
                    invalid={!!errors.sender?.ward_id}
                    onChange={(w) => form.setValue('sender.ward_id', w.id, { shouldDirty: true })}
                  />
                </Field>
                <Field label="Số nhà, tên đường" htmlFor="s-street" error={errors.sender?.street?.message} required>
                  <Input id="s-street" {...form.register('sender.street')} />
                </Field>
              </>
            )}
          </div>
        </FormSection>

        <FormSection title="3. Giá trị mặc định khi tạo đơn" description="Vẫn sửa được ở từng đơn.">
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ['defaults.item_weight', 'Nặng/sản phẩm (g)'],
                  ['defaults.length', 'Dài (cm)'],
                  ['defaults.width', 'Rộng (cm)'],
                  ['defaults.height', 'Cao (cm)'],
                ] as const
              ).map(([name, label]) => (
                <Field key={name} label={label} htmlFor={name} error={form.getFieldState(name, form.formState).error?.message}>
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
                      />
                    )}
                  />
                </Field>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Người trả phí ship" htmlFor="d-payment">
                <Controller
                  control={form.control}
                  name="defaults.payment_type"
                  render={({ field }) => (
                    <Dropdown id="d-payment" value={field.value} onChange={field.onChange} options={PAYMENT_OPTIONS} />
                  )}
                />
              </Field>
              <Field label="Cho xem hàng" htmlFor="d-note">
                <Controller
                  control={form.control}
                  name="defaults.required_note"
                  render={({ field }) => (
                    <Dropdown id="d-note" value={field.value} onChange={field.onChange} options={REQUIRED_NOTE_OPTIONS} />
                  )}
                />
              </Field>
            </div>
          </div>
        </FormSection>

        <FormSection
          title="4. Webhook (tự cập nhật trạng thái)"
          description="Cần server có HTTPS truy cập được từ Internet. Không dùng webhook thì bấm “Đồng bộ GHN” ở trang Đơn hàng."
        >
          <div className="grid gap-4">
            <Field label="Mã bí mật webhook" htmlFor="w-secret" error={errors.webhook_secret?.message} hint="Để trống = tắt webhook.">
              <div className="flex gap-2">
                <Input id="w-secret" autoComplete="off" className="font-mono" {...form.register('webhook_secret')} />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11 md:size-10"
                  aria-label="Tạo mã ngẫu nhiên"
                  title="Tạo mã ngẫu nhiên"
                  onClick={() => form.setValue('webhook_secret', randomSecret(), { shouldDirty: true })}
                >
                  <Shuffle />
                </Button>
              </div>
            </Field>
            {webhookSecret && (
              <div className="grid gap-2 rounded-lg bg-secondary p-3 text-sm">
                <p>Trên trang Developer của GHN → <b>Cấu hình webhook</b> → tab Order:</p>
                {(
                  [
                    ['URL', webhookUrl],
                    ['Header tùy chỉnh', 'X-Webhook-Secret'],
                    ['Giá trị header', webhookSecret],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="text-muted-foreground">{label}: </span>
                      <code className="break-all">{value}</code>
                    </span>
                    <Button type="button" variant="ghost" size="sm" aria-label={`Sao chép ${label}`} onClick={() => copy(value)}>
                      <Copy />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </FormSection>
      </div>

      <StickyFormBar>
        <Button
          type="submit"
          variant="ghn"
          size="lg"
          className="flex-1 md:h-10 md:flex-none md:text-sm"
          loading={save.isPending}
          disabled={!!view.read_only}
          title={view.read_only || undefined}
        >
          <Save /> Lưu thiết lập
        </Button>
      </StickyFormBar>
    </form>
  )
}
