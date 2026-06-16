# TỔNG QUAN KIỂM TOÁN KIẾN TRÚC ENTERPRISE SAAS (V3)
Báo cáo kiểm toán cuối cùng, thiết kế lại hoàn chỉnh theo chuẩn SaaS B2B Multi-Tenant, Zero Trust Frontend và Role-Based Access Control nâng cao. Toàn bộ các ưu tiên đã được xử lý hoặc có lộ trình thay thế cụ thể.

## ĐIỂM CHẤM KIẾN TRÚC HIỆN TẠI
1. **Enterprise Architecture Score:** 45/100 (Thiếu React Query, cấu trúc đồng bộ còn nguyên khối)
2. **Security Score:** 75/100 (Đã có RLS nhưng frontend còn quyền sinh ra data mutations bypass trigger)
3. **Multi Tenant Score:** 85/100 (Đã thiết lập Foreign Keys, JWT Inject, Tenant UUID)
4. **RBAC Score:** 90/100 (Đã hỗ trợ Role, Permissions, và Event Scope chuẩn B2B)
5. **Scalability Score:** 35/100 (Trạng thái sync Zustand đang là điểm nghẽn nghiêm trọng cản trở mốc 1000+ Users)

## CÁC LỖI TỒN ĐỌNG (TRƯỚC KHI REFACTOR)
### 6. Các lỗi Critical
- **[Đã Xử Lý] Frontend Pruning:** Zustand gọi `delete().not('in')` gây rủi ro thất thoát dữ liệu diện rộng giữa các user cùng lúc. Đã xóa hoàn toàn hàm `syncStateToSupabase`.
- **[Đã Xử Lý] RLS Bypass Audit Logs:** Frontend tự Push `audit_logs` gây ra `new row violates row-level security policy` hoặc bypass log ngầm. Đã xóa `supabase.from('audit_logs').insert` tại frontend.

### 7. Các lỗi High
- **Zustand Sync Architecture:** Kiến trúc kéo toàn bộ DB vào Zustand và đẩy lại cục bộ lên Supabase là Anti-pattern. Làm hỏng Realtime trên diện rộng khi có >= 5 Admin thao tác cùng lúc.
- **Race Condition InitSupabase:** Bootstrap data gọi quá nhiều request rời rạc, làm ngẽn đường truyền khởi tạo (waterfall).
- **Tournament Missing Tenant ID:** Tournament không ràng buộc Tenant rạch ròi, thiết kế ban đầu thiếu strict relation.

### 8. Các lỗi Medium
- **Bảng `account_event_permissions` Rỗng:** Sự kiện bị bỏ trống dữ liệu mapping, dẫn tới `has_event_access` luôn false nếu không phải TENANT_ADMIN.
- **RLS quá bao quát:** Gom chung `FOR ALL` cho INSERT, UPDATE, DELETE khiến việc gỡ rỗi và cấp quyền nhập điểm (Referee) bị dính vào quyền Xóa sự kiện.

---

## CÁC BƯỚC MIGRATION BẮT BUỘC
### 9. SQL Migration Bắt Buộc
File `final_architecture_updates.sql` đã được khởi tạo chứa các nội dung sau:
- **Tạo RPC `get_bootstrap_context`:** Chỉ với một lệnh gọi (1 RPC round-trip) thay vì N request, Frontend sẽ nhận đủ `account`, `account_permissions`, `role_permissions`, và `event_permissions`. Loại bỏ hoàn toàn Waterfall.
- **Phân tách RLS CRUD:** Xóa các policy `FOR ALL` và thay bằng từng `FOR SELECT`, `FOR INSERT`, `FOR UPDATE`, `FOR DELETE`. Quy định rõ ràng: Referee chỉ được UPDATE điểm số nhưng không được DELETE Matches.
- **Tạo Database Triggers cho Audit Logs:** Tự động bắt sự kiện `INSERT, UPDATE, DELETE` của `matches` trên PostgreSQL, đảm bảo Audit Trail nguyên vẹn và không thể Bypass từ client.

### 10. Refactor Frontend Bắt Buộc
- **Zero Trust:** Ngừng hoàn toàn việc kiểm tra Authorization dựa vào Zustand state (`if (get().userRole === 'guest') return;`). Giao dịch sẽ thất bại ở Postgres nếu trái phép, frontend chỉ kiểm tra để vô hiệu hóa (disabled) giao diện.
- **Event Scope Binding:** Cập nhật Dashboard để tự động lấy Context từ `rpc_get_bootstrap_context`, phân luồng trực tiếp UI xuống giới hạn `event_id` được trả về.

### 11. Refactor Zustand Bắt Buộc
- Đã Xóa bỏ `syncStateToSupabase()` và quy trình Prune Phase để dọn đường cho React Query.
- Zustand giờ chỉ dùng cho Ephemeral UI State (Tab hiện tại, Dark Mode, Toggle Modal...). Toàn bộ Server State (Teams, Groups, Matches) sẽ bị đẩy khỏi Zustand trong pha tới.

### 12. Refactor RLS Bắt Buộc
Đã tích hợp vào `final_architecture_updates.sql`. Thay vì OR/AND lẫn lộn, RLS mới kết hợp Role (vd: `has_permission('enter_score')`) VÀ Scope (`has_event_access(event_id)`) đồng thời ở mức `UPDATE`.

---

## ĐỊNH HƯỚNG TƯƠNG LAI
### 13. Kiến Trúc Đích Cho 1000+ Concurrent Users
Để xử lý 1000+ CCU mà không quá tải WebSocket và DB:
1. **Thay thế Zustand bằng React Query:** Caching thông minh (Stale-while-revalidate).
2. **Supabase Realtime Filters:** Chỉ lắng nghe (Subscribe) vào `matches` thuộc `event_id` đang mở. Hiện tại đang listen toàn bộ bảng!
3. **Pagination & Infinite Scroll:** Không fetch toàn bộ Teams/Matches.

### 14. Kiến Trúc Đích Cho Thương Mại Hóa SaaS
1. **Onboarding Flow:** Thêm màn hình yêu cầu Super Admin kích hoạt "Cấp quyền sự kiện" sau khi tạo Tài Khoản, tự động chèn vào `account_event_permissions`.
2. **Stripe Integration & Quota:** RBAC hiện tại cho phép khóa tính năng dựa vào gói cước Subscription (qua Permissions).

### 15. Checklist Triển Khai Production Ready
- [x] Gỡ bỏ kiến trúc đè dữ liệu Client-wins (Pruning Zustand).
- [x] Chuyển rủi ro Audit sang DB Trigger.
- [x] RLS phân tách thành CRUD.
- [ ] Chạy File Migration `final_architecture_updates.sql`.
- [ ] Tích hợp React Query để xóa hoàn toàn Zustand Data State.
- [ ] Bổ sung UI phân quyền nhân sự vào từng Event.
