import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Serverless function trên Vercel cho mọi đường dẫn /api/*. Giao diện là file tĩnh do Vercel phục vụ.
 * Lỗi cấu hình (thiếu biến môi trường) được trả về dạng JSON để hiện ngay trên màn hình đăng nhập,
 * thay vì function bị sập với lỗi 500 khó hiểu.
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void

const ready: Promise<Handler> = import('./app')
  .then(({ createApp }) => createApp({ serveStatic: false }).app as unknown as Handler)
  .catch((err: Error) => {
    console.error(`[config] ${err.message}`)
    return (_req, res) => {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: `Cấu hình server trên Vercel chưa đúng: ${err.message}` }))
    }
  })

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  ;(await ready)(req, res)
}
