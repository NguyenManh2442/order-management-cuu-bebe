import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const vnd = new Intl.NumberFormat('vi-VN')
export const formatNumber = (n: number) => vnd.format(n)
export const formatVND = (n: number) => `${vnd.format(n)} ₫`

const TZ = 'Asia/Ho_Chi_Minh'
const dateTimeFmt = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const dateFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' })
const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

export const formatDateTime = (iso: string) => (iso ? dateTimeFmt.format(new Date(iso)) : '')
export const formatDate = (iso: string) => (iso ? dateFmt.format(new Date(iso)) : '')
/** yyyy-mm-dd theo giờ VN, để so với giá trị <input type="date">. */
export const dateKey = (iso: string) => (iso ? keyFmt.format(new Date(iso)) : '')

/** Bỏ dấu tiếng Việt để tìm kiếm "lan" khớp "Lân". */
export function searchKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}
