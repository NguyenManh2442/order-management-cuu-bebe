import { MessageCircle, Phone } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Link gọi điện nhanh. Đặt relative z-10 để bấm được khi nằm trong card có link phủ. */
export function PhoneLink({ phone, className }: { phone: string; className?: string }) {
  if (!phone) return null
  return (
    <a
      href={`tel:${phone}`}
      onClick={(e) => e.stopPropagation()}
      className={cn('relative z-10 inline-flex items-center gap-1 font-medium text-blue-700 hover:underline', className)}
    >
      <Phone className="size-3.5" />
      {phone}
    </a>
  )
}

export function FacebookLink({ url, label = 'Facebook', className }: { url: string; label?: string; className?: string }) {
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn('relative z-10 inline-flex items-center gap-1 text-blue-700 hover:underline', className)}
    >
      <MessageCircle className="size-3.5" />
      {label}
    </a>
  )
}
