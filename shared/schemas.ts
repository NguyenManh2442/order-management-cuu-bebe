import { z } from 'zod'
import { COST_BASES, COST_CATEGORIES, GROUP_STATUSES, MAX_ITEMS_PER_ORDER, ORDER_STATUSES } from './constants'
import { GHN_REQUIRED_NOTES } from './ghn'
import { isValidPhone, isValidUrl } from './phone'

const money = z
  .number({ invalid_type_error: 'Nhập số tiền' })
  .int('Tiền phải là số nguyên')
  .min(0, 'Không được âm')
  .max(1_000_000_000, 'Số tiền quá lớn')

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, 'Nhập tên khách hàng').max(120, 'Tối đa 120 ký tự'),
  phone: z
    .string()
    .trim()
    .min(1, 'Nhập số điện thoại')
    .refine(isValidPhone, 'Số điện thoại không hợp lệ'),
  facebook_url: z.string().trim().max(500).refine(isValidUrl, 'Link không hợp lệ'),
  address: z.string().trim().max(500, 'Tối đa 500 ký tự'),
})

export const orderItemInputSchema = z.object({
  size: z.string().trim().min(1, 'Chọn size').max(20, 'Tối đa 20 ký tự'),
  quantity: z
    .number({ invalid_type_error: 'Nhập số lượng' })
    .int('Số lượng phải là số nguyên')
    .min(1, 'Tối thiểu 1')
    .max(10_000, 'Tối đa 10.000'),
  unit_price: money,
})

export const orderInputSchema = z
  .object({
    group_id: z.string().min(1, 'Chọn nhóm đơn hàng'),
    customer: customerInputSchema,
    items: z
      .array(orderItemInputSchema)
      .min(1, 'Cần ít nhất 1 sản phẩm')
      .max(MAX_ITEMS_PER_ORDER, `Tối đa ${MAX_ITEMS_PER_ORDER} dòng`),
    status: z.enum(ORDER_STATUSES),
    note: z.string().trim().max(1000, 'Tối đa 1000 ký tự'),
    /**
     * Khách đã cọc / chuyển khoản. Không gửi (giao diện bản cũ còn trong cache trình duyệt)
     * thì server giữ nguyên giá trị đang lưu.
     */
    paid_amount: money.optional(),
    /** Thời điểm cập nhật mà client đã đọc — để phát hiện người khác sửa trước. */
    expected_updated_at: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const total = v.items.reduce((s, i) => s + i.quantity * i.unit_price, 0)
    if ((v.paid_amount ?? 0) > total) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paid_amount'], message: 'Số tiền đã trả lớn hơn tổng đơn' })
    }
  })

export const orderStatusInputSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  expected_updated_at: z.string().optional(),
})

export const groupCostInputSchema = z.object({
  category: z.enum(COST_CATEGORIES),
  name: z.string().trim().min(1, 'Nhập tên khoản chi').max(120, 'Tối đa 120 ký tự'),
  quantity: z
    .number({ invalid_type_error: 'Nhập số lượng' })
    .positive('Số lượng phải lớn hơn 0')
    .max(1_000_000, 'Số lượng quá lớn')
    .refine((n) => Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6, 'Tối đa 3 chữ số thập phân'),
  unit: z.string().trim().max(20, 'Tối đa 20 ký tự'),
  unit_price: money,
  basis: z.enum(COST_BASES),
  note: z.string().trim().max(500, 'Tối đa 500 ký tự'),
  expected_updated_at: z.string().optional(),
})

export const bulkOrderStatusInputSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  orders: z
    .array(z.object({ id: z.string().min(1), expected_updated_at: z.string().optional() }))
    .min(1, 'Chưa chọn đơn nào')
    .max(200, 'Tối đa 200 đơn mỗi lần'),
})

export const ghnBulkPrintInputSchema = z.object({
  order_ids: z.array(z.string().min(1)).min(1, 'Chưa chọn đơn nào').max(100, 'Tối đa 100 nhãn mỗi lần'),
})

export const publicLinkInputSchema = z.object({
  /** true = đổi link mới, link cũ hết hiệu lực. */
  regenerate: z.boolean(),
})

export const groupInputSchema = z.object({
  name: z.string().trim().min(1, 'Nhập tên nhóm').max(120, 'Tối đa 120 ký tự'),
  description: z.string().trim().max(1000, 'Tối đa 1000 ký tự'),
  product_name: z.string().trim().max(200, 'Tối đa 200 ký tự'),
  default_unit_price: money,
  status: z.enum(GROUP_STATUSES),
  expected_updated_at: z.string().optional(),
})

const posInt = (label: string, max: number) =>
  z
    .number({ invalid_type_error: `Nhập ${label}` })
    .int(`${label} phải là số nguyên`)
    .min(1, `${label} tối thiểu 1`)
    .max(max, `${label} tối đa ${max.toLocaleString('vi-VN')}`)

/** Thông tin gửi sang GHN. Tỉnh/phường gửi bằng mã, server tự tra tên chuẩn của GHN. */
export const ghnShipmentInputSchema = z
  .object({
    to_name: z.string().trim().min(1, 'Nhập tên người nhận').max(200, 'Tối đa 200 ký tự'),
    to_phone: z.string().trim().min(1, 'Nhập số điện thoại').refine(isValidPhone, 'Số điện thoại không hợp lệ'),
    /** true = địa chỉ hệ mới (Tỉnh → Phường), false = hệ cũ (Tỉnh → Quận/Huyện → Phường) như trên GHN. */
    is_new_address: z.boolean(),
    province_id: z.number({ invalid_type_error: 'Chọn tỉnh/thành' }).int().positive('Chọn tỉnh/thành'),
    /** Chỉ dùng ở hệ cũ. */
    district_id: z.number({ invalid_type_error: 'Chọn quận/huyện' }).int().min(0),
    ward_id: z.number({ invalid_type_error: 'Chọn phường/xã' }).int().positive('Chọn phường/xã'),
    street: z.string().trim().min(1, 'Nhập số nhà, tên đường').max(500, 'Tối đa 500 ký tự'),
    cod_amount: money.max(50_000_000, 'COD tối đa 50.000.000'),
    insurance_value: money.max(5_000_000, 'Khai giá tối đa 5.000.000'),
    // Từ 20kg GHN dùng dịch vụ hàng nặng, cần kích thước từng kiện — tạo trực tiếp trên GHN.
    weight: posInt('Khối lượng', 19_999),
    length: posInt('Chiều dài', 200),
    width: posInt('Chiều rộng', 200),
    height: posInt('Chiều cao', 200),
    payment_type_id: z.union([z.literal(1), z.literal(2)]),
    required_note: z.enum(GHN_REQUIRED_NOTES),
    note: z.string().trim().max(1000, 'Tối đa 1000 ký tự'),
    /** Lưu địa chỉ này vào khách để lần sau tự điền. */
    save_address: z.boolean(),
    expected_updated_at: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.is_new_address && v.district_id <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['district_id'], message: 'Chọn quận/huyện' })
    }
  })

/** Nháp form GHN: chấp nhận thông tin còn thiếu, chỉ chặn dữ liệu sai kiểu/quá dài. */
export const ghnDraftSchema = z
  .object({
    to_name: z.string().max(200),
    to_phone: z.string().max(30),
    is_new_address: z.boolean(),
    province_id: z.number().int().min(0),
    district_id: z.number().int().min(0),
    ward_id: z.number().int().min(0),
    street: z.string().max(500),
    cod_amount: z.number().int().min(0).max(1_000_000_000),
    insurance_value: z.number().int().min(0).max(1_000_000_000),
    weight: z.number().int().min(0).max(1_000_000),
    length: z.number().int().min(0).max(10_000),
    width: z.number().int().min(0).max(10_000),
    height: z.number().int().min(0).max(10_000),
    payment_type_id: z.union([z.literal(1), z.literal(2)]),
    required_note: z.enum(GHN_REQUIRED_NOTES),
    note: z.string().max(1000),
    save_address: z.boolean(),
  })
  .partial()

const ghnEnvSchema = z.enum(['staging', 'production'])

export const ghnShopsQuerySchema = z.object({
  env: ghnEnvSchema,
  /** '' = dùng token đã lưu. */
  token: z.string().trim().max(200),
})

export const ghnPlacesQuerySchema = ghnShopsQuerySchema.extend({
  shop_id: z.string().trim().regex(/^\d+$/, 'Chọn cửa hàng trước'),
  /** 0 = lấy danh sách tỉnh, > 0 = lấy phường/xã của tỉnh đó. */
  province_id: z.number().int().min(0),
})

export const ghnSettingsInputSchema = z.object({
  env: ghnEnvSchema,
  /** '' = giữ token đã lưu. */
  token: z.string().trim().max(200),
  shop_id: z.string().trim().regex(/^\d+$/, 'Chọn cửa hàng'),
  webhook_secret: z
    .string()
    .trim()
    .max(200)
    .refine((s) => !s || s.length >= 16, 'Tối thiểu 16 ký tự (để trống = tắt webhook)'),
  /** null = dùng địa chỉ shop đã khai báo trên GHN. */
  sender: z
    .object({
      name: z.string().trim().max(120, 'Tối đa 120 ký tự'),
      phone: z.string().trim().refine((s) => !s || isValidPhone(s), 'Số điện thoại không hợp lệ'),
      street: z.string().trim().min(1, 'Nhập số nhà, tên đường').max(500),
      province_id: z.number({ invalid_type_error: 'Chọn tỉnh/thành' }).int().positive('Chọn tỉnh/thành'),
      ward_id: z.number({ invalid_type_error: 'Chọn phường/xã' }).int().positive('Chọn phường/xã'),
    })
    .nullable(),
  defaults: z.object({
    item_weight: posInt('Khối lượng', 19_999),
    length: posInt('Chiều dài', 200),
    width: posInt('Chiều rộng', 200),
    height: posInt('Chiều cao', 200),
    required_note: z.enum(GHN_REQUIRED_NOTES),
    payment_type: z.union([z.literal(1), z.literal(2)]),
  }),
})

export const ghnCancelInputSchema = z.object({ expected_updated_at: z.string().optional() })

export const loginInputSchema = z.object({
  username: z.string().trim().min(1, 'Nhập tên đăng nhập').max(64),
  password: z.string().min(1, 'Nhập mật khẩu').max(200),
})

export type CustomerInput = z.infer<typeof customerInputSchema>
export type OrderItemInput = z.infer<typeof orderItemInputSchema>
export type OrderInput = z.infer<typeof orderInputSchema>
export type OrderStatusInput = z.infer<typeof orderStatusInputSchema>
export type BulkOrderStatusInput = z.infer<typeof bulkOrderStatusInputSchema>
export type GroupInput = z.infer<typeof groupInputSchema>
export type GroupCostInput = z.infer<typeof groupCostInputSchema>
export type LoginInput = z.infer<typeof loginInputSchema>
export type GhnShipmentInput = z.infer<typeof ghnShipmentInputSchema>
export type GhnDraft = z.infer<typeof ghnDraftSchema>
export type GhnSettingsInput = z.infer<typeof ghnSettingsInputSchema>
