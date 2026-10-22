import { randomBytes } from 'node:crypto'
import {
  GHN_CANCELLABLE_STATUSES,
  type GhnPaymentType,
  type GhnPlace,
  type GhnQuote,
  type GhnRequiredNote,
  type GhnShop,
} from '../../shared/ghn'
import { AppError } from '../errors'

/** Body của "Tạo đơn" / "Xem trước đơn". Địa chỉ gửi bằng tên, theo hệ mới (2 cấp) hoặc cũ (3 cấp). */
/** Địa chỉ người gửi khai báo trong .env (GHN_FROM_*), dùng khi shop trên GHN chưa có địa chỉ. */
export interface GhnSender {
  name: string
  phone: string
  street: string
  ward: string
  province: string
}

export interface GhnOrderPayload {
  client_order_code?: string
  from_name?: string
  from_phone?: string
  from_address?: string
  from_ward_name?: string
  from_province_name?: string
  is_new_from_address?: boolean
  return_name?: string
  return_phone?: string
  return_address?: string
  return_ward_name?: string
  return_province_name?: string
  is_new_return_address?: boolean
  to_name: string
  to_phone: string
  to_address: string
  to_ward_name: string
  /** Chỉ gửi ở hệ cũ. */
  to_district_name?: string
  to_province_name: string
  is_new_to_address: boolean
  weight: number
  length: number
  width: number
  height: number
  service_type_id: 2
  payment_type_id: GhnPaymentType
  required_note: GhnRequiredNote
  cod_amount: number
  insurance_value: number
  order_value: number
  note: string
  content: string
  items: { name: string; code?: string; quantity: number; price: number }[]
}

export interface GhnCreated extends GhnQuote {
  order_code: string
}

export interface GhnOrderDetail {
  status: string
  /** Thời điểm cập nhật cuối của đơn trên GHN (ISO 8601). */
  updated_date: string
  leadtime: string
  cod_amount: number
}

export interface GhnClient {
  readonly env: string
  /** Hệ mới 2 cấp. */
  provinces(): Promise<GhnPlace[]>
  wards(provinceId: number): Promise<GhnPlace[]>
  /** Hệ cũ 3 cấp (trước 01/07/2025), như công tắc "Địa chỉ mới" tắt trên GHN. */
  oldProvinces(): Promise<GhnPlace[]>
  districts(provinceId: number): Promise<GhnPlace[]>
  oldWards(districtId: number): Promise<GhnPlace[]>
  preview(body: GhnOrderPayload): Promise<GhnQuote>
  create(body: GhnOrderPayload): Promise<GhnCreated>
  detail(orderCode: string): Promise<GhnOrderDetail>
  cancel(orderCode: string): Promise<void>
  /** Link in nhãn vận đơn khổ A5, một hoặc nhiều vận đơn (hết hạn sau khoảng 30 phút). */
  printUrl(orderCodes: string[]): Promise<string>
}

interface GhnEnvelope<T> {
  code: number
  message?: string
  message_display?: string
  code_message?: string
  code_message_value?: string
  data: T
}

interface RawPlace {
  _id: number
  name: string
  extension_names?: string[]
  status?: number
}

const MASTER_DATA_TTL = 24 * 3600_000

interface RawOldPlace {
  ProvinceID?: number
  ProvinceName?: string
  DistrictID?: number
  DistrictName?: string
  WardCode?: string
  WardName?: string
  NameExtension?: string[] | null
  Status?: number
  /** 0 khóa, 1 chỉ lấy, 2 chỉ giao, 3 lấy + giao. */
  SupportType?: number
}

/**
 * Danh mục hệ cũ. Mã phường cũ là chuỗi số (WardCode) — đổi sang số để dùng chung ô chọn;
 * khi tạo đơn chỉ gửi tên nên không cần giữ nguyên số 0 ở đầu.
 */
function toOldPlaces(rows: RawOldPlace[] | null, kind: 'province' | 'district' | 'ward'): GhnPlace[] {
  return (rows ?? [])
    .filter((r) => r.Status === undefined || r.Status === 1)
    // Bỏ quận/phường GHN không giao tới (khóa hoặc chỉ lấy hàng).
    .filter((r) => kind === 'province' || r.SupportType === undefined || r.SupportType >= 2)
    .map((r) => ({
      id: kind === 'province' ? Number(r.ProvinceID) : kind === 'district' ? Number(r.DistrictID) : Number(r.WardCode),
      name: String((kind === 'province' ? r.ProvinceName : kind === 'district' ? r.DistrictName : r.WardName) ?? ''),
      aliases: r.NameExtension ?? [],
    }))
    .filter((p) => Number.isFinite(p.id) && p.id > 0 && p.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }))
}

const toPlaces = (rows: RawPlace[] | null) =>
  (rows ?? [])
    .filter((r) => r.status === undefined || r.status === 1)
    .map((r) => ({ id: r._id, name: r.name, aliases: r.extension_names ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'))

/** Lỗi GHN dạng "Lỗi gọi API: corev2_xxx - Đơn hàng không tồn tại": phần có nghĩa nằm sau dấu " - " cuối. */
function ghnMessage(body: Partial<GhnEnvelope<unknown>> | null): string {
  // message cụ thể hơn code_message_value (ví dụ "Lỗi lấy thông tin shop" so với "Lỗi hệ thống").
  const raw = body?.message_display || body?.message || body?.code_message_value || ''
  const idx = raw.lastIndexOf(' - ')
  return (idx >= 0 ? raw.slice(idx + 3) : raw).trim()
}

export class HttpGhnClient implements GhnClient {
  private readonly baseUrl: string
  private provinceCache: { at: number; data: GhnPlace[] } | null = null
  private wardCache = new Map<number, { at: number; data: GhnPlace[] }>()
  /** Danh mục hệ cũ, theo đường dẫn API. */
  private oldCache = new Map<string, { at: number; data: GhnPlace[] }>()

  constructor(
    readonly env: 'staging' | 'production',
    private token: string,
    private shopId: string,
  ) {
    this.baseUrl =
      env === 'production' ? 'https://online-gateway.ghn.vn' : 'https://dev-online-gateway.ghn.vn'
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Token: this.token,
          ShopId: this.shopId,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      })
    } catch (err) {
      console.error(`[ghn] Không gọi được ${path}: ${(err as Error)?.name}`)
      throw new AppError(503, 'Không kết nối được Giao Hàng Nhanh, vui lòng thử lại.')
    }
    const data = (await res.json().catch(() => null)) as GhnEnvelope<T> | null
    if (res.ok && data?.code === 200) return data.data
    // Không log body (có tên, SĐT, địa chỉ người nhận) — chỉ log mã lỗi.
    console.error(`[ghn] ${path} lỗi HTTP ${res.status} ${data?.code ?? ''} ${data?.code_message ?? ''}`)
    if (res.status === 401) {
      throw new AppError(
        503,
        `Token GHN không hợp lệ cho môi trường ${this.env} (token staging và production khác nhau), hoặc IP chưa được cho phép. Kiểm tra GHN_TOKEN, GHN_ENV.`,
      )
    }
    if (data?.code_message === 'CLIENT_NOT_OWNER_OF_SHOP' || data?.code_message === 'CLIENT_NOT_BELONG_OF_SHOP') {
      throw new AppError(503, 'Token GHN không thuộc shop đã cấu hình. GHN_SHOP_ID phải là mã cửa hàng (không phải mã tài khoản).')
    }
    const message = ghnMessage(data)
    if (data?.code_message === 'FROM_ADDRESS_CONVERT_FAIL') {
      throw new AppError(
        503,
        'GHN không đọc được địa chỉ lấy hàng: shop trên GHN chưa có địa chỉ hoặc GHN_FROM_* sai tên phường/tỉnh. Khai báo địa chỉ cho shop trên GHN hoặc điền GHN_FROM_* trong .env.',
      )
    }
    if (message === 'Lỗi lấy thông tin shop') {
      throw new AppError(503, 'GHN không tìm thấy shop. GHN_SHOP_ID phải là mã cửa hàng thuộc token này (xem log lúc khởi động server).')
    }
    throw new AppError(res.status >= 500 ? 503 : 400, message ? `GHN: ${message}` : `GHN lỗi (${res.status})`)
  }

  /** Các cửa hàng thuộc token (không cần ShopId). */
  async shops(): Promise<GhnShop[]> {
    const d = await this.call<{ shops?: { _id: number; name: string; address?: string }[] }>(
      'GET',
      '/shiip/public-api/v2/shop/all?limit=200',
    )
    return (d?.shops ?? []).map((s) => ({ id: s._id, name: s.name, address: s.address ?? '' }))
  }

  /** Kiểm tra token, shop ID và địa chỉ lấy hàng lúc khởi động; chỉ ghi log, không chặn server. */
  async checkShop(sender: GhnSender | null): Promise<void> {
    try {
      const shops = await this.shops()
      const shop = shops.find((s) => String(s.id) === this.shopId)
      if (shop) {
        console.log(`[ghn] Token hợp lệ, shop ${this.shopId} OK`)
        if (sender) await this.checkSender(sender)
        else if (!shop.address) {
          console.error(
            '[ghn] Shop trên GHN chưa có địa chỉ lấy hàng → tạo đơn sẽ lỗi FROM_ADDRESS_CONVERT_FAIL. ' +
              'Khai báo địa chỉ cho shop trên trang GHN, hoặc điền GHN_FROM_ADDRESS / GHN_FROM_WARD / GHN_FROM_PROVINCE trong .env.',
          )
        }
      } else {
        console.error(
          `[ghn] GHN_SHOP_ID=${this.shopId} không thuộc token này (${this.env}). Shop hợp lệ: ` +
            (shops.map((s) => `${s.id} (${s.name})`).join(', ') || 'không có'),
        )
      }
    } catch (err) {
      console.error(`[ghn] Kiểm tra token thất bại: ${(err as Error).message}`)
    }
  }

  private async checkSender(sender: GhnSender) {
    const key = (s: string) => s.normalize('NFC').toLowerCase().trim()
    const province = (await this.provinces()).find((p) => key(p.name) === key(sender.province))
    if (!province) {
      console.error(`[ghn] GHN_FROM_PROVINCE="${sender.province}" không có trong danh mục tỉnh mới của GHN`)
      return
    }
    const ward = (await this.wards(province.id)).find((w) => key(w.name) === key(sender.ward))
    if (!ward) console.error(`[ghn] GHN_FROM_WARD="${sender.ward}" không thuộc ${province.name} trong danh mục GHN (cần tên đầy đủ, ví dụ "Phường Cầu Giấy")`)
    else console.log(`[ghn] Địa chỉ lấy hàng: ${sender.street}, ${ward.name}, ${province.name}`)
  }

  async provinces(): Promise<GhnPlace[]> {
    if (this.provinceCache && Date.now() - this.provinceCache.at < MASTER_DATA_TTL) return this.provinceCache.data
    const rows = await this.call<RawPlace[] | null>('GET', '/shiip/public-api/v3/master-data/province/all?limit=200')
    const data = toPlaces(rows)
    this.provinceCache = { at: Date.now(), data }
    return data
  }

  async wards(provinceId: number): Promise<GhnPlace[]> {
    const cached = this.wardCache.get(provinceId)
    if (cached && Date.now() - cached.at < MASTER_DATA_TTL) return cached.data
    const rows = await this.call<RawPlace[] | null>(
      'GET',
      `/shiip/public-api/v3/master-data/ward/all-by-province-id?province_id=${provinceId}&limit=200`,
    )
    const data = toPlaces(rows)
    // GHN trả data=null khi sai mã tỉnh: không cache kết quả rỗng.
    if (data.length) this.wardCache.set(provinceId, { at: Date.now(), data })
    return data
  }

  private async oldList(path: string, kind: 'province' | 'district' | 'ward'): Promise<GhnPlace[]> {
    const cached = this.oldCache.get(path)
    if (cached && Date.now() - cached.at < MASTER_DATA_TTL) return cached.data
    const data = toOldPlaces(await this.call<RawOldPlace[] | null>('GET', `/shiip/public-api/master-data/${path}`), kind)
    if (data.length) this.oldCache.set(path, { at: Date.now(), data })
    return data
  }

  oldProvinces() {
    return this.oldList('province', 'province')
  }

  districts(provinceId: number) {
    return this.oldList(`district?province_id=${provinceId}`, 'district')
  }

  oldWards(districtId: number) {
    return this.oldList(`ward?district_id=${districtId}`, 'ward')
  }

  async preview(body: GhnOrderPayload): Promise<GhnQuote> {
    const d = await this.call<GhnCreated>('POST', '/shiip/public-api/v2/shipping-order/preview', body)
    return { total_fee: d.total_fee ?? 0, expected_delivery_time: d.expected_delivery_time ?? '' }
  }

  async create(body: GhnOrderPayload): Promise<GhnCreated> {
    const d = await this.call<GhnCreated>('POST', '/shiip/public-api/v2/shipping-order/create', body)
    if (!d?.order_code) throw new AppError(503, 'GHN không trả về mã vận đơn, vui lòng thử lại.')
    return { order_code: d.order_code, total_fee: d.total_fee ?? 0, expected_delivery_time: d.expected_delivery_time ?? '' }
  }

  async detail(orderCode: string): Promise<GhnOrderDetail> {
    const d = await this.call<Partial<GhnOrderDetail>>(
      'GET',
      `/shiip/public-api/v2/shipping-order/detail?order_code=${encodeURIComponent(orderCode)}`,
    )
    return {
      status: String(d?.status ?? ''),
      updated_date: String(d?.updated_date ?? ''),
      leadtime: String(d?.leadtime ?? ''),
      cod_amount: Number(d?.cod_amount ?? 0),
    }
  }

  async cancel(orderCode: string): Promise<void> {
    const rows = await this.call<{ order_code: string; result: boolean; message: string }[]>(
      'POST',
      '/shiip/public-api/v2/switch-status/cancel',
      { order_codes: [orderCode] },
    )
    const r = rows?.find((x) => x.order_code === orderCode)
    if (!r?.result) throw new AppError(400, `GHN không cho hủy vận đơn này${r?.message ? `: ${r.message}` : ''}.`)
  }

  async printUrl(orderCodes: string[]): Promise<string> {
    const d = await this.call<{ token: string }>('POST', '/shiip/public-api/v2/a5/gen-token', { order_codes: orderCodes })
    return `${this.baseUrl}/a5/public-api/printA5?token=${encodeURIComponent(d.token)}`
  }
}

/**
 * GHN giả lập cho DATA_SOURCE=demo khi chưa có token: không gọi mạng.
 * Mỗi lần đồng bộ, vận đơn tiến thêm một trạng thái để thử luồng cập nhật.
 */
export class FakeGhnClient implements GhnClient {
  readonly env = 'demo'
  private orders = new Map<string, { status: string; updated: string; cod: number }>()
  // Có bước "giao thất bại" để thử mục "Cần xử lý" (gọi lại cho khách) ở chế độ demo.
  private static FLOW = ['ready_to_pick', 'picking', 'picked', 'transporting', 'delivering', 'delivery_fail', 'delivered']

  private static PROVINCES: GhnPlace[] = [
    { id: 1000001, name: 'Hồ Chí Minh', aliases: ['tp.hồ chí minh', 'hcm', 'ho chi minh', 'sài gòn', 'tphcm'] },
    { id: 1000002, name: 'Hà Nội', aliases: ['thành phố hà nội', 'ha noi', 'hn'] },
    { id: 1000003, name: 'Đà Nẵng', aliases: ['thành phố đà nẵng', 'da nang'] },
    { id: 1000004, name: 'Cần Thơ', aliases: ['thành phố cần thơ', 'can tho'] },
    { id: 1000005, name: 'Huế', aliases: ['thành phố huế', 'hue'] },
  ]
  private static WARDS: Record<number, string[]> = {
    1000001: ['Phường Sài Gòn', 'Phường Bến Thành', 'Phường Tân Định', 'Phường Xuân Hòa', 'Phường Bình Thạnh'],
    1000002: ['Phường Hoàn Kiếm', 'Phường Cầu Giấy', 'Phường Ba Đình', 'Phường Đống Đa', 'Xã Sóc Sơn'],
    1000003: ['Phường Hải Châu', 'Phường Thanh Khê', 'Phường Sơn Trà'],
    1000004: ['Phường Ninh Kiều', 'Phường Cái Khế', 'Phường Bình Thủy'],
    1000005: ['Phường Thuận Hóa', 'Phường Phú Xuân', 'Phường Vỹ Dạ'],
  }

  private static OLD: Record<number, { name: string; districts: Record<number, { name: string; wards: string[] }> }> = {
    202: {
      name: 'Hồ Chí Minh',
      districts: {
        1442: { name: 'Quận 1', wards: ['Phường Bến Nghé', 'Phường Bến Thành', 'Phường Tân Định'] },
        1444: { name: 'Quận 3', wards: ['Phường 1', 'Phường 2', 'Phường Võ Thị Sáu'] },
      },
    },
    201: {
      name: 'Hà Nội',
      districts: {
        1485: { name: 'Quận Cầu Giấy', wards: ['Phường Dịch Vọng', 'Phường Nghĩa Đô', 'Phường Quan Hoa'] },
        1488: { name: 'Quận Hoàn Kiếm', wards: ['Phường Hàng Bạc', 'Phường Tràng Tiền'] },
      },
    },
  }

  async provinces() {
    return FakeGhnClient.PROVINCES
  }

  async oldProvinces() {
    return Object.entries(FakeGhnClient.OLD).map(([id, p]) => ({ id: Number(id), name: p.name, aliases: [] }))
  }

  async districts(provinceId: number) {
    const p = FakeGhnClient.OLD[provinceId]
    return Object.entries(p?.districts ?? {}).map(([id, d]) => ({ id: Number(id), name: d.name, aliases: [] }))
  }

  async oldWards(districtId: number) {
    for (const p of Object.values(FakeGhnClient.OLD)) {
      const d = p.districts[districtId]
      if (d) return d.wards.map((name, i) => ({ id: districtId * 100 + i + 1, name, aliases: [] }))
    }
    return []
  }

  async wards(provinceId: number) {
    return (FakeGhnClient.WARDS[provinceId] ?? []).map((name, i) => ({
      id: provinceId * 100 + i + 1,
      name,
      aliases: [name.replace(/^(Phường|Xã) /, '').toLowerCase()],
    }))
  }

  private quote(body: GhnOrderPayload): GhnQuote {
    const fee = 20_000 + Math.max(0, Math.ceil((body.weight - 500) / 500)) * 5_000
    return { total_fee: fee, expected_delivery_time: new Date(Date.now() + 2 * 86_400_000).toISOString() }
  }

  async preview(body: GhnOrderPayload) {
    return this.quote(body)
  }

  async create(body: GhnOrderPayload) {
    const order_code = `DEMO${randomBytes(3).toString('hex').toUpperCase()}`
    this.orders.set(order_code, { status: 'ready_to_pick', updated: new Date().toISOString(), cod: body.cod_amount })
    return { order_code, ...this.quote(body) }
  }

  private get(code: string) {
    const o = this.orders.get(code)
    if (!o) throw new AppError(400, 'GHN: Đơn hàng không tồn tại (dữ liệu giả lập mất khi khởi động lại server)')
    return o
  }

  async detail(code: string) {
    const o = this.get(code)
    const idx = FakeGhnClient.FLOW.indexOf(o.status)
    if (idx >= 0 && idx < FakeGhnClient.FLOW.length - 1) {
      o.status = FakeGhnClient.FLOW[idx + 1]
      o.updated = new Date().toISOString()
    }
    return { status: o.status, updated_date: o.updated, leadtime: '', cod_amount: o.cod }
  }

  async cancel(code: string) {
    const o = this.get(code)
    if (!GHN_CANCELLABLE_STATUSES.includes(o.status)) throw new AppError(400, 'GHN không cho hủy vận đơn này.')
    o.status = 'cancel'
    o.updated = new Date().toISOString()
  }

  async printUrl(codes: string[]): Promise<string> {
    codes.forEach((c) => this.get(c))
    throw new AppError(400, 'Chế độ demo (GHN giả lập) không có nhãn vận đơn để in.')
  }
}
