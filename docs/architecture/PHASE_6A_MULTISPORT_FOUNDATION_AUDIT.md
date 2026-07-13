# Giai đoạn 6A - Audit và hợp đồng ruleset đa môn

## Hiện trạng

- Schema đã có `sports` và `events.sport_id` nhưng production chỉ có Pickleball.
- UI tạo/sửa nội dung hard-code duy nhất `sport_pickleball`.
- Engine hiện hỗ trợ trận tính điểm theo séc: một séc hoặc best-of-3.
- Luật từng vòng, nhập điểm, xếp hạng, knockout và TV đã dùng event config.
- Engine chưa hỗ trợ đúng các môn tính giờ, tỷ số hòa hoặc best-of-5.

## Quyết định phạm vi

Giai đoạn 6 hỗ trợ production cho ba môn dùng chung `set_points_v1`:

- Pickleball
- Cầu lông
- Bóng bàn với thể thức một séc hoặc best-of-3

Không bật Bóng đá, chạy tính giờ hoặc best-of-5 trong phiên bản này. Hiển thị
một lựa chọn chưa có engine thật sẽ tạo dữ liệu sai và không đạt tiêu chuẩn E2E.

## Hợp đồng

Mỗi sport có:

- `ruleset_version`
- `capabilities`
- `default_settings`
- `default_ranking_config`

Mỗi event lưu `sport_ruleset_version`. Trigger database kiểm tra môn, loại nội
dung, scoring mode, luật từng vòng và khả năng hòa trước mọi insert/update.

## Tương thích

Toàn bộ event hiện tại giữ `sport_pickleball`, cấu hình và kết quả cũ. Migration
không cập nhật score, match, standings, bracket hoặc `auth.users`.
