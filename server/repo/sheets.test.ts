import { describe, expect, it } from 'vitest'
import { SHEET_DEFS, SheetsStore } from './sheets'

/** Giả lập Google Sheets API ở mức đủ cho SheetsStore: batchGet / update / batchUpdate. */
function fakeApi(sheets: Record<string, unknown[][]>) {
  const writes: { range: string; values: unknown[][] }[] = []
  const api = {
    spreadsheets: {
      values: {
        batchGet: async ({ ranges }: { ranges: string[] }) => {
          // Giống Google: một sheet không tồn tại thì cả batch lỗi.
          const missing = ranges.find((r) => !(r.replace(/'/g, '') in sheets))
          if (missing) throw Object.assign(new Error(`Unable to parse range: ${missing}`), { code: 400 })
          return { data: { valueRanges: ranges.map((r) => ({ values: sheets[r.replace(/'/g, '')] })) } }
        },
        update: async ({ range, requestBody }: { range: string; requestBody: { values: unknown[][] } }) => {
          writes.push({ range, values: requestBody.values })
        },
        batchUpdate: async ({ requestBody }: { requestBody: { data: { range: string; values: unknown[][] }[] } }) => {
          writes.push(...requestBody.data)
        },
      },
    },
  }
  return { api, writes }
}

/** Sheet "Orders" như trên production TRƯỚC khi chạy init-sheets: chưa có paid_amount, public_token. */
function oldOrdersSheet() {
  const header = Object.keys(SHEET_DEFS.orders.columns).filter((c) => !SHEET_DEFS.orders.optional?.includes(c))
  header.push('ghi_chu_rieng') // cột người dùng tự thêm
  const row = header.map((c) =>
    c === 'id' ? 'o1' : c === 'total_amount' ? 200000 : c === 'status' ? 'pending' : c === 'ghi_chu_rieng' ? 'giữ nguyên' : '',
  )
  const headerOf = (t: keyof typeof SHEET_DEFS) => Object.keys(SHEET_DEFS[t].columns)
  const sheets: Record<string, unknown[][]> = {
    Customers: [headerOf('customers')],
    OrderGroups: [headerOf('groups')],
    Orders: [header, row],
    OrderItems: [headerOf('items')],
  }
  return { header, sheets }
}

describe('SheetsStore với sheet chưa có cột mới', () => {
  it('vẫn đọc được, cột mới nhận giá trị mặc định', async () => {
    const { sheets } = oldOrdersSheet()
    const store = new SheetsStore(fakeApi(sheets).api as never, 'id', 0)
    const snap = await store.snapshot()
    expect(snap.orders[0]).toMatchObject({ id: 'o1', total_amount: 200000, paid_amount: 0, public_token: '' })
  })

  it('ghi giá trị mặc định thì được, giữ cột người dùng tự thêm', async () => {
    const { sheets, header } = oldOrdersSheet()
    const { api, writes } = fakeApi(sheets)
    const store = new SheetsStore(api as never, 'id', 0)
    const [order] = (await store.snapshot(true)).orders
    await store.update('orders', { ...order, status: 'confirmed' })
    expect(writes).toHaveLength(1)
    expect(writes[0].values[0]).toHaveLength(header.length)
    expect(writes[0].values[0][header.indexOf('ghi_chu_rieng')]).toBe('giữ nguyên')
    expect(writes[0].values[0][header.indexOf('status')]).toBe('confirmed')
  })

  it('có dữ liệu cho cột chưa tồn tại thì báo lỗi, không âm thầm làm mất', async () => {
    const { sheets } = oldOrdersSheet()
    const { api, writes } = fakeApi(sheets)
    const store = new SheetsStore(api as never, 'id', 0)
    const [order] = (await store.snapshot(true)).orders
    await expect(store.update('orders', { ...order, paid_amount: 50000 })).rejects.toMatchObject({ status: 503 })
    await expect(store.updateMany('orders', [{ ...order, public_token: 'x' }])).rejects.toMatchObject({ status: 503 })
    expect(writes).toHaveLength(0)
  })

  it('thiếu cột bắt buộc vẫn báo lỗi như trước', async () => {
    const { sheets } = oldOrdersSheet()
    sheets.Orders = [sheets.Orders[0].filter((c) => c !== 'status')]
    const store = new SheetsStore(fakeApi(sheets).api as never, 'id', 0)
    await expect(store.snapshot()).rejects.toMatchObject({ status: 503 })
  })

  it('updateMany ghi đúng dòng trong một lệnh', async () => {
    const { sheets, header } = oldOrdersSheet()
    const second = [...sheets.Orders[1]]
    second[header.indexOf('id')] = 'o2'
    sheets.Orders.push(second)
    const { api, writes } = fakeApi(sheets)
    const store = new SheetsStore(api as never, 'id', 0)
    const orders = (await store.snapshot(true)).orders
    await store.updateMany('orders', orders.map((o) => ({ ...o, status: 'packing' as const })))
    expect(writes.map((w) => w.range.split('!')[1].split(':')[0])).toEqual(['A2', 'A3'])
  })
})

describe('SheetsStore khi spreadsheet chưa có sheet GroupCosts', () => {
  it('vẫn đọc được các bảng khác, chi phí coi như rỗng', async () => {
    const { sheets } = oldOrdersSheet()
    const store = new SheetsStore(fakeApi(sheets).api as never, 'id', 0)
    const snap = await store.snapshot()
    expect(snap.orders).toHaveLength(1)
    expect(snap.costs).toEqual([])
  })

  it('ghi chi phí khi chưa có sheet thì báo chạy init-sheets', async () => {
    const { sheets } = oldOrdersSheet()
    const store = new SheetsStore(fakeApi(sheets).api as never, 'id', 0)
    await expect(
      store.insert('costs', [
        { id: 'k1', group_id: 'g', category: 'material', name: 'Vải', quantity: 1.5, unit: 'mét', unit_price: 1, basis: 'fixed', note: '', created_at: '', updated_at: '' },
      ]),
    ).rejects.toMatchObject({ status: 503, message: expect.stringContaining('init-sheets') })
  })

  it('tạo sheet xong thì ghi được ngay, không cần khởi động lại', async () => {
    const { sheets } = oldOrdersSheet()
    const { api, writes } = fakeApi(sheets)
    const appended: unknown[][] = []
    ;(api.spreadsheets.values as Record<string, unknown>).append = async ({ requestBody }: { requestBody: { values: unknown[][] } }) => {
      appended.push(...requestBody.values)
    }
    const store = new SheetsStore(api as never, 'id', 0)
    await store.snapshot()
    sheets.GroupCosts = [Object.keys(SHEET_DEFS.costs.columns), ['k0', 'g', 'labor', 'Công may', '1,5', 'chiếc', 60000, 'per_item', '', '', '']]
    await store.insert('costs', [
      { id: 'k1', group_id: 'g', category: 'material', name: 'Vải', quantity: 1.5, unit: 'mét', unit_price: 1, basis: 'fixed', note: '', created_at: '', updated_at: '' },
    ])
    expect(appended).toHaveLength(1)
    expect(writes).toHaveLength(0)
    const snap = await store.snapshot(true)
    // Số lẻ gõ tay kiểu Việt Nam "1,5" vẫn đọc đúng.
    expect(snap.costs[0]).toMatchObject({ quantity: 1.5, category: 'labor', basis: 'per_item' })
  })
})

describe('SheetsStore — các lỗi phát hiện khi review', () => {
  const costRow = (id: string) => [id, 'g', 'material', 'Vải', 1, 'mét', 1000, 'fixed', '', '', '']

  it('sheet GroupCosts đã tạo nhưng chưa có dòng tiêu đề không làm sập app', async () => {
    const { sheets } = oldOrdersSheet()
    sheets.GroupCosts = []
    const store = new SheetsStore(fakeApi(sheets).api as never, 'id', 0)
    const snap = await store.snapshot()
    expect(snap.orders).toHaveLength(1)
    expect(snap.costs).toEqual([])
  })

  it('thiếu sheet bắt buộc không đánh dấu nhầm GroupCosts là thiếu', async () => {
    const { sheets } = oldOrdersSheet()
    sheets.GroupCosts = [Object.keys(SHEET_DEFS.costs.columns), costRow('k1')]
    const orders = sheets.Orders
    delete sheets.Orders
    const store = new SheetsStore(fakeApi(sheets).api as never, 'id', 0)
    await expect(store.snapshot()).rejects.toMatchObject({ status: 503 })
    sheets.Orders = orders // sửa xong sheet bắt buộc
    expect((await store.snapshot(true)).costs).toHaveLength(1)
  })

  it('xóa khoản chi được khi GroupCosts tạo sau lúc server đã lưu danh sách mã sheet', async () => {
    const { sheets } = oldOrdersSheet()
    const { api } = fakeApi(sheets)
    const titles = () => Object.keys(sheets).map((title, i) => ({ properties: { title, sheetId: i + 1 } }))
    const deleted: unknown[] = []
    Object.assign(api.spreadsheets, {
      get: async () => ({ data: { sheets: titles() } }),
      batchUpdate: async ({ requestBody }: { requestBody: { requests: unknown[] } }) => {
        deleted.push(...requestBody.requests)
      },
    })
    sheets.OrderItems.push(['i1', 'o1', 'Váy', 'M', 1, 1, 1, ''])
    const store = new SheetsStore(api as never, 'id', 0)
    await store.remove('items', ['i1']) // lưu tạm danh sách mã sheet (chưa có GroupCosts)
    sheets.GroupCosts = [Object.keys(SHEET_DEFS.costs.columns), costRow('k1')] // chạy init-sheets
    await store.remove('costs', ['k1'])
    expect(deleted).toHaveLength(2)
  })
})
