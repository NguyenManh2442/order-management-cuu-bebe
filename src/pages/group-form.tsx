import { zodResolver } from '@hookform/resolvers/zod'
import { Save } from 'lucide-react'
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { GROUP_STATUSES, GROUP_STATUS_LABELS } from '@shared/constants'
import { groupInputSchema, type GroupInput } from '@shared/schemas'
import { FormSection, MoneyInput, StickyFormBar, useUnsavedChangesGuard } from '@/components/form-helpers'
import { PageHeader } from '@/components/page-header'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'
import { useGroup, useSaveGroup } from '@/lib/queries'
import { cn } from '@/lib/utils'

const EMPTY: GroupInput = { name: '', description: '', product_name: '', default_unit_price: 0, status: 'open' }

export function GroupFormPage() {
  const { id } = useParams()
  const isEdit = !!id
  const navigate = useNavigate()
  const existing = useGroup(id ?? '')
  const save = useSaveGroup(id)
  const form = useForm<GroupInput>({ resolver: zodResolver(groupInputSchema), defaultValues: EMPTY })
  const { errors, isDirty } = form.formState
  const guard = useUnsavedChangesGuard(isDirty && !save.isSuccess)

  const group = existing.data?.group
  useEffect(() => {
    if (group) {
      form.reset({
        name: group.name,
        description: group.description,
        product_name: group.product_name,
        default_unit_price: group.default_unit_price,
        status: group.status,
        expected_updated_at: group.updated_at,
      })
    }
  }, [group, form])

  if (isEdit && existing.isPending) return <ListSkeleton rows={3} />
  if (isEdit && existing.error) return <ErrorState error={existing.error} onRetry={existing.refetch} />

  const onSubmit = form.handleSubmit((values) =>
    save.mutate(values, {
      onSuccess: (saved) => {
        toast.success(isEdit ? 'Đã lưu nhóm' : `Đã tạo nhóm "${saved.name}"`)
        guard.allow()
        navigate(`/groups/${saved.id}`, { replace: true })
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  )

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader title={isEdit ? 'Sửa nhóm' : 'Tạo nhóm mới'} back={isEdit ? `/groups/${id}` : '/groups'} />
      <div className="grid max-w-2xl gap-4">
        <FormSection title="Thông tin nhóm">
          <div className="grid gap-4">
            <Field label="Tên nhóm" htmlFor="name" required error={errors.name?.message} hint="Ví dụ: Mẫu váy Noel, Áo dài Tết 2027">
              <Input id="name" autoFocus={!isEdit} aria-invalid={!!errors.name} {...form.register('name')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tên mẫu sản phẩm" htmlFor="product_name" error={errors.product_name?.message}>
                <Input id="product_name" {...form.register('product_name')} />
              </Field>
              <Field label="Đơn giá mặc định" htmlFor="default_unit_price" error={errors.default_unit_price?.message} hint="Tự điền khi thêm đơn vào nhóm">
                <Controller
                  control={form.control}
                  name="default_unit_price"
                  render={({ field }) => <MoneyInput id="default_unit_price" value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
                />
              </Field>
            </div>
            <Field label="Mô tả" htmlFor="description" error={errors.description?.message}>
              <Textarea id="description" rows={3} {...form.register('description')} />
            </Field>
            {isEdit && (
              <Field label="Trạng thái nhóm">
                <Controller
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <div className="grid grid-cols-2 gap-2">
                      {GROUP_STATUSES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => field.onChange(s)}
                          className={cn(
                            'h-11 rounded-lg border text-sm font-medium',
                            field.value === s ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
                          )}
                        >
                          {GROUP_STATUS_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  )}
                />
              </Field>
            )}
          </div>
        </FormSection>
      </div>
      <StickyFormBar className="md:max-w-2xl">
        <Button type="button" variant="outline" size="lg" className="md:h-10 md:text-sm" onClick={() => navigate(isEdit ? `/groups/${id}` : '/groups')}>
          Hủy
        </Button>
        <Button type="submit" size="lg" className="flex-1 md:h-10 md:flex-none md:text-sm" loading={save.isPending}>
          <Save /> {isEdit ? 'Lưu thay đổi' : 'Tạo nhóm'}
        </Button>
      </StickyFormBar>
      {guard.dialog}
    </form>
  )
}
