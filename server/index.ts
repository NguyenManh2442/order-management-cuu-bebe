import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import { config } from './config'
import { AppError } from './errors'
import { GhnRuntime } from './ghn/settings'
import { Mutex } from './mutex'
import { createDemoSnapshot } from './repo/demo-data'
import { MemoryStore } from './repo/memory'
import { SheetsStore, createSheetsClient } from './repo/sheets'
import type { DataStore } from './repo/types'
import { createApiRouter } from './routes'
import { OrderService } from './service'

const store: DataStore =
  config.dataSource === 'sheets'
    ? new SheetsStore(createSheetsClient(config.sheets), config.sheets.spreadsheetId, config.sheets.cacheMs)
    : new MemoryStore(createDemoSnapshot(config.sizes))
const writeLock = new Mutex()
const service = new OrderService(store, config.sizes, undefined, writeLock)
let ghn: GhnRuntime
try {
  ghn = new GhnRuntime({
    store,
    lock: writeLock,
    file: config.ghn.settingsFile,
    fromEnv: config.ghn.fromEnv,
    demoFallback: config.ghn.demoFallback,
  })
} catch (err) {
  console.error(`[config] ${(err as Error).message}`)
  process.exit(1)
}
ghn.checkOnStartup()

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'same-origin')
  next()
})

// Log gọn: chỉ method, path (không query), mã trả về, thời gian. Không log body vì chứa SĐT/địa chỉ.
app.use('/api', (req, res, next) => {
  const start = Date.now()
  res.on('finish', () => console.log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - start}ms`))
  next()
})

app.use('/api', express.json({ limit: '100kb' }))
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
app.use('/api', createApiRouter(service, ghn))
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Không tìm thấy API' })
})

const distDir = resolve('dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }))
  app.get('/{*splat}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(resolve(distDir, 'index.html'))
  })
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  if ((err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Dữ liệu gửi lên không hợp lệ' })
    return
  }
  console.error('[server] Lỗi không mong muốn:', (err as Error)?.message)
  res.status(500).json({ error: 'Lỗi máy chủ, vui lòng thử lại.' })
})

app.listen(config.port, () => {
  console.log(`API chạy tại http://localhost:${config.port} — nguồn dữ liệu: ${config.dataSource}`)
  if (config.demoLogin) console.log('Chế độ DEMO: đăng nhập bằng demo / demo. Dữ liệu chỉ nằm trong bộ nhớ.')
  const g = ghn.settings
  console.log(
    g
      ? `Giao Hàng Nhanh: ${g.env}, shop ${g.shop_id} (cấu hình từ ${ghn.source === 'file' ? config.ghn.settingsFile : '.env'})` +
          (g.webhook_secret ? ', webhook bật' : ', webhook tắt')
      : ghn.client
        ? 'Giao Hàng Nhanh: GIẢ LẬP (chưa thiết lập, không gọi GHN thật)'
        : 'Giao Hàng Nhanh: chưa thiết lập (vào "Thiết lập GHN" trong app)',
  )
})
