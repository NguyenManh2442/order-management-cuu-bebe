import { GHN_PAYMENT_TYPE_LABELS, GHN_REQUIRED_NOTES, GHN_REQUIRED_NOTE_LABELS, type GhnPaymentType } from '@shared/ghn'
import type { DropdownOption } from '@/components/ui/dropdown'

/** Lựa chọn dùng chung cho form gửi GHN và màn thiết lập GHN. */
export const PAYMENT_OPTIONS: DropdownOption<GhnPaymentType>[] = ([2, 1] as const).map((v) => ({
  value: v,
  label: GHN_PAYMENT_TYPE_LABELS[v],
}))

export const REQUIRED_NOTE_OPTIONS = GHN_REQUIRED_NOTES.map((n) => ({ value: n, label: GHN_REQUIRED_NOTE_LABELS[n] }))
