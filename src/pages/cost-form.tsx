import { zodResolver } from '@hookform/resolvers/zod'
import { Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { COST_BASES, COST_BASIS_LABELS, COST_CATEGORIES, COST_CATEGORY_LABELS } from '@shared/constants'
import { computeCosts } from '@shared/costs'
import { groupCostInputSchema, type GroupCostInput } from '@shared/schemas'
import { costFormula, costItemCount } from '@/components/group-costs'
import { FormSection, MoneyInput, StickyFormBar, useUnsavedChangesGuard } from '@/components/form-helpers'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'
import { useDeleteCost, useGroup, useSaveCost } from '@/lib/queries'
import { cn, formatNumber, formatVND } from '@/lib/utils'

const EMPTY: GroupCostInput = {
  category: 'material',
  name: '',
  quantity: 1,
  unit: '',
  unit_price: 0,
  basis: 'per_item',
  note: '',
}

const NAME_SUGGESTIONS = ['Vải', 'Vải lót', 'Chỉ', 'Khóa kéo', 'Cúc', 'Ren', 'Mác, tem nhãn', 'Công cắt', 'Công may', 'Công in', 'Công thêu', 'Túi đóng gói', 'Vận chuyển nguyên liệu']
const UNIT_SUGGESTIONS = ['mét', 'cuộn', 'chiếc', 'cái', 'bộ', 'kg', 'lô', 'lần']

function ToggleGroup<T extends string>({
  value,
  options,
  labels,
  onChange,
}: {
  value: T
  options: readonly T[]
  labels: Record<T, string>
  onChange: (v: T) => void
}) {
  return (
    <div className={cn('grid gap-2', options.length === 3 ? 'grid-cols-3' : 'grid-cols-2')} role="radiogroup">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={cn(
            'min-h-11 rounded-lg border px-2 text-sm font-medium',
            value === o ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
          )}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  )
}

/** Ô số cho phép số lẻ, gõ được cả "1,2" kiểu Việt Nam. */
function DecimalInput({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange'> & { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(() => (Number.isFinite(value) ? String(value).replace('.', ',') : ''))
  // Đồng bộ khi form nạp lại giá trị (mở khoản chi để sửa).
  useEffect(() => {
    setText((t) => (Number(t.replace(',', '.')) === value ? t : Number.isFinite(value) ? String(value).replace('.', ',') : ''))
  }, [value])
  return (
    <Input
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.,]/g, '')
        setText(t)
        onChange(t ? Number(t.replace(',', '.')) : Number.NaN)
      }}
      {...props}
    />
  )
}

export function CostFormPage() {
  const { id: groupId = '', costId } = useParams()
  const isEdit = !!costId
  const navigate = useNavigate()
  const group = useGroup(groupId)
  const save = useSaveCost(groupId, costId)
  const remove = useDeleteCost(groupId)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const form = useForm<GroupCostInput>({ resolver: zodResolver(groupCostInputSchema), defaultValues: EMPTY })
  const { errors, isDirty } = form.formState
  const guard = useUnsavedChangesGuard(isDirty && !save.isSuccess && !remove.isSuccess)
  const backTo = `/groups/${groupId}/costs`

  const cost = group.data?.costs.find((c) => c.id === costId)
  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current || !cost) return
    form.reset({
      category: cost.category,
      name: cost.name,
      quantity: cost.quantity,
      unit: cost.unit,
      unit_price: cost.unit_price,
      basis: cost.basis,
      note: cost.note,
      expected_updated_at: cost.updated_at,
    })
    initialized.current = true
  }, [cost, form])

  const values = useWatch({ control: form.control })
  const itemCount = useMemo(() => costItemCount(group.data?.orders ?? []), [group.data])
  const preview = useMemo(() => {
    const line = {
      basis: values.basis ?? 'fixed',
      quantity: Number.isFinite(values.quantity) ? (values.quantity ?? 0) : 0,
      unit: values.unit ?? '',
      unit_price: values.unit_price ?? 0,
    }
    const [computed] = computeCosts(
      [{ ...line, id: '', group_id: '', category: 'other', name: '', note: '', created_at: '', updated_at: '' }],
      itemCount,
    ).lines
    return { formula: costFormula(line, itemCount), amount: computed.amount }
  }, [values.basis, values.quantity, values.unit, values.unit_price, itemCount])

  if (group.isPending) return <ListSkeleton rows={3} />
  if (group.error) return <ErrorState error={group.error} onRetry={group.refetch} />
  if (isEdit && !cost) return <EmptyState title="Không tìm thấy khoản chi" description="Có thể khoản chi đã bị xóa." />

  const onSubmit = form.handleSubmit((v) =>
    save.mutate(v, {
      onSuccess: () => {
        toast.success(isEdit ? 'Đã lưu khoản chi' : 'Đã thêm khoản chi')
        guard.allow()
        navigate(backTo, { replace: true })
      },
      onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
    }),
  )

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader title={isEdit ? 'Sửa khoản chi' : 'Thêm khoản chi'} subtitle={group.data.group.name} back={backTo} />
      <div className="grid max-w-2xl gap-4">
        <FormSection title="Khoản chi">
          <div className="grid gap-4">
            <Field label="Loại">
              <Controller
                control={form.control}
                name="category"
                render={({ field }) => (
                  <ToggleGroup value={field.value} options={COST_CATEGORIES} labels={COST_CATEGORY_LABELS} onChange={field.onChange} />
                )}
              />
            </Field>
            <Field label="Tên khoản chi" htmlFor="cost_name" required error={errors.name?.message}>
              <Input id="cost_name" list="cost-names" autoComplete="off" placeholder="Ví dụ: Vải nhung, Công may" aria-invalid={!!errors.name} {...form.register('name')} />
              <datalist id="cost-names">
                {NAME_SUGGESTIONS.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </Field>
            <Field
              label="Cách tính"
              hint={
                values.basis === 'per_item'
                  ? `Nhập lượng dùng cho 1 sản phẩm; app nhân với số sản phẩm đã đặt (hiện ${formatNumber(itemCount)}) và tự cập nhật khi có đơn mới.`
                  : 'Nhập tổng số lượng đã mua/thuê cho cả đợt.'
              }
            >
              <Controller
                control={form.control}
                name="basis"
                render={({ field }) => <ToggleGroup value={field.value} options={COST_BASES} labels={COST_BASIS_LABELS} onChange={field.onChange} />}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={values.basis === 'per_item' ? 'Số lượng / sản phẩm' : 'Số lượng'}
                htmlFor="quantity"
                required
                error={errors.quantity?.message}
              >
                <Controller
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <DecimalInput id="quantity" value={field.value} onChange={field.onChange} onBlur={field.onBlur} aria-invalid={!!errors.quantity} />
                  )}
                />
              </Field>
              <Field label="Đơn vị" htmlFor="unit" error={errors.unit?.message}>
                <Input id="unit" list="cost-units" autoComplete="off" placeholder="mét, chiếc…" {...form.register('unit')} />
                <datalist id="cost-units">
                  {UNIT_SUGGESTIONS.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </Field>
            </div>
            <Field label={values.unit ? `Đơn giá (1 ${values.unit})` : 'Đơn giá'} htmlFor="unit_price" required error={errors.unit_price?.message}>
              <Controller
                control={form.control}
                name="unit_price"
                render={({ field }) => <MoneyInput id="unit_price" value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
              />
            </Field>
            <div className="rounded-lg bg-secondary px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Thành tiền</span>
                <span className="text-xl font-bold tabular-nums">{formatVND(preview.amount)}</span>
              </div>
              <div className="mt-0.5 text-right text-xs text-muted-foreground">{preview.formula}</div>
            </div>
            <Field label="Ghi chú" htmlFor="cost_note" error={errors.note?.message}>
              <Textarea id="cost_note" rows={2} placeholder="Ví dụ: mua ở chợ Ninh Hiệp, đã trả 50%" {...form.register('note')} />
            </Field>
          </div>
        </FormSection>
        {isEdit && (
          <Button type="button" variant="destructive-outline" className="justify-self-start" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Xóa khoản chi
          </Button>
        )}
      </div>

      <StickyFormBar className="md:max-w-2xl">
        <Button type="button" variant="outline" size="lg" className="md:h-10 md:text-sm" onClick={() => navigate(backTo)}>
          Hủy
        </Button>
        <Button type="submit" size="lg" className="flex-1 md:h-10 md:flex-none md:text-sm" loading={save.isPending}>
          <Save /> {isEdit ? 'Lưu' : 'Thêm khoản chi'}
        </Button>
      </StickyFormBar>
      {guard.dialog}
      {cost && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Xóa khoản chi "${cost.name}"?`}
          description="Tổng chi phí và lãi dự kiến của nhóm sẽ tính lại."
          confirmLabel="Xóa"
          destructive
          loading={remove.isPending}
          onConfirm={() =>
            remove.mutate(cost, {
              onSuccess: () => {
                toast.success('Đã xóa khoản chi')
                guard.allow()
                navigate(backTo, { replace: true })
              },
              onError: (err) => toast.error(errorMessage(err)),
            })
          }
        />
      )}
    </form>
  )
}
