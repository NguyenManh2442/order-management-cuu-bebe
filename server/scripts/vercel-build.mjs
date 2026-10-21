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
