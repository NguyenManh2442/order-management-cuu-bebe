import type { DataStore, RowOf, Snapshot, TableName } from './types'

/** Kho trong bộ nhớ cho chế độ demo và test — không bao giờ chạm vào Google Sheets. */
export class MemoryStore implements DataStore {
  private data: Snapshot

  constructor(seed?: Snapshot) {
    this.data = structuredClone({ customers: [], groups: [], orders: [], items: [], costs: [], ...seed })
  }

  async snapshot(): Promise<Snapshot> {
    return structuredClone(this.data)
  }

  async insert<T extends TableName>(table: T, rows: RowOf<T>[]): Promise<void> {
    ;(this.data[table] as RowOf<T>[]).push(...structuredClone(rows))
  }

  async update<T extends TableName>(table: T, row: RowOf<T>): Promise<void> {
    const list = this.data[table] as RowOf<T>[]
    const idx = list.findIndex((r) => r.id === row.id)
    if (idx < 0) throw new Error(`Row ${row.id} not found in ${table}`)
    list[idx] = structuredClone(row)
  }

  async updateMany<T extends TableName>(table: T, rows: RowOf<T>[]): Promise<void> {
    const ids = new Set((this.data[table] as RowOf<T>[]).map((r) => r.id))
    const missing = rows.find((r) => !ids.has(r.id))
    if (missing) throw new Error(`Row ${missing.id} not found in ${table}`)
    for (const row of rows) await this.update(table, row)
  }

  async remove(table: TableName, ids: string[]): Promise<void> {
    const drop = new Set(ids)
    ;(this.data as Record<TableName, { id: string }[]>)[table] = this.data[table].filter((r) => !drop.has(r.id))
  }
}
