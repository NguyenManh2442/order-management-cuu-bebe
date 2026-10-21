import { existsSync } from 'node:fs'
import { DEFAULT_SIZES } from '../shared/constants'
import { GHN_REQUIRED_NOTES, type GhnRequiredNote } from '../shared/ghn'
import type { GhnSettings } from './ghn/settings'
import { normalizeSize } from '../shared/phone'

if (existsSync('.env')) process.loadEnvFile('.env')

/** Cấu hình sai: ném lỗi để nơi khởi động quyết định (máy chủ thường thì thoát, Vercel thì trả lỗi rõ ràng). */
export class ConfigError extends Error {}

function fail(message: string): never {
  throw new ConfigError(message)
}

const env = process.env
const isProduction = env.NODE_ENV === 'production'
const dataSource = (env.DATA_SOURCE ?? 'demo').trim()
if (dataSource !== 'demo' && dataSource !== 'sheets') fail('DATA_SOURCE phải là "demo" hoặc "sheets"')
if (dataSource === 'demo' && isProduction && env.ALLOW_DEMO_IN_PRODUCTION !== 'true') {
  fail('Đang chạy production với DATA_SOURCE=demo. Đặt DATA_SOURCE=sheets (hoặc ALLOW_DEMO_IN_PRODUCTION=true nếu chỉ để thử).')
}

/** APP_USERS="an:scrypt$...,binh:scrypt$..." */
function parseUsers(raw: string | undefined): Map<string, string> {
  const users = new Map<string, string>()
  for (const entry of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = entry.indexOf(':')
    if (idx <= 0) fail(`APP_USERS sai định dạng ở "${entry.slice(0, 20)}..." (cần tên:mã-băm)`)
    users.set(entry.slice(0, idx).trim(), entry.slice(idx + 1).trim())
  }
  return users
}

const users = parseUsers(env.APP_USERS)
/** Chế độ demo không cấu hình tài khoản → cho đăng nhập demo/demo để thử nhanh. */
const demoLogin = dataSource === 'demo' && users.size === 0

let sessionSecret = env.SESSION_SECRET ?? ''
if (sessionSecret.length < 32) {
  if (dataSource === 'sheets' || isProduction) fail('SESSION_SECRET phải dài ít nhất 32 ký tự')
  sessionSecret = 'demo-only-secret-do-not-use-in-production-0123456789'
}
if (dataSource === 'sheets' && users.size === 0) fail('Chưa cấu hình APP_USERS (xem README → Tài khoản đăng nhập)')

const sizes = (env.SIZES ?? DEFAULT_SIZES.join(','))
  .split(',')
  .map(normalizeSize)
  .filter(Boolean)

/**
 * Cấu hình GHN từ .env (dùng khi chưa lưu cấu hình trên màn "Thiết lập GHN").
 * null = .env không khai báo GHN_TOKEN.
 */
function parseGhnEnv(): GhnSettings | null {
  const token = env.GHN_TOKEN?.trim() ?? ''
  if (!token) return null
  const shopId = env.GHN_SHOP_ID?.trim() ?? ''
  if (!/^\d+$/.test(shopId)) fail('GHN_SHOP_ID phải là số (mã cửa hàng, xem màn "Thiết lập GHN" hoặc trang GHN → Quản lý cửa hàng)')
  const ghnEnv = (env.GHN_ENV ?? 'staging').trim()
  if (ghnEnv !== 'staging' && ghnEnv !== 'production') fail('GHN_ENV phải là "staging" hoặc "production"')

  const dims = (env.GHN_DEFAULT_DIMENSIONS ?? '25x20x5').split(/[x×*,]/i).map((n) => Number(n.trim()))
  if (dims.length !== 3 || dims.some((n) => !Number.isInteger(n) || n < 1 || n > 200)) {
    fail('GHN_DEFAULT_DIMENSIONS phải dạng DàixRộngxCao (cm), ví dụ 25x20x5')
  }
  const requiredNote = (env.GHN_REQUIRED_NOTE ?? 'CHOXEMHANGKHONGTHU').trim()
  if (!(GHN_REQUIRED_NOTES as readonly string[]).includes(requiredNote)) {
    fail(`GHN_REQUIRED_NOTE phải là một trong: ${GHN_REQUIRED_NOTES.join(', ')}`)
  }
  const itemWeight = Number(env.GHN_DEFAULT_ITEM_WEIGHT ?? 300)
  if (!Number.isInteger(itemWeight) || itemWeight < 1) fail('GHN_DEFAULT_ITEM_WEIGHT phải là số gram > 0')
  const webhookSecret = env.GHN_WEBHOOK_SECRET?.trim() ?? ''
  if (webhookSecret && webhookSecret.length < 16) fail('GHN_WEBHOOK_SECRET phải dài ít nhất 16 ký tự')

  // Địa chỉ lấy hàng (hệ mới 2 cấp), khai báo bằng tên. Bỏ trống = dùng địa chỉ shop khai báo trên GHN.
  const street = env.GHN_FROM_ADDRESS?.trim() ?? ''
  const ward = env.GHN_FROM_WARD?.trim() ?? ''
  const province = env.GHN_FROM_PROVINCE?.trim() ?? ''
  if ((street || ward || province) && !(street && ward && province)) {
    fail('Địa chỉ lấy hàng cần đủ GHN_FROM_ADDRESS, GHN_FROM_WARD, GHN_FROM_PROVINCE (tên theo danh mục mới của GHN)')
  }

  return {
    env: ghnEnv,
    token,
    shop_id: shopId,
    webhook_secret: webhookSecret,
    sender: street
      ? {
          name: env.GHN_FROM_NAME?.trim() ?? '',
          phone: env.GHN_FROM_PHONE?.trim() ?? '',
          street,
          province_id: 0,
          province_name: province,
          ward_id: 0,
          ward_name: ward,
        }
      : null,
    defaults: {
      item_weight: itemWeight,
      length: dims[0],
      width: dims[1],
      height: dims[2],
      required_note: requiredNote as GhnRequiredNote,
      payment_type: env.GHN_PAYMENT_TYPE === '1' ? 1 : 2,
    },
  }
}

export const config = {
  port: Number(env.PORT ?? 8787),
  isProduction,
  dataSource: dataSource as 'demo' | 'sheets',
  sizes: sizes.length ? sizes : DEFAULT_SIZES,
  users,
  demoLogin,
  sessionSecret,
  sessionDays: Number(env.SESSION_DAYS ?? 30),
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction,
  sheets: {
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID ?? '',
    keyFile: env.GOOGLE_APPLICATION_CREDENTIALS,
    clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    cacheMs: Number(env.SHEETS_CACHE_MS ?? 15000),
  },
  ghn: {
    fromEnv: parseGhnEnv(),
    /** Cấu hình lưu từ màn "Thiết lập GHN" (chứa token — đặt ngoài thư mục public, không commit). */
    settingsFile: env.GHN_SETTINGS_FILE?.trim() || './secrets/ghn-settings.json',
    /** Chưa thiết lập GHN mà đang chạy demo thì dùng GHN giả lập. */
    demoFallback: dataSource === 'demo',
    /** Vercel: ổ đĩa của serverless function không lưu lâu dài → màn thiết lập chỉ xem, cấu hình bằng biến môi trường. */
    readOnlyReason: env.VERCEL
      ? 'Đang chạy trên Vercel: không lưu được thiết lập trên server. Khai báo GHN_TOKEN, GHN_SHOP_ID, GHN_ENV… trong Vercel → Settings → Environment Variables rồi Redeploy.'
      : '',
  },
}

if (config.dataSource === 'sheets' && !config.sheets.spreadsheetId) fail('Chưa cấu hình GOOGLE_SHEETS_SPREADSHEET_ID')
