/** Chuẩn hóa số điện thoại VN về dạng 0xxxxxxxxx để so khớp khách hàng. */
export function normalizePhone(input: string | number): string {
  let s = String(input).replace(/[\s.\-()]/g, '')
  if (s.startsWith('+84')) s = '0' + s.slice(3)
  else if (s.startsWith('84') && s.length === 11) s = '0' + s.slice(2)
  // Google Sheets hay tự đổi "0912..." thành số 912..., mất số 0 đầu.
  else if (/^[1-9]\d{8}$/.test(s)) s = '0' + s
  return s
}

export function isValidPhone(input: string): boolean {
  return /^0\d{9,10}$/.test(normalizePhone(input))
}

/** Thêm https:// nếu người dùng dán link không có scheme. */
export function normalizeUrl(input: string): string {
  const s = input.trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

export function isValidUrl(input: string): boolean {
  if (!input.trim()) return true
  try {
    const u = new URL(normalizeUrl(input))
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.')
  } catch {
    return false
  }
}

export function normalizeSize(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toUpperCase()
}
