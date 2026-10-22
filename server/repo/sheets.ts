import { auth as googleAuth, sheets as googleSheets, type sheets_v4 } from '@googleapis/sheets'
import { COST_BASES, COST_CATEGORIES, GROUP_STATUSES, ORDER_STATUSES } from '../../shared/constants'
import { normalizePhone } from '../../shared/phone'
import { AppError } from '../errors'
import type { DataStore, RowOf, Snapshot, TableName } from './types'

type Kind = 'text' | 'int' | 'num' | 'phone' | 'orderStatus' | 'groupStatus' | 'costCategory' | 'costBasis'
interface TableDef {
  sheet: string
  columns: Record<string, Kind>
  /**
   * Cột thêm sau khi app đã chạy thật. Sheet chưa có cột này vẫn đọc được (giá trị mặc định),
   * để bản mới deploy trước khi chạy "npm run init-sheets" không làm sập app.
   */
  optional?: string[]
  /** Cả sheet là tùy chọn (thêm sau): chưa có thì coi như bảng rỗng, chỉ báo lỗi khi cần ghi. */
  optionalSheet?: boolean
}

/** Cấu trúc các sheet. Cột được nhận diện theo tên ở dòng tiêu đề, không theo vị trí. */
export const SHEET_DEFS: Record<TableName, TableDef> = {
  customers: {
    sheet: 'Customers',
    columns: {
      id: 'text', name: 'text', phone: 'phone', facebook_url: 'text', address: 'text', ghn_address: 'text',
      created_at: 'text', updated_at: 'text',
    },
  },
  groups: {
    sheet: 'OrderGroups',
    columns: {
      id: 'text', name: 'text', description: 'text', product_name: 'text', default_unit_price: 'int',
      status: 'groupStatus', created_at: 'text', updated_at: 'text',
    },
  },
  orders: {
    sheet: 'Orders',
    columns: {
      id: 'text', order_code: 'text', group_id: 'text', customer_id: 'text', items_summary: 'text', total_amount: 'int',
      status: 'orderStatus', note: 'text', ghn_order_code: 'text', ghn_client_code: 'text', ghn_status: 'text',
      ghn_status_at: 'text', ghn_fee: 'int', ghn_cod_amount: 'int', ghn_expected_delivery: 'text', ghn_to_address: 'text',
      ghn_draft: 'text', paid_amount: 'int', public_token: 'text',
      created_at: 'text', updated_at: 'text',
    },
    optional: ['paid_amount', 'public_token'],
  },
  costs: {
    sheet: 'GroupCosts',
    columns: {
      id: 'text', group_id: 'text', category: 'costCategory', name: 'text', quantity: 'num', unit: 'text',
      unit_price: 'int', basis: 'costBasis', note: 'text', created_at: 'text', updated_at: 'text',
    },
    optionalSheet: true,
  },
  items: {
    sheet: 'OrderItems',
    columns: {
      id: 'text', order_id: 'text', product_name: 'text', size: 'text', quantity: 'int', unit_price: 'int',
      line_total: 'int', created_at: 'text',
    },
  },
}

const TABLES = Object.keys(SHEET_DEFS) as TableName[]

function decode(kind: Kind, v: unknown): string | number {
  switch (kind) {
    case 'int': {
      if (typeof v === 'number') return Math.round(v)
      const n = Number(String(v ?? '').replace(/[^\d-]/g, ''))
      return Number.isFinite(n) ? n : 0
    }
    case 'num': {
      if (typeof v === 'number') return v
      const n = Number(String(v ?? '').trim().replace(',', '.'))
      return Number.isFinite(n) ? n : 0
    }
    case 'costCategory':
      return (COST_CATEGORIES as readonly unknown[]).includes(v) ? (v as string) : 'other'
    case 'costBasis':
      return (COST_BASES as readonly unknown[]).includes(v) ? (v as string) : 'fixed'
    case 'phone':
      return v == null || v === '' ? '' : normalizePhone(v as string)
    case 'orderStatus':
      return (ORDER_STATUSES as readonly unknown[]).includes(v) ? (v as string) : 'pending'
    case 'groupStatus':
      return (GROUP_STATUSES as readonly unknown[]).includes(v) ? (v as string) : 'open'
    default:
      return v == null ? '' : String(v)
  }
}

interface LoadedRow {
  /** Số dòng thực trên sheet (1-based) tại thời điểm đọc. */
  pos: number
  raw: unknown[]
  obj: Record<string, unknown>
}
interface LoadedTable {
  header: string[]
  rows: LoadedRow[]
  /** Sheet tùy chọn chưa được tạo trên spreadsheet. */
  missing?: boolean
}
type Loaded = Record<TableName, LoadedTable>

export function columnLetter(n: number): string {
  let s = ''
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

export function createSheetsClient(opts: { keyFile?: string; clientEmail?: string; privateKey?: string }) {
  const scopes = ['https://www.googleapis.com/auth/spreadsheets']
  const auth =
    opts.clientEmail && opts.privateKey
      ? new googleAuth.JWT({ email: opts.clientEmail, key: opts.privateKey, scopes })
      : new googleAuth.GoogleAuth({ keyFile: opts.keyFile, scopes })
  return googleSheets({ version: 'v4', auth })
}

function wrapGoogleError(err: unknown): never {
  if (err instanceof AppError) throw err
  const e = err as { code?: number; status?: number; message?: string }
  const code = e.code ?? e.status
  // Không log nội dung request (có thể chứa số điện thoại/địa chỉ), chỉ log mã lỗi.
  console.error(`[sheets] Google API lỗi ${code ?? ''}: ${e.message?.slice(0, 200)}`)
  if (code === 403) throw new AppError(503, 'Service account chưa được chia sẻ quyền chỉnh sửa spreadsheet.')
  if (code === 404) throw new AppError(503, 'Không tìm thấy spreadsheet. Kiểm tra GOOGLE_SHEETS_SPREADSHEET_ID.')
  if (code === 429) throw new AppError(503, 'Google Sheets đang giới hạn tốc độ, thử lại sau ít phút.')
  if (code === 400 && e.message?.includes('Unable to parse range'))
    throw new AppError(503, 'Spreadsheet thiếu sheet cần thiết. Chạy "npm run init-sheets" để tạo.')
  throw new AppError(503, 'Không kết nối được Google Sheets, vui lòng thử lại.')
}

export class SheetsStore implements DataStore {
  private cache: { at: number; data: Loaded } | null = null
  /** Vị trí dòng trong cache còn đúng không (sai sau khi xóa dòng). */
  private positionsValid = false
  private sheetIds: Map<string, number> | null = null
  /** Sheet tùy chọn đã biết là chưa có, và lần kiểm tra gần nhất — để không gọi lỗi liên tục. */
  private missingSheets = new Set<TableName>()
  private missingCheckedAt = 0

  constructor(
    private api: sheets_v4.Sheets,
    private spreadsheetId: string,
    private cacheMs: number,
  ) {}

  private async fetchRanges(tables: TableName[]): Promise<sheets_v4.Schema$ValueRange[]> {
    const res = await this.api.spreadsheets.values.batchGet({
      spreadsheetId: this.spreadsheetId,
      ranges: tables.map((t) => `'${SHEET_DEFS[t].sheet}'`),
      valueRenderOption: 'UNFORMATTED_VALUE',
      majorDimension: 'ROWS',
    })
    return res.data.valueRanges ?? []
  }

  private async load(): Promise<Loaded> {
    // Thử lại sheet tùy chọn đã thiếu sau mỗi phút (người dùng có thể vừa chạy init-sheets).
    if (this.missingSheets.size && Date.now() - this.missingCheckedAt > 60_000) this.missingSheets.clear()
    let requested = TABLES.filter((t) => !this.missingSheets.has(t))
    let valueRanges: sheets_v4.Schema$ValueRange[]
    try {
      try {
        valueRanges = await this.fetchRanges(requested)
      } catch (err) {
        // Một sheet trong batch không tồn tại thì cả batch lỗi. Nếu có sheet tùy chọn, bỏ chúng ra và đọc lại.
        const optional = requested.filter((t) => SHEET_DEFS[t].optionalSheet)
        if (!optional.length || !String((err as Error)?.message).includes('Unable to parse range')) throw err
        const withoutOptional = requested.filter((t) => !optional.includes(t))
        valueRanges = await this.fetchRanges(withoutOptional)
        // Đọc lại được → lỗi đúng là do sheet tùy chọn. Nếu thiếu cả sheet bắt buộc thì đã ném lỗi ở trên.
        optional.forEach((t) => this.missingSheets.add(t))
        this.missingCheckedAt = Date.now()
        requested = withoutOptional
      }
    } catch (err) {
      wrapGoogleError(err)
    }

    const data = {} as Loaded
    for (const table of TABLES) {
      if (!requested.includes(table)) data[table] = { header: Object.keys(SHEET_DEFS[table].columns), rows: [], missing: true }
    }
    requested.forEach((table, i) => {
      const def = SHEET_DEFS[table]
      const values = (valueRanges[i]?.values ?? []) as unknown[][]
      const header = (values[0] ?? []).map((h) => String(h ?? '').trim())
      if (def.optionalSheet && !header.some(Boolean)) {
        data[table] = { header: Object.keys(def.columns), rows: [], missing: true }
        return
      }
      const missing = Object.keys(def.columns).filter((c) => !header.includes(c) && !def.optional?.includes(c))
      if (missing.length) {
        throw new AppError(503, `Sheet "${def.sheet}" thiếu cột: ${missing.join(', ')}. Chạy "npm run init-sheets".`)
      }
      const idCol = header.indexOf('id')
      const rows: LoadedRow[] = []
      values.slice(1).forEach((raw, j) => {
        if (raw[idCol] == null || String(raw[idCol]).trim() === '') return
        const obj: Record<string, unknown> = {}
        for (const [col, kind] of Object.entries(def.columns)) obj[col] = decode(kind, raw[header.indexOf(col)])
        rows.push({ pos: j + 2, raw, obj })
      })
      data[table] = { header, rows }
    })
    return data
  }

  private async loadFresh(): Promise<Loaded> {
    const data = await this.load()
    this.cache = { at: Date.now(), data }
    this.positionsValid = true
    return data
  }

  async snapshot(fresh = false): Promise<Snapshot> {
    const data =
      !fresh && this.cache && Date.now() - this.cache.at < this.cacheMs ? this.cache.data : await this.loadFresh()
    const snap = {} as Record<TableName, unknown[]>
    for (const t of TABLES) snap[t] = data[t].rows.map((r) => ({ ...r.obj }))
    return snap as unknown as Snapshot
  }

  private markStale() {
    if (this.cache) this.cache.at = 0
  }

  private async positions(): Promise<Loaded> {
    return this.positionsValid && this.cache ? this.cache.data : this.loadFresh()
  }

  /** Như positions(), nhưng sheet tùy chọn chưa có thì kiểm tra lại ngay rồi mới báo lỗi. */
  private async writable(table: TableName): Promise<Loaded> {
    let loaded = await this.positions()
    if (loaded[table].missing) {
      this.missingSheets.clear()
      loaded = await this.loadFresh()
      if (loaded[table].missing) {
        throw new AppError(503, `Chưa có sheet "${SHEET_DEFS[table].sheet}" (hoặc sheet chưa có dòng tiêu đề). Chạy "npm run init-sheets" rồi thử lại.`)
      }
    }
    return loaded
  }

  /**
   * Cột tùy chọn chưa có trên sheet: chỉ cho ghi khi giá trị là mặc định (rỗng/0),
   * còn có dữ liệu thật thì báo lỗi thay vì âm thầm bỏ mất.
   */
  private assertColumns(table: TableName, header: string[], rows: object[]) {
    const def = SHEET_DEFS[table]
    for (const col of def.optional ?? []) {
      if (header.includes(col)) continue
      const hasValue = rows.some((r) => {
        const v = (r as Record<string, unknown>)[col]
        return v !== undefined && v !== null && v !== '' && v !== 0
      })
      if (hasValue) {
        throw new AppError(503, `Sheet "${def.sheet}" chưa có cột ${col}. Chạy "npm run init-sheets" rồi thử lại.`)
      }
    }
  }

  private toRow(header: string[], obj: Record<string, unknown>, base: unknown[] = []): unknown[] {
    // Giữ nguyên các cột người dùng tự thêm trên sheet.
    const row = header.map((_, i) => base[i] ?? '')
    header.forEach((col, i) => {
      if (col in obj) row[i] = obj[col] ?? ''
    })
    return row
  }

  async insert<T extends TableName>(table: T, rows: RowOf<T>[]): Promise<void> {
    if (!rows.length) return
    const { header } = (await this.writable(table))[table]
    this.assertColumns(table, header, rows)
    try {
      await this.api.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `'${SHEET_DEFS[table].sheet}'!A1`,
        // RAW: lưu nguyên văn, không diễn giải công thức hay tự đổi "0912..." thành số.
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows.map((r) => this.toRow(header, r as unknown as Record<string, unknown>)) },
      })
    } catch (err) {
      wrapGoogleError(err)
    }
    this.markStale()
  }

  async update<T extends TableName>(table: T, row: RowOf<T>): Promise<void> {
    let loaded = (await this.writable(table))[table]
    let found = loaded.rows.find((r) => r.obj.id === row.id)
    if (!found) {
      loaded = (await this.loadFresh())[table]
      found = loaded.rows.find((r) => r.obj.id === row.id)
      if (!found) throw new AppError(404, 'Dữ liệu không còn tồn tại trên Google Sheets')
    }
    this.assertColumns(table, loaded.header, [row])
    const values = this.toRow(loaded.header, row as unknown as Record<string, unknown>, found.raw)
    try {
      await this.api.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `'${SHEET_DEFS[table].sheet}'!A${found.pos}:${columnLetter(loaded.header.length)}${found.pos}`,
        valueInputOption: 'RAW',
        requestBody: { values: [values] },
      })
    } catch (err) {
      wrapGoogleError(err)
    }
    found.raw = values
    this.markStale()
  }

  /** Ghi nhiều dòng trong một lệnh (values.batchUpdate) để không tốn quota Sheets theo từng dòng. */
  async updateMany<T extends TableName>(table: T, rows: RowOf<T>[]): Promise<void> {
    if (!rows.length) return
    let loaded = (await this.writable(table))[table]
    const locate = () => rows.map((row) => loaded.rows.find((r) => r.obj.id === row.id))
    let found = locate()
    if (found.some((f) => !f)) {
      loaded = (await this.loadFresh())[table]
      found = locate()
      if (found.some((f) => !f)) throw new AppError(404, 'Dữ liệu không còn tồn tại trên Google Sheets')
    }
    this.assertColumns(table, loaded.header, rows)
    const lastCol = columnLetter(loaded.header.length)
    const data = rows.map((row, i) => ({
      range: `'${SHEET_DEFS[table].sheet}'!A${found[i]!.pos}:${lastCol}${found[i]!.pos}`,
      values: [this.toRow(loaded.header, row as unknown as Record<string, unknown>, found[i]!.raw)],
    }))
    try {
      await this.api.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data },
      })
    } catch (err) {
      wrapGoogleError(err)
    }
    data.forEach((d, i) => (found[i]!.raw = d.values[0]))
    this.markStale()
  }

  private async sheetId(title: string, refreshed = false): Promise<number> {
    if (!this.sheetIds) {
      try {
        const res = await this.api.spreadsheets.get({
          spreadsheetId: this.spreadsheetId,
          fields: 'sheets.properties(sheetId,title)',
        })
        this.sheetIds = new Map(
          (res.data.sheets ?? []).map((s) => [s.properties?.title ?? '', s.properties?.sheetId ?? 0]),
        )
      } catch (err) {
        wrapGoogleError(err)
      }
    }
    const id = this.sheetIds.get(title)
    if (id !== undefined) return id
    if (!refreshed) {
      this.sheetIds = null
      return this.sheetId(title, true)
    }
    throw new AppError(503, `Không tìm thấy sheet "${title}"`)
  }

  async remove(table: TableName, ids: string[]): Promise<void> {
    if (!ids.length) return
    const drop = new Set(ids)
    // Đọc mới để chắc chắn vị trí dòng đúng, rồi xóa từ dưới lên để các dòng không bị dịch.
    let loaded = (await this.loadFresh())[table]
    if (loaded.missing) {
      // Có thể sheet vừa được tạo (init-sheets) trong lúc app còn nhớ là "thiếu" — kiểm tra lại ngay.
      this.missingSheets.clear()
      loaded = (await this.loadFresh())[table]
      if (loaded.missing) return
    }
    const positions = loaded.rows
      .filter((r) => drop.has(r.obj.id as string))
      .map((r) => r.pos)
      .sort((a, b) => b - a)
    if (!positions.length) return
    const sheetId = await this.sheetId(SHEET_DEFS[table].sheet)
    try {
      await this.api.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: positions.map((pos) => ({
            deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: pos - 1, endIndex: pos } },
          })),
        },
      })
    } catch (err) {
      wrapGoogleError(err)
    }
    this.positionsValid = false
    this.markStale()
  }
}
