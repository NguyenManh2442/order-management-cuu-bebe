import { zodResolver } from '@hookform/resolvers/zod'
import { Save, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '@shared/constants'
import { expenseInputSchema, type ExpenseInput } from '@shared/schemas'
import { FormSection, MoneyInput, StickyFormBar, useUnsavedChangesGuard } from '@/components/form-helpers'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'
import { useDeleteExpense, useExpenses, useSaveExpense } from '@/lib/queries'
import { cn, dateKey } from '@/lib/utils'

const NAME_SUGGESTIONS = [
  'Chạy quảng cáo Facebook',
  'Chạy quảng cáo TikTok',
  'Túi zip, hộp giấy',
  'Băng keo, tem nhãn',
  'Thuê người đóng gói',
  'Phí ship hoàn hàng',
  'Cước điện thoại, internet',
]

export function ExpenseFormPage() {
  const { id } = useParams()
  const isEdit = !!id
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const expenses = useExpenses()
  const save = useSaveExpense(id)
  const remove = useDeleteExpense()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const presetDate = params.get('date') ?? ''
  const form = useForm<ExpenseInput>({
    resolver: zodResolver(expenseInputSchema),
    defaultValues: {
      date: /^\d{4}-\d{2}-\d{2}$/.test(presetDate) ? presetDate : dateKey(new Date().toISOString()),
      category: 'ads',
      name: '',
      amount: 0,
      note: '',
    },
  })
  const { errors, isDirty } = form.formState
  const guard = useUnsavedChangesGuard(isDirty && !save.isSuccess && !remove.isSuccess)

  const expense = expenses.data?.find((e) => e.id === id)
  // Quay về đúng tháng của khoản chi trên trang Thu chi.
  const backTo = (date: string) => `/finance?year=${date.slice(0, 4)}&period=${date.slice(0, 7)}`
  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current || !expense) return
    form.reset({
      date: expense.date,
      category: expense.category,
      name: expense.name,
      amount: expense.amount,
      note: expense.note,
      expected_updated_at: expense.updated_at,
    })
    initialized.current = true
  }, [expense, form])

  if (isEdit && expenses.isPending) return <ListSkeleton rows={3} />
  if (isEdit && expenses.error) return <ErrorState error={expenses.error} onRetry={expenses.refetch} />
  if (isEdit && !expense) return <EmptyState title="Không tìm thấy khoản chi" description="Có thể khoản chi đã bị xóa." />

  const onSubmit = form.handleSubmit((v) =>
    save.mutate(v, {
      onSuccess: () => {
        toast.success(isEdit ? 'Đã lưu khoản chi' : 'Đã thêm khoản chi')
        guard.allow()
        navigate(backTo(v.date), { replace: true })
      },
      onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
    }),
  )

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader
        title={isEdit ? 'Sửa chi phí ngoài' : 'Thêm chi phí ngoài'}
        subtitle="Chi phí chung của shop, không thuộc nhóm hàng nào"
        back={backTo(form.getValues('date'))}
      />
      <div className="grid max-w-2xl gap-4">
        <FormSection title="Khoản chi">
          <div className="grid gap-4">
            <Field label="Loại">
              <Controller
                control={form.control}
                name="category"
                render={({ field }) => (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
                    {EXPENSE_CATEGORIES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={field.value === c}
                        onClick={() => field.onChange(c)}
                        className={cn(
                          'min-h-11 rounded-lg border px-2 text-sm font-medium',
                          field.value === c ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
                        )}
                      >
                        {EXPENSE_CATEGORY_LABELS[c]}
                      </button>
                    ))}
                  </div>
                )}
              />
            </Field>
            <Field label="Tên khoản chi" htmlFor="expense_name" required error={errors.name?.message}>
              <Input
                id="expense_name"
                list="expense-names"
                autoComplete="off"
                placeholder="Ví dụ: Chạy quảng cáo Facebook"
                aria-invalid={!!errors.name}
                {...form.register('name')}
              />
              <datalist id="expense-names">
                {NAME_SUGGESTIONS.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Số tiền" htmlFor="amount" required error={errors.amount?.message}>
                <Controller
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <MoneyInput id="amount" value={field.value} onChange={field.onChange} onBlur={field.onBlur} aria-invalid={!!errors.amount} />
                  )}
                />
              </Field>
              <Field label="Ngày chi" htmlFor="date" required error={errors.date?.message} hint="Khoản chi được tính vào tháng của ngày này.">
                <Input id="date" type="date" aria-invalid={!!errors.date} {...form.register('date')} />
              </Field>
            </div>
            <Field label="Ghi chú" htmlFor="expense_note" error={errors.note?.message}>
              <Textarea id="expense_note" rows={2} placeholder="Ví dụ: chạy 7 ngày cho mẫu váy Noel" {...form.register('note')} />
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
        <Button type="button" variant="outline" size="lg" className="md:h-10 md:text-sm" onClick={() => navigate(-1)}>
          Hủy
        </Button>
        <Button type="submit" size="lg" className="flex-1 md:h-10 md:flex-none md:text-sm" loading={save.isPending}>
          <Save /> {isEdit ? 'Lưu' : 'Thêm khoản chi'}
        </Button>
      </StickyFormBar>
      {guard.dialog}
      {expense && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Xóa khoản chi "${expense.name}"?`}
          description="Số liệu thu chi của tháng sẽ tính lại."
          confirmLabel="Xóa"
          destructive
          loading={remove.isPending}
          onConfirm={() =>
            remove.mutate(expense, {
              onSuccess: () => {
                toast.success('Đã xóa khoản chi')
                guard.allow()
                navigate(backTo(expense.date), { replace: true })
              },
              onError: (err) => toast.error(errorMessage(err)),
            })
          }
        />
      )}
    </form>
  )
}
