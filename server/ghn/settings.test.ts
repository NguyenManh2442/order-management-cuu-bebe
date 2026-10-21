import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_GHN_DEFAULTS, type GhnEnv } from '../../shared/ghn'
import type { GhnSettingsInput } from '../../shared/schemas'
import { Mutex } from '../mutex'
import { MemoryStore } from '../repo/memory'
import { FakeGhnClient, HttpGhnClient } from './client'
import { GhnRuntime } from './settings'

/** Client "thật" nhưng không gọi mạng: token "good" có shop 111 (chưa có địa chỉ) và 222 (có địa chỉ). */
class StubClient extends HttpGhnClient {
  private fake = new FakeGhnClient()
  constructor(env: GhnEnv, private tok: string, shopId: string) {
    super(env, tok, shopId)
  }
  override async shops() {
    if (this.tok !== 'good') throw new Error('Token is not valid!')
    return [
      { id: 111, name: 'Shop chưa địa chỉ', address: '' },
      { id: 222, name: 'Shop có địa chỉ', address: '1 Kim Mã' },
    ]
  }
  override provinces() {
    return this.fake.provinces()
  }
  override wards(id: number) {
    return this.fake.wards(id)
  }
}

function runtime(file: string) {
  return new GhnRuntime({
    store: new MemoryStore(),
    lock: new Mutex(),
    file,
    fromEnv: null,
    demoFallback: false,
    createClient: (env, token, shopId) => new StubClient(env, token, shopId),
  })
}

const input = (over: Partial<GhnSettingsInput> = {}): GhnSettingsInput => ({
  env: 'staging',
  token: 'good',
  shop_id: '222',
  webhook_secret: '',
  sender: null,
  defaults: DEFAULT_GHN_DEFAULTS,
  ...over,
})

describe('GhnRuntime', () => {
  it('chưa thiết lập: tắt GHN; lưu xong bật ngay và ghi file 600 không lộ token ra view', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ghn-')), 'sub', 'ghn.json')
    const rt = runtime(file)
    expect(rt.shipping).toBeNull()
    expect(rt.publicConfig()).toBeNull()

    const view = await rt.save(input())
    expect(view).toMatchObject({ source: 'file', has_token: true, token_hint: 'good', shop_id: '222' })
    expect(JSON.stringify(view)).not.toContain('"token"')
    expect(rt.shipping).not.toBeNull()
    expect(rt.publicConfig()?.env).toBe('staging')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(existsSync(`${file}.tmp`)).toBe(false)

    // Khởi động lại: đọc lại từ file.
    expect(runtime(file).settings?.token).toBe('good')
  })

  it('từ chối shop không thuộc token, và shop chưa có địa chỉ mà không nhập địa chỉ lấy hàng', async () => {
    const rt = runtime(join(mkdtempSync(join(tmpdir(), 'ghn-')), 'ghn.json'))
    await expect(rt.save(input({ shop_id: '999' }))).rejects.toThrow(/không thuộc token/)
    await expect(rt.save(input({ shop_id: '111' }))).rejects.toThrow(/chưa có địa chỉ lấy hàng/)
    await expect(rt.save(input({ token: '' }))).rejects.toThrow(/Nhập token/)
  })

  it('địa chỉ lấy hàng: tra tên chuẩn theo mã; để trống token thì giữ token cũ cùng môi trường', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ghn-')), 'ghn.json')
    const rt = runtime(file)
    const sender = { name: 'MEI', phone: '0397482241', street: '5 Kim Mã', province_id: 1000002, ward_id: 100000203 }
    const view = await rt.save(input({ shop_id: '111', sender }))
    expect(view.sender).toMatchObject({ province_name: 'Hà Nội', ward_name: 'Phường Ba Đình', street: '5 Kim Mã' })

    await rt.save(input({ token: '', shop_id: '111', sender }))
    expect(JSON.parse(readFileSync(file, 'utf8')).token).toBe('good')
    await expect(rt.save(input({ env: 'production', token: '', sender }))).rejects.toThrow(/Nhập token/)
  })
})
