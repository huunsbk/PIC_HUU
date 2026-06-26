# Content PDF Requirements - UI Button Test Matrix

Date: 2026-06-26

| Menu | Button / Control | Account | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| Header | Đăng nhập / Đăng xuất | Admin | Auth state changes and profile is visible | Profile shows name, role, tournament | PASS |
| Tổng quan giải | Đơn Vị Chủ Trì (BTC) input | Admin | Locked to tenant opened by URL | Disabled/readOnly, value `CLB Thắng Oanh` | PASS |
| Quản lý giải đấu | Tạo giải đấu | Admin | Button renders in grouped tenant page | Visible; destructive/create action not executed | PASS render |
| Nội dung thi đấu | Tạo nội dung | Admin | Button renders | Visible | PASS render |
| Nội dung thi đấu | Copy link / Open dashboard / Grant access / Archive icons | Admin | Controls render per event row | Icon controls render per event row | PASS render |
| Chia bảng | Tạo bảng trống | Admin | Empty groups can be created manually | Implemented in RPC/UI; not re-run destructively on production | PASS implementation |
| Nhập điểm | Set save buttons | Admin / REFEREE | Save individual set, do not finalize automatically | Table and panel flow render; destructive score save not executed | PASS render |
| Nhập điểm | Chốt trận | Admin / REFEREE | Finalize via RPC | Button exists in score flow; destructive finalize not executed | PASS render |
| Sơ đồ Knockout | Gợi ý đội vào KO | Admin | Candidate list via RPC | Button visible | PASS render |
| Sơ đồ Knockout | Xác nhận đội KO | Admin | Confirm candidates via RPC | Button visible | PASS render |
| Sơ đồ Knockout | Tạo bracket RPC | Admin | Create bracket via RPC | Button visible | PASS render |
| Sơ đồ Knockout | Chỉnh sửa thủ công | Admin | Opens manual editor | Button visible | PASS render |
| Sơ đồ Knockout | Xóa sơ đồ | Admin | Dedicated clear action exists | `XÓA SƠ ĐỒ` visible; destructive confirm not executed | PASS render |

## Console / Network

- No blocking production console error observed during these UI checks.
- No destructive operation was confirmed during this matrix run.
