import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { loginInputSchema, type LoginInput } from '@shared/schemas'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'
import { useLogin, useLoginHints, useMe } from '@/lib/queries'

export function LoginPage() {
  const { data: me } = useMe()
  const { data: hints } = useLoginHints()
  const login = useLogin()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/groups'
  const form = useForm<LoginInput>({ resolver: zodResolver(loginInputSchema), defaultValues: { username: '', password: '' } })

  if (me) return <Navigate to={next} replace />

  const onSubmit = form.handleSubmit((values) =>
    login.mutate(values, { onSuccess: () => navigate(next, { replace: true }) }),
  )

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Đơn Hàng Mini</h1>
          <p className="mt-1 text-sm text-muted-foreground">Đăng nhập để quản lý đơn hàng</p>
        </div>
        <Card>
          <CardContent className="p-5">
            <form onSubmit={onSubmit} className="grid gap-4" noValidate>
              <Field label="Tên đăng nhập" htmlFor="username" error={form.formState.errors.username?.message}>
                <Input id="username" autoComplete="username" autoCapitalize="none" {...form.register('username')} />
              </Field>
              <Field label="Mật khẩu" htmlFor="password" error={form.formState.errors.password?.message}>
                <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
              </Field>
              {login.isError && (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                  {errorMessage(login.error)}
                </p>
              )}
              <Button type="submit" size="lg" loading={login.isPending}>
                Đăng nhập
              </Button>
            </form>
          </CardContent>
        </Card>
        {hints?.demo_login && (
          <p className="mt-4 rounded-lg bg-amber-100 px-3 py-2 text-center text-sm text-amber-900">
            Chế độ demo: đăng nhập bằng <b>demo</b> / <b>demo</b>
          </p>
        )}
      </div>
    </div>
  )
}
