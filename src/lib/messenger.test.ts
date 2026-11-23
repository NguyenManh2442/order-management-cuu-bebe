import { describe, expect, it } from 'vitest'
import { MESSAGE_TEMPLATES, messengerUrl, withText, type MessageContext } from './messenger'

describe('messengerUrl', () => {
  it('đổi link trang cá nhân sang link mở khung chat', () => {
    expect(messengerUrl('https://www.facebook.com/lan.nguyen.123')).toBe('https://m.me/lan.nguyen.123')
    expect(messengerUrl('facebook.com/lan.nguyen.123?mibextid=abc')).toBe('https://m.me/lan.nguyen.123')
    expect(messengerUrl('https://m.facebook.com/profile.php?id=100012345678')).toBe('https://m.me/100012345678')
    expect(messengerUrl('https://web.facebook.com/messages/t/100012345678')).toBe('https://m.me/100012345678')
    expect(messengerUrl('https://m.me/lan.nguyen.123')).toBe('https://m.me/lan.nguyen.123')
    expect(messengerUrl('https://www.messenger.com/t/lan.nguyen.123')).toBe('https://m.me/lan.nguyen.123')
  })

  it('link nhóm, link chia sẻ, link lạ: không đoán bừa', () => {
    expect(messengerUrl('https://www.facebook.com/groups/12345')).toBeNull()
    expect(messengerUrl('https://www.facebook.com/share/1AbCdEf/')).toBeNull()
    expect(messengerUrl('https://www.facebook.com/profile.php')).toBeNull()
    expect(messengerUrl('https://zalo.me/0912345678')).toBeNull()
    expect(messengerUrl('')).toBeNull()
  })

  it('kèm nội dung đã mã hóa', () => {
    expect(withText('https://m.me/a', 'Dạ chị Lan & em')).toBe('https://m.me/a?text=D%E1%BA%A1%20ch%E1%BB%8B%20Lan%20%26%20em')
  })
})

describe('mẫu tin nhắn', () => {
  const ctx = (over: Partial<MessageContext['order']> = {}, pronoun: MessageContext['pronoun'] = 'chị'): MessageContext => ({
    pronoun,
    link: 'https://shop.vn/t/abc',
    order: {
      order_code: 'DH261123-001',
      total_amount: 700000,
      paid_amount: 0,
      ghn_order_code: '',
      items: [{ product_name: 'Váy nhung', size: 'M', quantity: 2 }] as MessageContext['order']['items'],
      ...over,
    },
  })
  const build = (id: string, c: MessageContext) => MESSAGE_TEMPLATES.find((t) => t.id === id)!.build(c)

  it('không gọi tên khách, xưng em; khách là bạn thì xưng mình', () => {
    expect(build('confirm', ctx())).toBe('Dạ hàng có rồi ạ, em lên đơn cho chị rồi nhé. Em cảm ơn chị ạ!')
    expect(build('confirm', ctx({}, 'bạn'))).toContain('mình lên đơn cho bạn rồi')
  })

  it('nhắc chuyển khoản ghi số còn lại khi đã cọc', () => {
    expect(build('payment', ctx({ paid_amount: 200000 }))).toContain('tổng 700.000 ₫, còn 500.000 ₫')
  })

  it('mẫu gửi link / đã gửi hàng kèm link và mã vận đơn', () => {
    expect(build('tracking', ctx())).toBe('Dạ hàng có rồi ạ, em lên đơn cho chị rồi nhé. Em gửi link theo dõi đơn hàng ạ: https://shop.vn/t/abc')
    const shipped = build('shipped', ctx({ ghn_order_code: 'GHN123' }))
    expect(shipped).toContain('mã vận đơn GHN GHN123')
    expect(shipped).toContain('chuẩn bị giúp em 700.000')
    expect(shipped).toContain('Theo dõi đơn: https://shop.vn/t/abc')
    expect(MESSAGE_TEMPLATES.filter((t) => t.needsLink).map((t) => t.id)).toEqual(['tracking', 'shipped'])
  })
})
