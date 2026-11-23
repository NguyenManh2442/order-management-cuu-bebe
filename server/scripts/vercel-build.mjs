/**
 * Build cho Vercel theo Build Output API v3 (https://vercel.com/docs/build-output-api/v3):
 *   .vercel/output/static/          ← giao diện (vite build)
 *   .vercel/output/functions/api.func ← backend Express gói thành 1 file (mọi /api/*)
 *   .vercel/output/config.json      ← điều hướng: /api/* → function, còn lại → file tĩnh / index.html
 * Gói hết thư viện vào 1 file CommonJS để function không phụ thuộc node_modules hay cách Node xử lý ESM.
 */
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

const out = '.vercel/output'
const run = (cmd) => execSync(cmd, { stdio: 'inherit' })

rmSync(out, { recursive: true, force: true })

run('npx tsc -b')
run('npx vite build')
cpSync('dist', `${out}/static`, { recursive: true })

/**
 * Tự bổ sung sheet / cột mới vào Google Sheets mỗi lần deploy (thay cho chạy tay "npm run init-sheets"),
 * dùng env sẵn có trên Vercel. An toàn khi chạy lại: chỉ tạo sheet và thêm cột còn thiếu, không sửa/xóa dữ liệu.
 * Chỉ chạy trên máy build của Vercel và khi dùng Sheets; đặt SKIP_INIT_SHEETS=1 để tắt.
 * Lỗi (Google chậm, sai quyền…) không chặn deploy: app vẫn chạy với cột cũ, chỉ báo khi dùng tính năng cần cột mới.
 */
if (process.env.VERCEL && process.env.DATA_SOURCE?.trim() === 'sheets' && process.env.SKIP_INIT_SHEETS !== '1') {
  try {
    run('npx tsx server/scripts/init-sheets.ts')
  } catch {
    console.warn('⚠ Không cập nhật được cấu trúc Google Sheets — deploy vẫn tiếp tục. Xem lỗi ở trên.')
  }
} else {
  console.log('Bỏ qua init-sheets (không phải build trên Vercel với DATA_SOURCE=sheets, hoặc SKIP_INIT_SHEETS=1).')
}

const fn = `${out}/functions/api.func`
mkdirSync(fn, { recursive: true })
await build({
  entryPoints: ['server/vercel.ts'],
  outfile: `${fn}/index.cjs`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  // Vercel gọi module.exports là hàm (req, res).
  footer: { js: 'module.exports = module.exports.default;' },
  logLevel: 'warning',
})
writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.cjs',
      launcherType: 'Nodejs',
      // Express tự đọc body; không để Vercel đọc trước.
      shouldAddHelpers: false,
      // Gọi Google Sheets / GHN có lúc chậm.
      maxDuration: 30,
    },
    null,
    2,
  ),
)

writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '^/api(/.*)?$', dest: '/api' },
        { handle: 'filesystem' },
        // Đường dẫn của app (/orders/123…) → index.html để React Router xử lý.
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
)
console.log(`Vercel build xong → ${out}`)
