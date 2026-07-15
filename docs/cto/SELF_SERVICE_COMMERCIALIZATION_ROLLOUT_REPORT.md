# Báo cáo rollout thương mại hóa self-service

Ngày kiểm tra: 15/07/2026  
Production: `https://picvn.vercel.app`

## 1. Trạng thái triển khai

Các PR COM01-COM07 và migration 050-057 đã được triển khai. Hệ thống hiện có:

- Google onboarding idempotent và tenant riêng cho từng khách hàng;
- gói 3/7/30/60 ngày, quota giải/nội dung/trọng tài;
- đơn kích hoạt, gia hạn và mua thêm quota;
- payOS webhook có kiểm tra chữ ký, event ledger và settlement idempotent;
- manual review chỉ là fallback, SUPER_ADMIN mới được xác nhận;
- khóa nghiệp vụ khi hết hạn, không xóa dữ liệu giải;
- màn mở khóa và màn quản lý gói trên desktop/mobile.

COM07 đã PASS database E2E và Vercel Preview E2E: quota tăng đúng một lần,
gia hạn không mất ngày còn lại, reload giữ trạng thái, không có request lỗi.

## 2. Security gate trước khi mở bán

Đăng ký khách hàng mới chỉ được mở khi đồng thời đạt đủ năm điều kiện:

1. Supabase Google provider đã bật;
2. payOS có đủ Client ID, API Key và Checksum Key phía server;
3. `PUBLIC_APP_URL=https://picvn.vercel.app`;
4. `SELF_SERVICE_SIGNUP_ENABLED=true` phía server;
5. `VITE_SELF_SERVICE_ENABLED=true` phía frontend.

API `GET /api/commercial/readiness` chỉ cho SUPER_ADMIN và chỉ trả boolean,
không trả secret. API bootstrap từ chối tạo tenant mới nếu cờ server tắt hoặc
payOS chưa sẵn sàng. Việc này không khóa khách hàng đã có subscription.

## 3. Cấu hình provider bắt buộc

### Google / Supabase Auth

- Tạo Google OAuth Client loại Web application.
- Authorized JavaScript origin: `https://picvn.vercel.app`.
- Authorized redirect URI của Google:
  `https://ykckqcykxfhpfqptckxk.supabase.co/auth/v1/callback`.
- Bật Google provider trong Supabase Auth bằng Client ID/Client Secret.
- Supabase Site URL: `https://picvn.vercel.app`.
- Redirect allow list tối thiểu: `https://picvn.vercel.app/**`.

Theo tài liệu Supabase, Google Client Secret chỉ cấu hình trong Google/Supabase,
không đưa vào Vercel frontend hoặc repo:
<https://supabase.com/docs/guides/auth/social-login/auth-google>.

### payOS / Vercel

Tạo kênh thanh toán payOS, liên kết tài khoản ngân hàng và đặt webhook:

`https://picvn.vercel.app/api/webhooks/payos`

Biến Vercel Production, chỉ phía server:

- `PAYOS_ENABLED=true`
- `PAYOS_CLIENT_ID`
- `PAYOS_API_KEY`
- `PAYOS_CHECKSUM_KEY`
- `PUBLIC_APP_URL=https://picvn.vercel.app`
- `SELF_SERVICE_SIGNUP_ENABLED=true`

Biến build frontend:

- `VITE_SELF_SERVICE_ENABLED=true`

Không được tạo biến `VITE_PAYOS_*` hoặc đưa checksum/service-role vào frontend.
Hướng dẫn kênh và webhook payOS:
<https://payos.vn/docs/huong-dan-su-dung/tao-kenh-thanh-toan/>.

## 4. Thứ tự rollout

1. Tạo Google Client và cấu hình provider/redirect trong Supabase.
2. Tạo kênh payOS, cấu hình webhook và thêm khóa server vào Vercel.
3. Giữ hai cờ signup là `false`, deploy và kiểm tra hệ thống cũ.
4. Bật `SELF_SERVICE_SIGNUP_ENABLED=true` và
   `VITE_SELF_SERVICE_ENABLED=true`, redeploy production.
5. SUPER_ADMIN gọi readiness; chỉ tiếp tục khi `ready=true`.
6. Dùng một Google user test mới, xác nhận chỉ thấy màn Mở khóa.
7. Tạo đơn giá trị nhỏ, thanh toán thật, xác nhận webhook tự mở khóa.
8. Gửi lại cùng webhook/test idempotency, quota không tăng lần hai.
9. Kiểm tra manual review không tự mở khóa; SUPER_ADMIN confirm một order test
   khác và xác nhận webhook đến sau không settlement lần hai.
10. Xóa/archive tenant test theo policy, không xóa ledger thanh toán/audit đã xác nhận.

## 5. Rollback

- Tắt ngay `VITE_SELF_SERVICE_ENABLED` và `SELF_SERVICE_SIGNUP_ENABLED`, rồi
  redeploy để dừng đăng ký mới.
- Không tắt webhook payOS khi còn order đang chờ; tiếp tục nhận settlement cho
  giao dịch khách đã chuyển tiền.
- Không xóa order, invoice, webhook ledger hoặc audit đã xác nhận.
- Khách hàng đã thanh toán và tenant enterprise hiện tại không bị thay đổi.

## 6. Kết quả readiness hiện tại

- COM01-COM07 code/database/UI: **PASS**.
- Production regression SUPER_ADMIN sau COM07: **PASS**.
- Google provider: **CHƯA BẬT** tại thời điểm audit.
- payOS production keys: **CHƯA CẤU HÌNH** tại thời điểm audit.
- Self-service production flags: **CHƯA BẬT**.
- Giao dịch payOS thật: **BLOCKED bởi cấu hình provider bên ngoài**.

Vì chưa có Google Client Secret và bộ khóa payOS, chưa được ghi PASS COM08 hoặc
bật giao diện đăng ký khách hàng trên production.
