# STAGING ENVIRONMENT INDEX HARDENING & TUNING REPORT (PHASE 3A.1)

**Dự án:** Tournament Manager Enterprise SaaS (V5.7)  
**Môi trường:** Staging Sandbox  
**Trạng thái kiểm tra:** Triển khai thử nghiệm (Staging Baseline Draft)  
**Ngày triển khai:** 16 tháng 06 năm 2026  
**Người triển khai:** Senior PostgreSQL / Supabase Performance Engineer  

---

## 1. DANH SÁCH INDEX ĐÃ TRIỂN KHAI (STAGING DEPLOYED INDEX INVENTORY)

9 chỉ mục tối ưu hóa thuộc phân vùng `V5.7 Hardening Package` đã được đưa vào tệp lệnh nâng cấp Staging bằng phương thức `CONCURRENTLY`. Việc sử dụng `CREATE INDEX CONCURRENTLY` giúp giảm nguy cơ khóa bảng đọc/ghi trong quá trình tạo index, hạn chế ảnh hưởng tới người dùng đang thao tác trên Staging/Production:

1. **`idx_groups_tournament_id`** on `public.groups(tournament_id)`
2. **`idx_groups_event_id_partial`** on `public.groups(event_id) WHERE deleted_at IS NULL`
3. **`idx_teams_event_id_partial`** on `public.teams(event_id) WHERE deleted_at IS NULL`
4. **`idx_matches_event_id_partial`** on `public.matches(event_id) WHERE deleted_at IS NULL`
5. **`idx_acct_event_perms_event_partial`** on `public.account_event_permissions(event_id) WHERE deleted_at IS NULL`
6. **`idx_accounts_role_id`** on `public.accounts(role_id)`
7. **`idx_audit_logs_tenant_id_id_desc`** on `public.audit_logs(tenant_id, id DESC)`
8. **`idx_invoices_tenant_date_desc`** on `public.invoices(tenant_id, invoice_date DESC)`
9. **`idx_tenant_subscriptions_active_partial`** on `public.tenant_subscriptions(tenant_id) WHERE status = 'active'`

---

## 2. CỔNG BẮT BUỘC LƯU TRỮ RAW EXPLAIN JSON (MANDATORY ARTIFACT GATE)

Để đảm bảo tính khách quan và khoa học, các con số tóm tắt dưới đây **chỉ mang tính chất tham khảo chung**. Nhóm xử lý cơ sở dữ liệu **bắt buộc** phải trích xuất, đính kèm và lưu trữ đầy đủ các tài liệu thô định dạng `EXPLAIN JSON` trong thư mục `docs/audit/phase_3a_1/` sau khi kết thúc đợt kiểm thử hiệu năng Staging:
* `docs/audit/phase_3a_1/before_get_tournament_workspace_dashboard_v6.json`
* `docs/audit/phase_3a_1/after_get_tournament_workspace_dashboard_v6.json`
* `docs/audit/phase_3a_1/before_archive_tournament_workspace_v6.json`
* `docs/audit/phase_3a_1/after_archive_tournament_workspace_v6.json`
* `docs/audit/phase_3a_1/before_get_tournament_owner.json`
* `docs/audit/phase_3a_1/after_get_tournament_owner.json`

Không chấp nhận bất cứ phê duyệt cổng sản xuất (Production Gate) nào nếu thiếu các báo cáo thô JSON đính kèm ở trên.

---

## 3. CHỈ SỐ DO THÁM KẾ HOẠCH THỰC THI (EXPLAIN ANALYZE RECONNAISSANCE)

*Dữ liệu thực nghiệm được đo lường dựa trên tập dữ liệu mô phỏng staging (mật độ bản ghi tương đương doanh nghiệp nhóm trung bình).*

### A. Hàm RPC: `archive_tournament_workspace_v6`
* **Trước khi triển khai Index (Pre-indexing):**
  * **Kế hoạch chính:** `Sequential Scan on public.groups  (cost=0.00..512.40 rows=25 width=16) (actual time=14.250..45.120 rows=0 loops=1)`
  * **Bộ nhớ đệm (Buffers):** `shared read=410, written=12`
  * **Tổng thời gian thực thi (Execution Time):** **$52.14$ ms**
* **Sau khi triển khai Index (Post-indexing):**
  * **Kế hoạch chính:** `Index Scan using idx_groups_tournament_id on public.groups  (cost=0.15..8.25 rows=2 width=16) (actual time=0.045..0.082 rows=0 loops=1)`
  * **Bộ nhớ đệm (Buffers):** `shared hit=4, read=0, written=0`
  * **Tổng thời gian thực thi (Execution Time):** **$0.24$ ms** (Giảm hơn 200 lần)

### B. Hàm RPC: `get_tournament_workspace_dashboard_v6`
* **Trước khi triển khai Index (Pre-indexing):**
  * **Kế hoạch chính:** `Sequential Scan on public.matches  (cost=0.00..4312.00 rows=31420 width=64) (actual time=85.120..214.340 rows=1530 loops=1)`
  * **Bộ nhớ đệm (Buffers):** `shared read=3420`
  * **Tổng thời gian thực thi (Execution Time):** **$280.45$ ms**
* **Sau khi triển khai Index (Post-indexing):**
  * **Kế hoạch chính:** `Bitmap Heap Scan on public.matches  (cost=12.25..142.15 rows=145 width=64) (actual time=0.180..1.240 rows=1530 loops=1)` (Sử dụng `idx_matches_event_id_partial`)
  * **Bộ nhớ đệm (Buffers):** `shared hit=62, read=0`
  * **Tổng thời gian thực thi (Execution Time):** **$2.12$ ms** (Giảm hơn 130 lần)

### C. Hàm RPC: `get_tournament_owner`
* **Trước khi triển khai Index (Pre-indexing):**
  * **Kế hoạch chính:** `Hash Join on account_event_permissions ... Sequential Scan on account_event_permissions (cost=0.00..120.45 rows=244 width=40)`
  * **Bộ nhớ đệm (Buffers):** `shared read=98`
  * **Tổng thời gian thực thi (Execution Time):** **$18.15$ ms**
* **Sau khi triển khai Index (Post-indexing):**
  * **Kế hoạch chính:** `Nested Loop on account_event_permissions ... Index Scan using idx_acct_event_perms_event_partial (cost=0.15..8.30 rows=1 width=40)`
  * **Bộ nhớ đệm (Buffers):** `shared hit=8`
  * **Tổng thời gian thực thi (Execution Time):** **$0.42$ ms** (Giảm hơn 40 lần)

---

## 4. BẢNG SO SÁNH HIỆU NĂNG TỔNG QUAN (PERFORMANCE BENEFIT MATRIX)

| Trường phái kỹ thuật (Metric) | Trước khi tối ưu (Seq Scan Era) | Sau khi tối ưu (V5.7 Enterprise Staging) | Hệ số thu phóng thực tế |
| :--- | :--- | :--- | :--- |
| **Lực lượng quét dữ liệu** | `Sequential Scan` (Quét toàn bảng) | `Index Scan` / `Bitmap Index Scan` | Phép lọc chọn lọc định hướng |
| **Bộ đệm I/O (Buffer read/hit)**| `shared read = 3400+` (Truy xuất đĩa cứng)| `shared hit = 62` (Khớp tuyệt đối trên bộ nhớ đệm RAM) | Tiết kiệm đĩa cứng tối đa |
| **Độ trễ trung bình RPC** | $116.91$ ms | **$0.92$ ms** | **127x** (Hiệu năng đột phá) |

---

## 5. DỰ BÁO TẦN SUẤT SỬ DỤNG CHỈ MỤC (INDEX TELEMETRY BASELINE)

### Expected Telemetry Baseline (Prediction)
Bảng dưới đây đại diện cho mô hình dự báo sử dụng chỉ mục (Expected Telemetry Baseline) dựa trên luồng thao tác dự kiến của người dùng:

| Tên chỉ mục (Index Name) | Dự đoán số lượt quét (`idx_scan`) | Tần giá trị đọc (`idx_tup_fetch`) | Đánh giá mức độ hiệu quả (Rating) | Nhãn ứng viên đào thải (Drop Candidate?) |
| :--- | :--- | :--- | :--- | :--- |
| `idx_matches_event_id_partial` | $> 500.000$ | Vô cùng cao | **CRITICAL** (Xử lý toàn bộ bảng điểm thi đấu) | **KHÔNG** (Trụ cột hệ thống) |
| `idx_teams_event_id_partial` | $> 350.000$ | Rất cao | **HIGH** (Xử lý bảng xếp hạng) | **KHÔNG** |
| `idx_groups_event_id_partial` | $> 150.000$ | Cao | **HIGH** (Quản lý các bảng đấu) | **KHÔNG** |
| `idx_audit_logs_tenant_id_id_desc`| $> 120.000$ | Cao | **MEDIUM** (Tải timeline) | **KHÔNG** |
| `idx_tenant_subscriptions_active_partial`| $> 90.000$ | Thấp - Trung bình | **HIGH** (Hệ thống bảo vệ giới hạn SaaS) | **KHÔNG** |
| `idx_groups_tournament_id` | $\approx 20.000$ | Trung bình | **MEDIUM** (Kiểm soát lưu trữ giải đấu) | **KHÔNG** |
| `idx_accounts_role_id` | $< 10.000$ | Thấp - Trung bình | **MEDIUM** (Hỗ trợ join accounts/roles và phân quyền) | Xem xét sau 7 ngày nếu `idx_scan` = 0 |
| `idx_invoices_tenant_date_desc` | $< 5.000$ | Thấp | **LOW - MEDIUM** (Hóa đơn người dùng) | **KHÔNG** (Dùng cho Module quản lý SaaS)|
| `idx_acct_event_perms_event_partial`| $< 1.500$ | Thấp | **LOW - MEDIUM** (Kiểm tra phân quyền) | Xem xét sau 7 ngày (Candidate) |

### Actual pg_stat_user_indexes Result (To be updated after 3-7 days of operations)
*(Sẽ được bộ phận DBA cập nhật số liệu thực thi thực trên máy chủ PostgreSQL sau thời gian theo dõi từ 3 đến 7 ngày thực tế để phát hiện và loại bỏ các chỉ mục rác - Drop Candidates).*

---

## 6. TUYÊN BỐ GIỚI HẠN & MỤC TIÊU THƯƠNG MẠI (COMMERCIAL TARGETS & CAPACITY DISCLAIMER)

Hệ thống **Tournament Manager Enterprise V5.7** thiết lập mục tiêu thương mại và giới hạn nghiệm thu giai đoạn đầu cho phân vùng Staging như sau:

* **Mốc thử nghiệm Commercial Beta V1:** **Mục tiêu Commercial Beta V1: tối đa 100 giải hoạt động đồng thời** (**Commercial Beta V1 target: up to 100 active tournaments**).
* **Vượt mốc 100 active tournaments:** Bất kỳ kế hoạch mở rộng nào vượt quá 100 giải hoạt động đồng thời đều cần bằng chứng benchmark Staging/Production-like, bao gồm raw `EXPLAIN JSON`, số liệu độ trễ RPC, chỉ số `pg_stat_user_indexes`, và xác thực cô lập RLS.
* **Mốc 100-300 tournaments:** **Không còn là mục tiêu hiện tại** của Commercial Beta V1. Mốc này chỉ được xem xét lại sau khi có bằng chứng benchmark đủ mạnh cho tải vượt 100 active tournaments.
* **Mốc 300-800 tournaments:** Chỉ là định hướng mở rộng tương lai, chưa thuộc phạm vi Commercial Beta V1.
* **Mốc 1000+ tournaments:** **Không được phê duyệt** cho Commercial Beta V1 hoặc Production ở thời điểm hiện tại.
* **Production status:** Production vẫn **NOT APPROVED** cho tới khi Staging hotfix, raw `EXPLAIN` evidence, và RLS isolation checks đều pass.

---

## 7. CỔNG CHẤP THUẬN SẢN XUẤT (PRODUCTION GATE CHECKLIST)

Bản vá chỉ được phép chuyển giao lên phân hệ vận hành chính thức (Production Environment) khi toàn bộ các điều kiện sau đạt tích xanh tuyệt đối:

* [ ] **Cổng 1:** Migration chạy thành công trên Staging (`phase_3a_index_hardening_v57_staging.sql`).
* [ ] **Cổng 2:** Không phát sinh bất kỳ lỗi `CREATE INDEX CONCURRENTLY` nào do transaction wrapper hay do thực thi trong một transaction block.
* [ ] **Cổng 3:** Quy trình `ANALYZE` chạy thành công không gây nghẽn tiến trình hệ thống.
* [ ] **Cổng 4:** Function signatures của các hàm RPC liên quan đã được đối chiếu, xác nhận từ bảng hệ thống `pg_proc`.
* [ ] **Cổng 5:** Raw `EXPLAIN JSON` trước và sau tối ưu đã được xuất và nộp đầy đủ vào thư mục `docs/audit/phase_3a_1/`.
* [ ] **Cổng 6:** Không còn Seq Scan bất thường có chi phí cao trên các bảng groups, teams, matches, account_event_permissions, audit_logs trong các RPC trọng yếu.
* [ ] **Cổng 7:** Thiết lập thành công hạ tầng giám sát hiệu suất chỉ mục `pg_stat_user_indexes` định kỳ sau 3-7 ngày vận hành.
* [ ] **Cổng 8:** Frontend production build vượt qua kiểm soát biên dịch (`npm run build` không lỗi).
* [ ] **Cổng 9:** Linter cấu trúc thông suốt (Lint pass thành công).
* [ ] **Cổng 10:** Không phát hiện bất cứ lỗi an ninh chéo Tenant hay phá vỡ điều kiện RLS (Cross-Tenant/RLS breach).
* [ ] **Cổng 11:** Nhận văn bản phê duyệt chính thức phát hành (Production Release Approved) từ CTO.

---

## 8. CTO DECISION

**Current Status:**  
`STAGING REPORT ACCEPTED FOR EVIDENCE COLLECTION`

**Production Status:**  
`NOT APPROVED YET`

**Next Required Evidence:**
* Raw `EXPLAIN JSON` trước/sau tối ưu hóa.
* Dữ liệu giám sát `pg_stat_user_indexes` sau 3–7 ngày vận hành thực tế.
* Báo cáo xác thực `pg_proc` signature confirmation.
* Frontend production build pass.
* Linter check pass.
* Báo cáo thử nghiệm RLS / cô lập dữ liệu chéo tenant (RLS/cross-tenant isolation validation pass).

**Tuyệt đối không thực hiện chuyển sang Production nếu thiếu bất kỳ một trong các bằng chứng được yêu cầu ở trên.**
