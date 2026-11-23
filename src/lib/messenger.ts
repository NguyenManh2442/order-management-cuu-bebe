import { amountDue } from '@shared/stats'
import type { OrderView } from '@shared/types'
import { formatVND } from './utils'

/** Đường dẫn Facebook không phải trang cá nhân (không mở khung chat được). */
const NOT_PROFILE = new Set(['groups', 'pages', 'share', 'watch', 'events', 'marketplace', 'story.php', 'permalink.php', 'photo.php', 'reel', 'stories', 'hashtag'])

/**
 * Link mở khung chat Messenger với khách, từ link Facebook đã lưu:
 * facebook.com/ten.khach → m.me/ten.khach, profile.php?id=123 → m.me/123.
 * null = không suy ra được (link nhóm, link chia sẻ…) — khi đó mở thẳng link Facebook.
 */
export function messengerUrl(facebookUrl: string): string | null {
  const raw = facebookUrl.trim()
  if (!raw) return null
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  const full = u.hostname.toLowerCase()
  // Bỏ tiền tố bản di động / web của Facebook, nhưng m.me là tên miền riêng của Messenger.
  const host = full === 'm.me' ? full : full.replace(/^(www|m|mbasic|web|business)\./, '')
  const parts = u.pathname.split('/').filter(Boolean)
  if (host === 'm.me') return parts[0] ? `https://m.me/${parts[0]}` : null
  if (host === 'messenger.com') return parts[0] === 't' && parts[1] ? `https://m.me/${parts[1]}` : null
  if (host !== 'facebook.com' && host !== 'fb.com') return null
  if (parts[0] === 'profile.php') {
    const id = u.searchParams.get('id')
    return id && /^\d+$/.test(id) ? `https://m.me/${id}` : null
  }
  if (parts[0] === 'messages' && parts[1] === 't' && parts[2]) return `https://m.me/${parts[2]}`
  if (parts.length === 1 && !NOT_PROFILE.has(parts[0].toLowerCase())) return `https://m.me/${parts[0]}`
  return null
}

/** Kèm sẵn nội dung: Messenger điền vào ô chat nếu hỗ trợ (chắc chắn với Fanpage), không thì bỏ qua. */
export const withText = (url: string, text: string) => `${url}?text=${encodeURIComponent(text)}`

export type Pronoun = 'chị' | 'anh' | 'bạn'
export const PRONOUNS: Pronoun[] = ['chị', 'anh', 'bạn']

export interface MessageContext {
  order: Pick<OrderView, 'order_code' | 'total_amount' | 'paid_amount' | 'ghn_order_code' | 'items'>
  pronoun: Pronoun
  /** Link tra cứu đơn cho khách ('' nếu mẫu không cần). */
  link: string
}

export interface MessageTemplate {
  id: string
  label: string
  /** Mẫu có link tra cứu: tạo link trước khi điền. */
  needsLink?: boolean
  build: (c: MessageContext) => string
}

/**
 * Xưng hô: khách là chị / anh thì shop xưng "em", khách là bạn thì xưng "mình".
 * Không kèm tên khách (tên lưu trong app thường là tên đầy đủ / tên Facebook, gọi lên dễ sai).
 */
function words({ pronoun }: MessageContext) {
  return { you: pronoun, self: pronoun === 'bạn' ? 'mình' : 'em', call: pronoun }
}

function itemsText(order: MessageContext['order']): string {
  return order.items.map((i) => `${i.product_name} size ${i.size} x${i.quantity}`).join(', ')
}

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    id: 'confirm',
    label: 'Đã lên đơn',
    build: (c) => {
      const w = words(c)
      return `Dạ hàng có rồi ạ, ${w.self} lên đơn cho ${w.call} rồi nhé. ${cap(w.self)} cảm ơn ${w.you} ạ!`
    },
  },
  {
    id: 'tracking',
    label: 'Gửi link theo dõi',
    needsLink: true,
    build: (c) => {
      const w = words(c)
      return `Dạ hàng có rồi ạ, ${w.self} lên đơn cho ${w.call} rồi nhé. ${cap(w.self)} gửi link theo dõi đơn hàng ạ: ${c.link}`
    },
  },
  {
    id: 'shipped',
    label: 'Đã gửi hàng',
    needsLink: true,
    build: (c) => {
      const w = words(c)
      const code = c.order.ghn_order_code ? ` (mã vận đơn GHN ${c.order.ghn_order_code})` : ''
      const due = amountDue(c.order)
      const pay = due ? ` ${cap(w.you)} chuẩn bị giúp ${w.self} ${formatVND(due)} khi nhận hàng nha.` : ''
      return `Dạ đơn ${c.order.order_code} của ${w.call} đã gửi đi rồi ạ${code}. Shipper gọi thì ${w.you} nghe máy giúp ${w.self} nhé.${pay}\nTheo dõi đơn: ${c.link}`
    },
  },
  {
    id: 'payment',
    label: 'Nhắc chuyển khoản',
    build: (c) => {
      const w = words(c)
      const due = amountDue(c.order)
      return `Dạ ${w.call} ơi, đơn ${c.order.order_code} (${itemsText(c.order)}) tổng ${formatVND(c.order.total_amount)}${
        c.order.paid_amount ? `, còn ${formatVND(due)}` : ''
      }. ${cap(w.you)} chuyển khoản giúp ${w.self} để ${w.self} gửi hàng nha ạ.`
    },
  },
  {
    id: 'thanks',
    label: 'Cảm ơn',
    build: (c) => {
      const w = words(c)
      return `Dạ ${w.self} cảm ơn ${w.call} đã ủng hộ shop ạ! ${cap(w.you)} nhận hàng mặc thấy thế nào thì góp ý cho ${w.self} với nha 🥰`
    },
  },
]

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
