import { ORDER_STATUS_LABELS } from '@shared/constants'
import { ghnStatusLabel } from '@shared/ghn'
import type { OrderView } from '@shared/types'
import { formatDateTime } from './utils'

/** Chặn "CSV injection": ô bắt đầu bằng = + - @ sẽ bị Excel hiểu là công thức. */
function cell(value: string | number): string {
  let s = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Giữ số 0 đầu của số điện thoại khi mở bằng Excel. */
const textCell = (s: string) => (s ? `"=""${s.replace(/"/g, '')}"""` : '')

/**
 * Xuất CSV UTF-8 có BOM để Excel đọc đúng tiếng Việt.
 * Đơn có nhiều size → mỗi size một dòng để dễ lọc/đếm trong Excel.
 */
export function ordersToCsv(orders: OrderView[]): string {
  const header = [
    'Mã đơn', 'Nhóm', 'Khách hàng', 'Số điện thoại', 'Facebook', 'Địa chỉ', 'Sản phẩm', 'Size', 'Số lượng',
    'Đơn giá', 'Thành tiền dòng', 'Tổng đơn', 'Trạng thái', 'Ghi chú', 'Ngày tạo', 'Cập nhật',
    'Mã vận đơn GHN', 'Trạng thái GHN', 'Phí GHN', 'COD GHN',
  ]
  const lines = [header.map(cell).join(',')]
  for (const o of orders) {
    const items = o.items.length ? o.items : [null]
    for (const it of items) {
      lines.push(
        [
          cell(o.order_code),
          cell(o.group_name),
          cell(o.customer.name),
          textCell(o.customer.phone),
          cell(o.customer.facebook_url),
          cell(o.customer.address),
          cell(it?.product_name ?? ''),
          cell(it?.size ?? ''),
          cell(it?.quantity ?? ''),
          cell(it?.unit_price ?? ''),
          cell(it?.line_total ?? ''),
          cell(o.total_amount),
          cell(ORDER_STATUS_LABELS[o.status]),
          cell(o.note),
          cell(formatDateTime(o.created_at)),
          cell(formatDateTime(o.updated_at)),
          cell(o.ghn_order_code),
          cell(o.ghn_order_code ? ghnStatusLabel(o.ghn_status) : ''),
          cell(o.ghn_order_code ? o.ghn_fee : ''),
          cell(o.ghn_order_code ? o.ghn_cod_amount : ''),
        ].join(','),
      )
    }
  }
  return '﻿' + lines.join('\r\n')
}

export function downloadCsv(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}
