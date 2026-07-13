# Báo cáo hoàn thành Giai đoạn 6 - Mở rộng đa môn thể thao

## Kết luận

Hệ thống đã chuyển từ giao diện hard-code Pickleball sang catalog môn và ruleset có phiên bản. Ba môn dùng máy tính điểm theo séc hiện được hỗ trợ thực tế:

| Môn | Mode | Điểm mặc định | Cap | Engine |
| --- | --- | ---: | ---: | --- |
| Pickleball | 1 séc / best-of-3 | Theo cấu hình giải, mặc định 15 | 17 | `set_points_v1` |
| Cầu lông | 1 séc / best-of-3 | 21 | 30 | `set_points_v1` |
| Bóng bàn | 1 séc / best-of-3 | 11 | 21 | `set_points_v1` |

Không công bố hỗ trợ bóng đá, môn tính giờ, kết quả hòa hoặc best-of-5 vì engine hiện tại chưa thực thi đầy đủ các luật đó.

## Hợp đồng kiến trúc

- `sports` lưu capabilities, scoring defaults, ranking defaults và `ruleset_version`.
- `events.sport_ruleset_version` ghi phiên bản luật gắn với nội dung.
- Trigger database xác thực sport, competition type, set mode, giới hạn điểm và round rules.
- Frontend chỉ chọn trong capabilities do backend công bố; backend vẫn là nơi quyết định hợp lệ cuối cùng.
- Không cho đổi môn khi nội dung đã có điểm hoặc trận đang diễn ra.
- Team, group, schedule, score, ranking, knockout và TV tiếp tục dùng hợp đồng event-scoped, không tự quyết định tenant.

## Migration

- `047_multisport_ruleset_contract.sql`: catalog/ruleset và validation trigger.
- `048_public_sport_catalog.sql`: public read-only catalog cho TV; không mở quyền ghi.
- `049_lock_sport_after_scoring.sql`: khóa đổi môn sau khi có lịch sử thi đấu.

Ba migration đã apply và verify trên Supabase production.

## Kiểm thử thực tế

| Luồng | Kết quả |
| --- | --- |
| Catalog anon/authenticated | PASS, HTTP 200, đủ 3 môn |
| Modal tạo nội dung | PASS, lựa chọn động theo catalog |
| Cầu lông defaults | PASS, best-of-3, 21/30 |
| Bóng bàn defaults | PASS, best-of-3, 11/21 |
| Cầu lông: đội → bảng → lịch → điểm → KO | PASS |
| Cầu lông: winner propagation tới chung kết | PASS |
| Bóng bàn: lịch → 3 séc → finalize | PASS |
| Đổi sport sau khi có điểm | PASS, bị chặn `SPORT_CHANGE_LOCKED` |
| Public snapshot chứa `sport_id` | PASS |
| Dữ liệu E2E rollback | PASS, không còn event test |
| Vercel Preview public/admin | PASS |

Các E2E database chạy trong transaction và `ROLLBACK`, không sửa dữ liệu giải thật.

## Giới hạn có chủ đích

- Engine hiện chỉ hỗ trợ mô hình điểm theo séc với 1 séc hoặc best-of-3.
- Muốn thêm bóng đá, môn tính giờ, hiệp, hòa hoặc best-of-5 phải tạo scoring engine/capability mới và PR riêng.
- Không dùng tên môn ở frontend để suy đoán luật; mọi mở rộng phải đi qua sport catalog và backend validator.

## Rollback

1. Revert UI về commit trước Phase 6B nếu catalog gây lỗi hiển thị.
2. Revoke `anon EXECUTE` trên `list_active_sports_v1` nếu cần tạm tắt catalog public.
3. Có thể drop riêng `trg_events_lock_scored_sport_v1` để quay lại policy đổi sport cũ; không cần sửa dữ liệu giải.
4. Không xóa các cột ruleset khi rollback nóng vì event production đã ghi `sport_ruleset_version`.
