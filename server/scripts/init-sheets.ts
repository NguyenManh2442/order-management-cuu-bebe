/**
 * Tạo các sheet còn thiếu và dòng tiêu đề trong spreadsheet đã cấu hình.
 * An toàn khi chạy lại: không xóa/ghi đè dữ liệu, chỉ thêm sheet hoặc cột còn thiếu vào cuối.
 */
import { existsSync } from 'node:fs'
import { SHEET_DEFS, columnLetter, createSheetsClient } from '../repo/sheets'

if (existsSync('.env')) process.loadEnvFile('.env')
const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
if (!spreadsheetId) {
  console.error('Thiếu GOOGLE_SHEETS_SPREADSHEET_ID trong .env')
  process.exit(1)
}

const api = createSheetsClient({
  keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  privateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
})

const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'properties.title,sheets.properties.title' })
console.log(`Spreadsheet: ${meta.data.properties?.title}`)
const existing = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title))

const toCreate = Object.values(SHEET_DEFS).filter((d) => !existing.has(d.sheet))
if (toCreate.length) {
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: toCreate.map((d) => ({
        addSheet: { properties: { title: d.sheet, gridProperties: { frozenRowCount: 1 } } },
      })),
    },
  })
  console.log(`Đã tạo sheet: ${toCreate.map((d) => d.sheet).join(', ')}`)
}

for (const def of Object.values(SHEET_DEFS)) {
  const res = await api.spreadsheets.values.get({ spreadsheetId, range: `'${def.sheet}'!1:1` })
  const header = (res.data.values?.[0] ?? []).map((h) => String(h).trim())
  const missing = Object.keys(def.columns).filter((c) => !header.includes(c))
  if (!missing.length) {
    console.log(`✓ ${def.sheet}: đủ cột`)
    continue
  }
  const startCol = header.length + 1
  await api.spreadsheets.values.update({
    spreadsheetId,
    range: `'${def.sheet}'!${columnLetter(startCol)}1:${columnLetter(startCol + missing.length - 1)}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [missing] },
  })
  console.log(`+ ${def.sheet}: thêm cột ${missing.join(', ')}`)
}
console.log('Xong.')
