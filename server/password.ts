import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT = { N: 16384, r: 8, p: 1 }

/** Định dạng: scrypt$<salt base64url>$<hash base64url> */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32, SCRYPT)
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, SCRYPT)
  return timingSafeEqual(actual, expected)
}

/** Băm giả để thời gian phản hồi giống nhau dù tên đăng nhập không tồn tại. */
export function burnPasswordTime(password: string) {
  scryptSync(password, 'dummy-salt', 32, SCRYPT)
}
