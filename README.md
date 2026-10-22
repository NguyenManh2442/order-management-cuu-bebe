# Đơn Hàng Nhà Cừu

Web app quản lý đơn hàng cho người bán online qua Facebook. Ưu tiên dùng trên điện thoại, vẫn dùng tốt trên máy tính. Dữ liệu lưu trên **Google Sheets** (private), đọc/ghi qua backend nên credentials không bao giờ xuống trình duyệt.

## Chức năng

- **Nhóm đơn hàng** (mẫu sản phẩm / đợt bán): tạo, sửa, tìm kiếm, đóng/mở lại nhóm. Nhóm đã đóng vẫn giữ lịch sử, chỉ không nhận đơn mới.
- **Thống kê theo size** trong từng nhóm: số đơn, số khách (không trùng), tổng sản phẩm, bảng size. Mặc định **không tính đơn đã hủy**, có ô tích “Gồm đơn đã hủy” để đối soát, và lọc được theo trạng thái/ngày. Mọi số liệu tính lại từ đơn thực tế, không lưu số tổng.
- **Đơn hàng**: tạo/sửa/hủy/xóa, mã đơn tự sinh `DH yymmdd-001`, một đơn có thể đặt nhiều size, tổng tiền tự tính. Đổi trạng thái nhanh ngay trên danh sách.
- **Khách hàng**: lưu tự động theo số điện thoại; nhập SĐT khách cũ sẽ tự điền tên/FB/địa chỉ; xem lịch sử đơn của khách.
- **Tìm kiếm & lọc** theo mã đơn, tên, SĐT, trạng thái, nhóm, khoảng ngày; **xuất CSV** (mở được bằng Excel, giữ số 0 đầu SĐT) theo đúng bộ lọc đang chọn.
- **Chi phí & lãi theo nhóm**: nhập nguyên vật liệu, công thợ, chi phí khác (số lượng có thể lẻ, ví dụ 1,2 mét). Mỗi khoản tính **cố định** (50 mét × giá) hoặc **theo mỗi sản phẩm** (1,2 mét/sp × số sản phẩm đã đặt — tự cập nhật khi có đơn mới). Từ trang nhóm bấm **Chi phí & lãi dự kiến** để mở màn hình riêng: tổng chi phí, chi phí/sản phẩm, doanh thu dự kiến (đơn chưa hủy, chưa hoàn), lãi dự kiến và danh sách khoản chi.
- **Tiền cọc / chuyển khoản**: ghi số tiền khách đã trả trước; app tính **còn phải thu**, form GHN tự điền thu hộ (COD) = phần còn lại.
- **Cảnh báo khách hay hoàn/hủy đơn**: nhập SĐT khách từng hoàn hàng sẽ hiện cảnh báo (gợi ý thu cọc); nhãn "Từng hoàn N" trong danh sách đơn và khách.
- **Thao tác hàng loạt**: tick chọn nhiều đơn → đổi trạng thái, gửi GHN (đơn đã có địa chỉ GHN lưu sẵn hoặc nháp), in gộp nhãn GHN.
- **Báo cáo**: tổng đơn, số đơn theo trạng thái, doanh thu từ đơn đã giao, tiền còn phải thu; mục **Cần gọi khách** liệt kê đơn GHN giao thất bại.
- **Link tra cứu cho khách**: trong chi tiết đơn tạo link `/t/<mã>` gửi khách tự xem trạng thái, số tiền còn phải trả, mã vận đơn và địa chỉ giao hàng — không cần đăng nhập, chỉ ai có link xem được (kể cả người được khách chuyển tiếp link, nên link lộ thì bấm **Đổi link**), SĐT bị che bớt; đổi link thì link cũ hết hiệu lực.
- **Giao Hàng Nhanh (GHN)**: từ chi tiết đơn bấm **Tạo đơn GHN**, chọn lại địa chỉ theo danh mục của GHN (Tỉnh/Thành → Phường/Xã, hệ hành chính mới), xem phí trước khi gửi; trạng thái vận đơn tự cập nhật về đơn qua webhook hoặc nút **Đồng bộ GHN**; in nhãn, hủy vận đơn. Xem mục [Giao Hàng Nhanh](#giao-hàng-nhanh-ghn).
- Card trên điện thoại, bảng trên desktop; nút gọi `tel:` và mở Facebook; cài ra màn hình chính (PWA).

## Công nghệ

| Phần | Dùng |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4, component kiểu shadcn/ui (Radix), TanStack Query, React Hook Form + Zod |
| Backend | Node.js 22 + Express 5, `@googleapis/sheets` (service account) |
| Dùng chung | `shared/` — kiểu dữ liệu, schema Zod (validate cả 2 phía), hàm tính thống kê |

```
shared/      types.ts, schemas.ts, stats.ts, constants.ts, phone.ts
server/      index.ts (Express), routes.ts, service.ts (nghiệp vụ), auth.ts, config.ts
  repo/      sheets.ts (Google Sheets), memory.ts + demo-data.ts (chế độ demo)
  scripts/   init-sheets.ts, hash-password.ts
src/         pages/, components/, lib/ (api, queries, csv)
```

## Chạy thử nhanh (dữ liệu demo)

Cần Node.js ≥ 22.

```bash
npm install
cp .env.example .env      # để nguyên DATA_SOURCE=demo
npm run dev
```

Mở http://localhost:5173, đăng nhập **demo / demo**. Dữ liệu demo nằm trong bộ nhớ server, mất khi tắt, **không bao giờ chạm vào Google Sheets**. Ở production, server từ chối chạy chế độ demo trừ khi đặt `ALLOW_DEMO_IN_PRODUCTION=true`.

Thử trên điện thoại cùng mạng Wi-Fi: `npm run dev:web -- --host` rồi mở `http://<IP-máy-tính>:5173`.

## Cấu hình Google Sheets

### 1. Tạo service account

1. Vào https://console.cloud.google.com → tạo project mới (hoặc chọn project có sẵn).
2. **APIs & Services → Library** → tìm **Google Sheets API** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → Service account**. Đặt tên (ví dụ `don-hang-mini`), **không** cần cấp role nào cho project.
4. Mở service account vừa tạo → tab **Keys → Add key → Create new key → JSON**. File JSON tải về là bí mật: lưu vào `secrets/service-account.json` (đã có trong `.gitignore`), không gửi qua chat, không commit.

### 2. Tạo spreadsheet và cấp quyền

1. Tạo Google Sheet mới trong tài khoản của bạn. **Giữ chế độ chia sẻ “Restricted”** — không bật “Anyone with the link”.
2. Bấm **Share**, thêm email service account (dạng `ten@project.iam.gserviceaccount.com`, có trong file JSON) với quyền **Editor**. Đây là quyền duy nhất service account cần: nó chỉ truy cập được đúng file này.
3. Lấy ID từ URL: `https://docs.google.com/spreadsheets/d/<ID>/edit`.

### 3. Điền `.env` và tạo các sheet

```bash
DATA_SOURCE=sheets
GOOGLE_SHEETS_SPREADSHEET_ID=<ID>
GOOGLE_APPLICATION_CREDENTIALS=./secrets/service-account.json
SESSION_SECRET=<chuỗi ngẫu nhiên ≥32 ký tự: openssl rand -base64 48>
APP_USERS=<xem mục Tài khoản đăng nhập>
```

```bash
npm run init-sheets
```

Lệnh này tạo 4 sheet `Customers`, `OrderGroups`, `Orders`, `OrderItems` cùng dòng tiêu đề. Chạy lại an toàn: chỉ thêm sheet/cột còn thiếu, không xóa dữ liệu.

### Cấu trúc dữ liệu

| Sheet | Cột |
|---|---|
| `Customers` | id, name, phone, facebook_url, address, ghn_address, created_at, updated_at |
| `OrderGroups` | id, name, description, product_name, default_unit_price, status (`open`/`closed`), created_at, updated_at |
| `Orders` | id, order_code, group_id, customer_id, items_summary, total_amount, status, note, ghn_order_code, ghn_client_code, ghn_status, ghn_status_at, ghn_fee, ghn_cod_amount, ghn_expected_delivery, ghn_to_address, ghn_draft, paid_amount, public_token, created_at, updated_at |
| `GroupCosts` | id, group_id, category (`material`/`labor`/`other`), name, quantity, unit, unit_price, basis (`fixed`/`per_item`), note, created_at, updated_at |
| `OrderItems` | id, order_id, product_name, size, quantity, unit_price, line_total, created_at |

- Một nhóm có nhiều đơn; một khách có nhiều đơn (kể cả ở nhiều nhóm); một đơn có một hoặc nhiều dòng `OrderItems` (mỗi dòng một size).
- ID là UUID, không dùng số thứ tự dòng. Tiền là số nguyên VND. Thời gian là ISO 8601 (UTC), hiển thị theo giờ Việt Nam.
- `status` của đơn: `pending, confirmed, packing, shipping, delivered, cancelled, returned`.
- `items_summary` (ví dụ `M x2, L x1`) chỉ để đọc nhanh trên Sheets; thống kê luôn tính từ `OrderItems`.
- Cột được nhận theo **tên ở dòng tiêu đề**, nên có thể đổi thứ tự cột hoặc thêm cột riêng của bạn: app giữ nguyên các cột lạ khi ghi.
- Nên **xem** trên Sheets nhưng **sửa** qua app. Nếu sửa tay, đừng đổi cột `id`, và nhớ app cache dữ liệu đọc `SHEETS_CACHE_MS` (mặc định 15 giây).

### Nâng cấp khi đã có dữ liệu thật

Bản mới cần 2 cột mới trong sheet `Orders` (`paid_amount`, `public_token`) và sheet mới `GroupCosts` (chi phí nhóm). Cách nâng cấp an toàn:

1. Chạy `npm run init-sheets` trỏ vào spreadsheet thật (cùng `.env` production). Lệnh chỉ **tạo sheet còn thiếu và thêm cột vào cuối dòng tiêu đề**, không sửa/xóa dữ liệu; bản đang chạy vẫn hoạt động bình thường với cột/sheet mới.
2. Deploy bản mới.

Làm ngược thứ tự cũng không sập app: thiếu 2 cột thì app đọc như "chưa cọc, chưa có link", thiếu sheet `GroupCosts` thì coi như chưa nhập chi phí; chỉ khi lưu tiền cọc, tạo link hoặc thêm khoản chi mới báo "Chạy npm run init-sheets" (chạy xong dùng được ngay, không cần khởi động lại). Đơn cũ được coi là chưa cọc (COD = tổng đơn như trước).

### Chống ghi đè / ghi trùng

- Mọi thao tác ghi trên server chạy tuần tự và luôn đọc dữ liệu mới nhất ngay trước khi ghi. Nhờ vậy mã đơn không trùng, và vị trí dòng được tìm lại theo `id`.
- Khi sửa, client gửi kèm `updated_at` đã đọc. Nếu người khác đã sửa trước đó, server trả **409** và yêu cầu tải lại, không ghi đè.
- Khi sửa đơn, các dòng size cũ được thay hoàn toàn, nên số lượng không bao giờ bị cộng dồn.
- Ghi bằng `valueInputOption=RAW`: chuỗi bắt đầu bằng `=` không thành công thức, và SĐT giữ được số 0 đầu.

Giới hạn: khóa ghi nằm trong bộ nhớ một tiến trình, nên **chỉ chạy 1 instance server**. Toàn bộ dữ liệu được đọc vào bộ nhớ, phù hợp tới khoảng vài chục nghìn đơn.

## Giao Hàng Nhanh (GHN)

Tích hợp theo tài liệu https://developer.ghn.vn, dùng **địa chỉ hệ mới 2 cấp** (Tỉnh/Thành + Phường/Xã, sau 01/07/2025). Token GHN chỉ nằm ở server.

### Thiết lập

Cách dễ nhất: trong app vào **Thiết lập GHN** (thanh bên trái trên máy tính, nút ⚙ ở trang Đơn hàng trên điện thoại). Bấm "Tạo đơn GHN" khi chưa thiết lập cũng sẽ hiện form này.

1. Tạo tài khoản GHN: thử nghiệm ở https://5sao.ghn.dev (staging, đơn không giao thật), thật ở https://khachhang.ghn.vn.
2. Trang Developer của GHN → **Quản lý token** → sao chép token. Token staging và production khác nhau.
3. Dán token, chọn môi trường, bấm **Kiểm tra token & lấy cửa hàng** rồi chọn cửa hàng. App tự lấy đúng mã cửa hàng, không cần tự tìm ShopId.
4. Nếu cửa hàng trên GHN chưa có địa chỉ lấy hàng (lỗi `FROM_ADDRESS_CONVERT_FAIL`), tích **Nhập địa chỉ lấy hàng tại đây**.
5. Tùy chọn: giá trị mặc định (khối lượng, kích thước, ai trả phí ship) và webhook (xem bên dưới). Bấm **Lưu thiết lập**: có hiệu lực ngay, không cần khởi động lại.

Thiết lập được lưu ở `secrets/ghn-settings.json` trên server (quyền 600, đã có trong `.gitignore`; đổi đường dẫn bằng `GHN_SETTINGS_FILE`). File này được ưu tiên hơn các biến `GHN_*` trong `.env`. Vẫn có thể cấu hình hoàn toàn bằng `.env` (xem `.env.example`), tiện khi deploy lên nền tảng không ghi được file.

**Đã có dữ liệu trên Sheets từ trước?** Chạy lại `npm run init-sheets` để thêm các cột `ghn_*` (gồm `ghn_draft`), không mất dữ liệu.

Ở chế độ demo mà chưa thiết lập, app dùng **GHN giả lập** (vài tỉnh/phường mẫu, mỗi lần bấm Cập nhật vận đơn tiến thêm một trạng thái) để thử giao diện.

### Luồng sử dụng

- Bấm **Tạo đơn GHN** ngay trên danh sách đơn (đơn Chờ xác nhận / Đã xác nhận / Đang đóng gói) hoặc trong chi tiết đơn. Đầu form hiện **địa chỉ khách đã nhập lúc tạo đơn** (kèm ghi chú đơn) để đối chiếu, có nút chép sang ô số nhà/đường.
- **Lưu nháp**: lưu thông tin đang nhập vào đơn (cột `ghn_draft`), chưa gửi GHN. Mở lại đơn, kể cả từ máy khác, sẽ tiếp tục từ bản nháp; danh sách đơn hiện nút **Tiếp tục nháp GHN**. Tạo vận đơn xong thì nháp tự xóa. Rời trang khi còn thay đổi chưa lưu sẽ được hỏi lại.
- **Form tạo đơn GHN**: điền sẵn tên, SĐT, COD = tổng đơn, khối lượng = số sản phẩm × `GHN_DEFAULT_ITEM_WEIGHT`. Chọn Tỉnh/Thành và Phường/Xã từ danh mục GHN (gõ không dấu để tìm). Công tắc **Địa chỉ mới** giống trên GHN: bật = địa chỉ sau sáp nhập 01/07/2025 (Tỉnh/Thành → Phường/Xã), tắt = địa chỉ cũ (Tỉnh/Thành → Quận/Huyện → Phường/Xã), tiện khi khách vẫn ghi địa chỉ kiểu cũ; GHN tự chuyển đổi. Chế độ đã dùng được nhớ cùng địa chỉ của khách và trong nháp. Khách chưa từng gửi GHN thì app thử đoán tỉnh/phường từ địa chỉ cũ — **kiểm tra lại trước khi gửi**. Bấm **Tính phí** để xem phí và ngày giao dự kiến, rồi **Tạo đơn GHN**.
- Địa chỉ đã chọn được lưu vào khách (cột `ghn_address`) để lần sau tự điền.
- Mã đơn của app được gửi làm `client_order_code`, nên bấm gửi lại sau lỗi mạng không tạo vận đơn trùng. Tạo lại sau khi hủy dùng `DH…-R2`, `-R3`.
- Sửa đơn trong app **không** cập nhật sang GHN; nếu đổi sản phẩm/COD sau khi đã gửi, hủy vận đơn và tạo lại (hoặc sửa trên trang GHN).

### Cập nhật trạng thái

Trạng thái GHN được đổi sang trạng thái đơn của app:

| GHN | Đơn trong app |
|---|---|
| Chờ lấy / đang lấy hàng | Đang đóng gói |
| Đã lấy, trong kho, đang giao, giao thất bại | Đang giao |
| Giao thành công | Đã giao |
| Chờ trả / đang trả / đã trả hàng | Hoàn hàng |
| Vận đơn bị hủy | Về “Đã xác nhận” (nếu đang “Đang đóng gói”) |
| Sự cố, thất lạc, hư hỏng | Giữ nguyên, chỉ hiện trạng thái GHN |

Hai cách nhận trạng thái:

- **Webhook (tự động)**: cần server có HTTPS truy cập được từ Internet. Ở **Thiết lập GHN → Webhook**, bấm tạo mã bí mật rồi lưu; app hiện sẵn URL, tên header và giá trị để sao chép. Trên Developer Portal của GHN → **Cấu hình webhook** → tab Order: URL `https://<tên-miền>/api/ghn/webhook`, thêm **Header tùy chỉnh** `X-Webhook-Secret` = mã bí mật. Staging và production cấu hình riêng; đổi cấu hình mất ~15 phút mới có hiệu lực. Callback đến trễ hoặc gửi lặp được bỏ qua theo thời gian `Time`.
- **Đồng bộ thủ công**: nút **Đồng bộ GHN** ở trang Đơn hàng (mọi vận đơn chưa kết thúc) hoặc **Cập nhật** trong chi tiết đơn. Dùng khi chạy ở máy cá nhân, không nhận được webhook.

Hủy vận đơn chỉ được khi GHN chưa lấy hàng. In nhãn mở trang in A5 của GHN (link hết hạn sau ~30 phút).

## Tài khoản đăng nhập

Mọi API (trừ đăng nhập và webhook GHN — xác thực bằng `X-Webhook-Secret`) đều yêu cầu đăng nhập. Tài khoản khai báo trong `.env`, mật khẩu chỉ lưu dạng băm scrypt:

```bash
npm run hash-password -- 'mat-khau-cua-ban'
# → scrypt$...$...
```

```bash
APP_USERS=chu_shop:scrypt$...$...,nhan_vien:scrypt$...$...
```

Mọi tài khoản có quyền như nhau (MVP chưa phân quyền). Xóa một tài khoản khỏi `APP_USERS` rồi khởi động lại server thì phiên của tài khoản đó hết hiệu lực. Đổi `SESSION_SECRET` sẽ đăng xuất tất cả mọi người.

Bảo mật đã có: cookie phiên `HttpOnly` + `SameSite=Strict` (+ `Secure` ở production), ký HMAC; chặn CSRF bằng header riêng; giới hạn 10 lần đăng nhập sai / 15 phút / IP; validate bằng Zod ở server; log không chứa body, SĐT hay địa chỉ.

## Build và triển khai

```bash
npm run build      # typecheck + build frontend (dist/) + backend (dist-server/)
NODE_ENV=production npm start
```

Một tiến trình Node phục vụ cả API (`/api`) lẫn giao diện, ở cổng `PORT` (mặc định 8787). Có thể chạy trên VPS, Render, Railway, Fly.io…:

- Bắt buộc **HTTPS** (PWA và cookie `Secure` cần HTTPS). Nếu phải chạy HTTP trong mạng nội bộ, đặt `COOKIE_SECURE=false`.
- Trên nền tảng không upload được file, dùng `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` (dán private key, giữ `\n`) thay cho `GOOGLE_APPLICATION_CREDENTIALS`, và khai báo chúng là secret của nền tảng.
- Chỉ chạy **1 instance** (xem phần chống ghi đè).
- Sau reverse proxy (nginx…), server đã bật `trust proxy` cho 1 lớp proxy.

### Deploy lên Vercel

Repo đã có sẵn `vercel.json` + `npm run vercel-build` (Build Output API): giao diện là file tĩnh, toàn bộ `/api/*` chạy trong một serverless function (Express gói thành 1 file). Không cần chỉnh gì trong màn hình Build của Vercel: Framework Preset để **Other**, giữ build command mặc định từ `vercel.json`.

Khai báo biến môi trường ở **Vercel → Project → Settings → Environment Variables** (rồi **Redeploy**). Vercel không có file `.env` hay thư mục `secrets/`:

| Biến | Giá trị |
|---|---|
| `DATA_SOURCE` | `sheets` |
| `SESSION_SECRET` | chuỗi ngẫu nhiên ≥ 32 ký tự (`openssl rand -base64 48`) |
| `APP_USERS` | như trong `.env` (`ten:scrypt$...`) |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | ID spreadsheet |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | trường `client_email` trong file JSON service account |
| `GOOGLE_PRIVATE_KEY` | trường `private_key` (dán nguyên, giữ các `\n`) |
| `GHN_TOKEN`, `GHN_SHOP_ID`, `GHN_ENV`, `GHN_WEBHOOK_SECRET`… | nếu dùng GHN (xem `.env.example`) |

Thiếu/sai biến nào, màn hình đăng nhập sẽ báo "Cấu hình server trên Vercel chưa đúng: …". Trên Vercel, màn **Thiết lập GHN** chỉ để xem (serverless không lưu được file) — cấu hình GHN bằng biến môi trường. Webhook GHN: `https://<tên-miền-vercel>/api/ghn/webhook`.

Giới hạn: Vercel có thể chạy nhiều bản function cùng lúc, nên khóa ghi trong bộ nhớ không còn tuyệt đối — với vài người dùng đồng thời thì ổn; nếu nhiều người cùng tạo đơn liên tục, nên chạy 1 máy chủ Node (VPS/Render/Railway) như hướng dẫn ở trên.

Cài app ra màn hình chính: Android Chrome → menu ⋮ → **Thêm vào màn hình chính**; iPhone Safari → **Chia sẻ → Thêm vào MH chính**.

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy API (8787, tự reload) + Vite (5173) |
| `npm test` | Unit test thống kê và nghiệp vụ |
| `npm run typecheck` | Kiểm tra TypeScript |
| `npm run build` / `npm start` | Build và chạy production |
| `npm run init-sheets` | Tạo/bổ sung sheet và cột |
| `npm run hash-password -- <mk>` | Tạo mã băm mật khẩu |

## Cấu hình size

`SIZES=S,M,L,XL` quyết định các nút size trên form và thứ tự trong bảng thống kê. Khi tạo đơn vẫn nhập được size khác (bấm **Khác…**, ví dụ `XXL`, `FREESIZE`); size lạ được xếp sau các size cấu hình.
