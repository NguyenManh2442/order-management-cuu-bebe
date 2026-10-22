import { Copy, ExternalLink, Link2, MessageSquareText, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { OrderView } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { errorMessage } from '@/lib/api'
import { usePublicLink } from '@/lib/queries'

export const publicOrderUrl = (token: string) => `${window.location.origin}/t/${token}`

/** true = đã chép được. Safari chặn chép nếu không ngay sau thao tác bấm (ví dụ sau khi chờ tạo link). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Trình duyệt cũ / trang không phải HTTPS: chép bằng ô ẩn.
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    el.remove()
    return ok
  }
}

/** Link để khách tự xem trạng thái đơn — không cần đăng nhập, chỉ ai có link mới xem được. */
export function PublicLinkCard({ order }: { order: OrderView }) {
  const link = usePublicLink()
  const [confirmRegen, setConfirmRegen] = useState(false)
  const url = order.public_token ? publicOrderUrl(order.public_token) : ''

  const copy = async (text: string, what: string) => {
    if (await copyText(text)) toast.success(`Đã sao chép ${what}`)
    else toast.error(`Trình duyệt không cho tự sao chép — bấm "Sao chép link" hoặc chép tay link bên dưới.`)
  }

  const message = (u: string) =>
    `Chào ${order.customer.name}, shop gửi bạn link theo dõi đơn ${order.order_code} (trạng thái, số tiền, mã vận đơn): ${u}`

  const create = (regenerate: boolean) =>
    link.mutate(
      { orderId: order.id, regenerate },
      {
        onSuccess: async ({ token }) => {
          setConfirmRegen(false)
          // Chép sau khi chờ server có thể bị trình duyệt chặn; khi đó link vẫn hiện để bấm "Sao chép link".
          if (await copyText(publicOrderUrl(token))) toast.success(`Đã tạo và sao chép ${regenerate ? 'link mới' : 'link'}`)
          else toast.success(`Đã tạo ${regenerate ? 'link mới' : 'link'} — bấm "Sao chép link" để chép`)
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="size-4" /> Link tra cứu cho khách
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!url ? (
          <>
            <p className="text-sm text-muted-foreground">
              Gửi khách link để tự xem trạng thái đơn, số tiền còn phải trả và mã vận đơn — không cần hỏi shop.
            </p>
            <Button variant="outline" loading={link.isPending} onClick={() => create(false)}>
              <Link2 /> Tạo & sao chép link
            </Button>
          </>
        ) : (
          <>
            <div className="truncate rounded-lg border bg-muted/50 px-3 py-2 font-mono text-xs" title={url}>
              {url}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => copy(url, 'link')}>
                <Copy /> Sao chép link
              </Button>
              <Button variant="outline" onClick={() => copy(message(url), 'tin nhắn kèm link')}>
                <MessageSquareText /> Kèm lời nhắn
              </Button>
              <Button asChild variant="ghost" size="sm">
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> Xem như khách
                </a>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRegen(true)}>
                <RefreshCw /> Đổi link
              </Button>
            </div>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmRegen}
        onOpenChange={setConfirmRegen}
        title="Đổi link tra cứu?"
        description="Link cũ sẽ không mở được nữa (dùng khi lỡ gửi nhầm người). Nhớ gửi link mới cho khách."
        confirmLabel="Đổi link"
        loading={link.isPending}
        onConfirm={() => create(true)}
      />
    </Card>
  )
}
