import type { Customer, GroupCost, Order, OrderGroup, OrderItem } from '../../shared/types'

export interface Snapshot {
  customers: Customer[]
  groups: OrderGroup[]
  orders: Order[]
  items: OrderItem[]
  costs: GroupCost[]
}

export type TableName = keyof Snapshot
export type RowOf<T extends TableName> = Snapshot[T][number]

/**
 * Kho dữ liệu dạng bảng. Mọi thao tác ghi do OrderService gọi tuần tự (trong mutex)
 * ngay sau khi đọc snapshot(true), nên không có hai lần ghi chồng nhau từ server này.
 */
export interface DataStore {
  /** fresh=true bỏ qua cache, dùng trước khi ghi. */
  snapshot(fresh?: boolean): Promise<Snapshot>
  insert<T extends TableName>(table: T, rows: RowOf<T>[]): Promise<void>
  update<T extends TableName>(table: T, row: RowOf<T>): Promise<void>
  /** Cập nhật nhiều dòng cùng lúc (mọi id phải tồn tại). */
  updateMany<T extends TableName>(table: T, rows: RowOf<T>[]): Promise<void>
  remove(table: TableName, ids: string[]): Promise<void>
}
