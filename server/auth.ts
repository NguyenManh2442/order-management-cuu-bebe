import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { config } from './config'
import { burnPasswordTime, verifyPassword } from './password'

const COOKIE = 'sid'
export function checkCredentials(username: string, password: string): boolean {
  if (config.demoLogin) return username === 'demo' && password === 'demo'
  const stored = config.users.get(username)
  if (!stored) {
    burnPasswordTime(password)
    return false
  }
  return verifyPassword(password, stored)
}

function sign(payload: string): string {
  return createHmac('sha256', config.sessionSecret).update(payload).digest('base64url')
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
}

export function setSession(res: Response, username: string) {
  const maxAge = config.sessionDays * 86400
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + maxAge * 1000 })).toString('base64url')
  const attrs = [`${COOKIE}=${payload}.${sign(payload)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`]
  if (config.cookieSecure) attrs.push('Secure')
  res.setHeader('Set-Cookie', attrs.join('; '))
}

export function clearSession(res: Response) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`)
}

export function getSessionUser(req: Request): string | null {
  const raw = readCookie(req, COOKIE)
  if (!raw) return null
  const [payload, sig] = raw.split('.')
  if (!payload || !sig) return null
  const expected = Buffer.from(sign(payload))
  const actual = Buffer.from(sig)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { u: string; exp: number }
    if (Date.now() > exp) return null
    // Tài khoản đã bị gỡ khỏi APP_USERS thì phiên cũ hết hiệu lực.
    if (!config.demoLogin && !config.users.has(u)) return null
    return u
  } catch {
    return null
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getSessionUser(req)
  if (!user) {
    res.status(401).json({ error: 'Phiên đăng nhập đã hết, vui lòng đăng nhập lại.' })
    return
  }
  // Chống CSRF: cookie SameSite=Strict + yêu cầu header tùy biến mà form HTML không gửi được.
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'fetch') {
    res.status(403).json({ error: 'Yêu cầu không hợp lệ' })
    return
  }
  res.locals.user = user
  next()
}

/** Giới hạn đăng nhập sai: tối đa 10 lần / 15 phút / IP. */
const attempts = new Map<string, { count: number; reset: number }>()
export function loginRateLimited(ip: string): boolean {
  const now = Date.now()
  const a = attempts.get(ip)
  if (!a || a.reset < now) {
    attempts.set(ip, { count: 1, reset: now + 15 * 60_000 })
    return false
  }
  a.count++
  return a.count > 10
}
export function resetLoginAttempts(ip: string) {
  attempts.delete(ip)
}
