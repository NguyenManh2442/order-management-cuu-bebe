import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { Copy, ExternalLink, LoaderCircle, MessageCircle, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { OrderView } from '@shared/types'
import { copyText, publicOrderUrl } from '@/components/public-link'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'
import { MESSAGE_TEMPLATES, PRONOUNS, messengerUrl, withText, type Pronoun } from '@/lib/messenger'
import { usePublicLink } from '@/lib/queries'
import { cn } from '@/lib/utils'

/**
 * Nhắn tin cho khách theo mẫu có sẵn: điền tên, mã đơn, tiền, link theo dõi; sửa được trước khi gửi.
 * Messenger không cho web tự gửi / tự điền tin nhắn cá nhân, nên app sao chép tin rồi mở khung chat để dán.
 */
export function MessageCustomerButton({ order, className }: { order: OrderView; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="lg" variant="outline" className={className} onClick={() => setOpen(true)}>
        <MessageCircle /> Nhắn tin
      </Button>
      {open && <MessageDialog order={order} onClose={() => setOpen(false)} />}
    </>
  )
}

function MessageDialog({ order, onClose }: { order: OrderView; onClose: () => void }) {
  const [pronoun, setPronoun] = useState<Pronoun>('chị')
  const [templateId, setTemplateId] = useState(MESSAGE_TEMPLATES[0].id)
  const [text, setText] = useState('')
  const [token, setToken] = useState(order.public_token)
  const link = usePublicLink()
  const template = MESSAGE_TEMPLATES.find((t) => t.id === templateId) ?? MESSAGE_TEMPLATES[0]
  const chatUrl = useMemo(() => messengerUrl(order.customer.facebook_url), [order.customer.facebook_url])
  const waitingLink = template.needsLink && !token

  // Mẫu có link theo dõi mà đơn chưa có link: tạo trước (không đổi link cũ nếu đã có).
  const createLink = link.mutate
  useEffect(() => {
    if (!template.needsLink || token) return
    createLink(
      { orderId: order.id, regenerate: false },
      { onSuccess: (r) => setToken(r.token), onError: (err) => toast.error(errorMessage(err)) },
    )
  }, [template.needsLink, token, order.id, createLink])

  // Đổi mẫu / xưng hô thì điền lại nội dung (mất phần đã sửa tay — đúng ý khi chọn mẫu khác).
  // Theo dõi updated_at thay vì cả object: dữ liệu tải lại (ví dụ sau khi tạo link) không xóa phần đang sửa.
  const orderRef = useRef(order)
  orderRef.current = order
  useEffect(() => {
    if (waitingLink) return
    setText(template.build({ order: orderRef.current, pronoun, link: token ? publicOrderUrl(token) : '' }))
  }, [template, pronoun, token, order.updated_at, waitingLink])

  const copy = () =>
    copyText(text).then((ok) =>
      ok ? toast.success('Đã sao chép tin nhắn') : toast.error('Trình duyệt chặn sao chép — chọn đoạn chữ rồi sao chép tay'),
    )

  const openChat = () => {
    // Chép TRƯỚC khi mở tab: tab mới lấy mất focus thì trình duyệt chặn ghi clipboard.
    // Cả hai đều chạy ngay trong lúc bấm (không chờ) để không bị chặn sao chép / cửa sổ mới.
    const copied = copyText(text)
    window.open(chatUrl ? withText(chatUrl, text) : order.customer.facebook_url, '_blank', 'noopener,noreferrer')
    void copied.then((ok) =>
      ok ? toast.success('Đã sao chép — dán (giữ ô chat → Dán) rồi gửi') : toast.error('Không sao chép được, hãy sao chép tay đoạn tin nhắn'),
    )
  }

  const chip = (active: boolean) =>
    cn(
      'h-9 rounded-full border px-3 text-sm whitespace-nowrap transition-colors',
      active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
    )

  return (
    <AlertDialog.Root open onOpenChange={(o) => !o && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content
          className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-h-[calc(100dvh-1.5rem)] max-w-lg flex-col overflow-y-auto rounded-2xl bg-card p-5 shadow-xl sm:inset-x-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2"
          onEscapeKeyDown={onClose}
        >
          <AlertDialog.Title className="text-lg font-semibold">Nhắn tin cho {order.customer.name}</AlertDialog.Title>
          <AlertDialog.Description className="mt-1 text-sm text-muted-foreground">
            Chọn mẫu, sửa nếu cần, rồi sao chép và dán vào khung chat.
          </AlertDialog.Description>

          <div className="mt-4 grid gap-3">
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Xưng hô">
              <span className="text-sm text-muted-foreground">Gọi khách là</span>
              {PRONOUNS.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={pronoun === p} className={chip(pronoun === p)} onClick={() => setPronoun(p)}>
                  {p}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Mẫu tin nhắn">
              {MESSAGE_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={templateId === t.id}
                  className={chip(templateId === t.id)}
                  onClick={() => setTemplateId(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {waitingLink ? (
              <div className="flex min-h-36 items-center justify-center gap-2 rounded-lg border text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" /> Đang tạo link theo dõi…
              </div>
            ) : (
              <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="Nội dung tin nhắn" />
            )}
            {!order.customer.facebook_url && (
              <p className="text-xs text-muted-foreground">Khách chưa có link Facebook — sao chép để gửi qua Zalo / SMS.</p>
            )}
            {order.customer.facebook_url && !chatUrl && (
              <p className="text-xs text-muted-foreground">Link Facebook của khách không mở thẳng khung chat được — app sẽ mở trang Facebook đó.</p>
            )}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost" size="lg" className="sm:h-10 sm:text-sm">
                Đóng
              </Button>
            </AlertDialog.Cancel>
            <Button variant="outline" size="lg" className="sm:h-10 sm:text-sm" disabled={waitingLink || !text.trim()} onClick={copy}>
              <Copy /> Sao chép
            </Button>
            {order.customer.facebook_url && (
              <Button size="lg" className="sm:h-10 sm:text-sm" disabled={waitingLink || !text.trim()} onClick={openChat}>
                {chatUrl ? <Send /> : <ExternalLink />} Sao chép & mở {chatUrl ? 'Messenger' : 'Facebook'}
              </Button>
            )}
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
