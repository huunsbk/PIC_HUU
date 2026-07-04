# Báo cáo rà soát luồng đăng nhập, phân quyền và các nghiệp vụ liên quan

Ngày lập: 2026-07-04

Dự án: PIC_HUU / Tournament Manager Enterprise

Phạm vi: phân tích nghiệp vụ và kiến trúc trước khi triển khai. Báo cáo này chưa phải báo cáo test production.

## 1. Kết luận điều hành

Luồng nghiệp vụ đăng nhập đã được chốt theo hướng đúng:

1. Đăng nhập.
2. Lấy hồ sơ tài khoản.
3. Lấy danh sách giải đấu/workspace được phân quyền.
4. Nếu URL hiện tại thuộc quyền truy cập thì tiếp tục.
5. Nếu URL hiện tại không thuộc quyền truy cập thì chuyển về màn "Giải đấu được phân quyền".
6. Ẩn toàn bộ menu nghiệp vụ khác cho đến khi người dùng chọn đúng giải được quyền.

Đây là hướng phù hợp với kiến trúc doanh nghiệp, nhưng hiện hệ thống chưa đồng bộ hoàn toàn theo trục này. Một số nghiệp vụ vẫn đang phụ thuộc vào:

- quyền tổng trong store frontend;
- selectedTab đang lưu cũ;
- context tenant/tournament/event có thể được set trước khi xác nhận quyền;
- client-side filter chỉ dùng để hiển thị, không đủ để bảo đảm đúng nghiệp vụ;
- một số menu dùng quyền chung nhưng thao tác thực tế lại cần quyền theo event.

Khuyến nghị: triển khai một lớp kiểm soát truy cập dùng chung, gồm:

- `Workspace Access Guard`: kiểm soát user có được vào workspace hiện tại không.
- `Permission Policy`: kiểm soát user có thấy menu/nút và được thao tác gì.
- `Backend RPC Enforcement`: backend vẫn là nơi chặn cuối cùng cho mọi thêm/sửa/xóa/cập nhật điểm.

## 2. Hiện trạng kiến trúc liên quan

### 2.1 Thành phần đã có

| Thành phần | Vai trò hiện tại |
|---|---|
| `get_current_profile` | Lấy thông tin tài khoản, role, permission, event được cấp. |
| `list_accessible_workspaces_v1` | Lấy danh sách giải/workspace tài khoản được quyền truy cập. |
| `/admin/workspaces` | Màn danh sách giải đấu được quyền truy cập. |
| `/admin/workspace/:slug` | Màn vận hành một workspace cụ thể. |
| `account_event_permissions` | Lưu quyền theo nội dung thi đấu/event. |
| Store frontend | Lưu userRole, currentEnterpriseUser, permissions, activeTenantId, activeTournamentId, currentEventId. |
| RPC nghiệp vụ | Nhiều RPC đã có kiểm tra quyền phía backend. |

### 2.2 Điểm đúng hiện tại

- Không còn dựa hoàn toàn vào local state cho quyền nghiệp vụ quan trọng.
- Các luồng đội, bảng, lịch, điểm, knockout đã có nhiều RPC kiểm tra quyền theo event.
- REFEREE/EVENT_ADMIN đã có khái niệm quyền theo event.
- Danh sách workspace đã có RPC riêng để truy vấn phạm vi được truy cập.
- Public TV/tournament snapshot đã được tách khỏi luồng đăng nhập.

### 2.3 Điểm chưa đạt

- Chưa có route guard tập trung cho `/admin/workspace/:slug`.
- Sau login, nếu user đang ở URL sai quyền, hệ thống chưa có một quyết định điều hướng rõ ràng và nhất quán.
- `setAuthStatus` hiện có logic tự chọn tab như `scoreEntry`, `dashboard`, hoặc giữ tab cũ; logic này chưa dựa trên kết quả `list_accessible_workspaces_v1`.
- Menu chính hiện lọc theo role + permission tổng, nhưng chưa luôn kiểm tra scope của workspace/event hiện tại.
- REFEREE hiện có thể bị thiếu trải nghiệm "chọn giải được phân quyền" rõ ràng.
- Một số UI vẫn có khả năng hiển thị menu/nút trước khi dữ liệu quyền theo workspace/event được xác nhận xong.

## 3. Mối liên kết giữa đăng nhập và từng nhóm nghiệp vụ

### 3.1 Quản lý tài khoản

Nghiệp vụ:

- tạo tài khoản;
- sửa thông tin;
- khóa/xóa mềm;
- xóa cứng nếu có;
- phân quyền;
- xem tài khoản thuộc phạm vi quản lý.

Liên kết với đăng nhập:

- Tài khoản đăng nhập quyết định phạm vi account được xem/sửa.
- TENANT_ADMIN chỉ nên quản lý tài khoản trong tenant của mình.
- EVENT_ADMIN chỉ nên quản lý tài khoản trọng tài hoặc tài khoản dưới quyền trong event được phân công, nếu nghiệp vụ cho phép.
- REFEREE/VIEWER không được quản lý tài khoản.

Điểm chưa đạt/rủi ro:

- Cần bảo đảm màn tài khoản không chỉ dựa vào `manage_accounts` tổng, mà phải xét scope.
- Cần hiển thị rõ mỗi tài khoản được phân quyền tenant/tournament/event nào.
- Cần chặn phân quyền vượt phạm vi của người đang thao tác.
- Cần refresh quyền sống sau khi phân quyền bị thay đổi từ browser khác.

Đề xuất:

- Chuẩn hóa một RPC danh sách tài khoản theo scope, ví dụ `list_manageable_accounts_v1`.
- Chuẩn hóa một RPC quyền hiệu lực của một tài khoản, ví dụ `get_account_access_summary_v1`.
- Màn tài khoản phải hiển thị: tài khoản, role, trạng thái, tenant, giải, event, quyền cụ thể.
- Mọi grant/revoke/update/delete account phải kiểm tra backend.

### 3.2 Quản lý giải đấu/workspace

Nghiệp vụ:

- tạo giải;
- sửa thông tin giải;
- archive/restore;
- hard delete từ mục đã xóa;
- chọn giải để vận hành.

Liên kết với đăng nhập:

- Đây là điểm vào chính sau login cho mọi tài khoản không phải SUPER_ADMIN.
- Nếu user đăng nhập nhầm URL, phải đưa về danh sách giải được quyền.
- REFEREE cũng cần thấy danh sách giải được quyền, nhưng không được thấy chức năng quản lý giải.

Điểm chưa đạt/rủi ro:

- Route `/admin/workspace/:slug` có thể set workspace context trước khi xác nhận user được quyền vào workspace.
- Menu "Giải đấu" hiện đang gắn với permission `view_public` và roles không gồm REFEREE trong cấu hình chính; nghiệp vụ mới yêu cầu REFEREE cũng thấy danh sách giải được phân quyền.
- Cần phân biệt "Danh sách giải được quyền truy cập" với "Quản lý giải đấu".

Đề xuất:

- Tách khái niệm:
  - `workspace_directory`: mọi account đăng nhập được xem danh sách giải được quyền.
  - `manage_tournaments`: chỉ account có quyền quản lý mới tạo/sửa/xóa giải.
- Route guard phải chạy trước khi load dữ liệu nghiệp vụ.
- Nếu không có quyền vào slug hiện tại, clear context hiện tại và chuyển về `/admin/workspaces`.

### 3.3 Quản lý nội dung thi đấu/event

Nghiệp vụ:

- tạo nội dung;
- sửa cấu hình nội dung;
- archive/restore/hard delete;
- cấu hình luật điểm/số séc theo vòng;
- phân quyền event admin/referee.

Liên kết với đăng nhập:

- TENANT_ADMIN có thể quản lý nội dung trong giải thuộc tenant.
- EVENT_ADMIN chỉ được quản lý event được cấp quyền.
- REFEREE không được cấu hình event.

Điểm chưa đạt/rủi ro:

- UI có thể hiển thị menu nội dung nếu permission tổng có `manage_event_config`, nhưng cần kiểm tra event hiện tại có quyền này không.
- Khi chuyển event, currentEventId phải luôn thuộc danh sách event được quyền.
- Cấu hình event có liên quan trực tiếp tới nhập điểm, xếp hạng, TV; nếu quyền/event scope sai sẽ gây sai dữ liệu dây chuyền.

Đề xuất:

- Dùng một hàm policy frontend: `canManageEventConfig(eventId)`.
- Backend tiếp tục dùng `update_event_config_v1` để kiểm tra quyền thật.
- Mọi danh sách event trong UI phải lấy từ `list_events_by_tournament_v1` và filter theo quyền backend.
- Nếu quyền event bị thu hồi, tự chuyển currentEventId sang event còn quyền hoặc quay về workspace list.

### 3.4 Đội thi đấu

Nghiệp vụ:

- thêm đội;
- sửa tên/seed;
- xóa/archive đội;
- import đội.

Liên kết với đăng nhập:

- Chỉ thao tác được trên event đang được phân quyền.
- EVENT_ADMIN có quyền nếu được cấp `manage_teams`.
- TENANT_ADMIN có quyền trong tenant.
- REFEREE không được thao tác đội.

Điểm chưa đạt/rủi ro:

- UI có kiểm tra `manage_teams`, nhưng phải chắc chắn là quyền theo `currentEventId`, không chỉ quyền tổng.
- Nếu currentEventId bị sai do URL/workspace sai, thao tác đội có thể trỏ sai event.

Đề xuất:

- Disable toàn bộ nút thêm/sửa/xóa đội nếu `!canExecute('manage_teams', currentEventId)`.
- Khi API trả lỗi quyền, refresh profile/access grants và cập nhật UI ngay.

### 3.5 Bảng thi đấu

Nghiệp vụ:

- thêm/chia bảng;
- gán đội vào bảng;
- giải tán bảng;
- reset bảng nếu cần.

Liên kết với đăng nhập:

- Cần quyền `manage_groups` theo event.
- Không được thao tác nếu event không thuộc quyền.

Điểm chưa đạt/rủi ro:

- Chia bảng ảnh hưởng đến lịch, xếp hạng, knockout slot.
- Nếu quyền bị thu hồi khi user đang ở màn bảng, UI phải khóa ngay hoặc backend phải chặn mọi RPC.

Đề xuất:

- Dùng `canManageGroups(currentEventId)` cho UI.
- Backend RPC `setup_groups_v4`, `assign_team_to_group_v2`, `dissolve_groups_v4` tiếp tục là nguồn kiểm tra cuối.

### 3.6 Lịch thi đấu

Nghiệp vụ:

- khởi tạo lịch;
- xóa lịch;
- sắp xếp lịch;
- đổi trạng thái chờ/đang đấu;
- xuất file lịch.

Liên kết với đăng nhập:

- Tạo/xóa lịch cần `manage_schedule` hoặc quyền tương đương đã chuẩn hóa.
- Nhập điểm cần `enter_scores`.
- Xem lịch có thể là `view_event` hoặc `view_public` tùy màn.

Điểm chưa đạt/rủi ro:

- Hiện có alias giữa `manage_matches`, `manage_schedule`, `manage_knockout`; cần chuẩn hóa rõ.
- Một menu có thể chứa cả thao tác quản lý lịch và nhập điểm, nhưng hai quyền này khác nhau.

Đề xuất:

- Tách quyền UI theo action:
  - tạo/xóa lịch: `manage_schedule`;
  - đưa trận vào panel đang đấu: `enter_scores` hoặc `manage_schedule`, tùy quyết định nghiệp vụ;
  - xem lịch: `view_event`.
- Không dùng một quyền chung cho toàn màn nếu trong màn có nhiều loại thao tác.

### 3.7 Nhập điểm

Nghiệp vụ:

- đưa trận vào trạng thái chờ/đang đấu;
- nhập điểm từng séc;
- chốt trận;
- reset điểm;
- thoát trận khỏi panel nếu chưa có điểm;
- hiển thị đúng số séc theo cấu hình từng vòng.

Liên kết với đăng nhập:

- Cần `enter_scores` theo event.
- REFEREE chỉ nhập điểm event được cấp.
- Nếu quyền bị thu hồi khi đang đăng nhập, thao tác nhập điểm phải bị chặn ngay.

Điểm đã đúng:

- Đã có RPC liên quan score và live permission revocation.
- Backend đã có kiểm tra quyền nhập điểm theo match/event ở các migration gần đây.

Điểm chưa đạt/rủi ro:

- Cần đảm bảo mọi nút nhập/chốt/reset/đưa vào đang đấu đều dùng cùng policy.
- Nếu UI đang giữ data cũ sau khi bị thu quyền, phải refresh profile/access grants khi RPC báo permission denied.

Đề xuất:

- Dùng `canEnterScores(currentEventId)` cho mọi thao tác score.
- Khi RPC score trả lỗi quyền, chạy lại `get_current_profile` + `list_accessible_workspaces_v1`.
- Nếu event không còn quyền, chuyển về workspace list hoặc chọn event còn quyền.

### 3.8 Xếp hạng

Nghiệp vụ:

- xem bảng xếp hạng;
- tính ranking;
- xác định slot vào knockout;
- hiển thị hạng 1/2/3 xuất sắc.

Liên kết với đăng nhập:

- Xem xếp hạng có thể cần `view_event`.
- Quản lý slot/knockout cần `manage_standings` hoặc `manage_knockout`.

Điểm chưa đạt/rủi ro:

- Menu "Xếp hạng & KO" hiện có thể cho REFEREE nếu permission phù hợp, nhưng cần tách xem xếp hạng với chỉnh KO.
- REFEREE thường nên xem được xếp hạng nếu cần vận hành, nhưng không được sửa slot/KO.

Đề xuất:

- Tách quyền:
  - xem xếp hạng: `view_event`;
  - cấu hình/khóa slot KO: `manage_standings`;
  - chỉnh sơ đồ KO: `manage_knockout`.

### 3.9 Sơ đồ Knockout

Nghiệp vụ:

- tạo sơ đồ placeholder;
- chỉnh thủ công slot;
- lưu/khóa sơ đồ;
- xóa sơ đồ;
- liên kết slot hạng bảng với đội thật sau khi vòng bảng có kết quả;
- hiển thị đội thật ở nhập điểm và TV.

Liên kết với đăng nhập:

- Xem KO: `view_event`.
- Sửa KO: `manage_knockout`.
- Nhập điểm trận KO: `enter_scores`.

Điểm chưa đạt/rủi ro:

- Nếu menu ranking/KO dùng chung một permission, có thể mở quá quyền.
- Xóa/tạo KO là thao tác phá dữ liệu mạnh, phải luôn kiểm tra backend.
- Khi bảng chưa hoàn thành, KO slot phải giữ placeholder và không tự hiển thị đội thật sai.

Đề xuất:

- UI chỉ hiện nút tạo/xóa/chỉnh KO khi có `manage_knockout`.
- TV và nhập điểm chỉ resolve tên đội thật từ `knockout_slots` khi đủ điều kiện.
- Backend cần bảo đảm không xóa vòng bảng, teams, groups khi xóa KO.

### 3.10 Trình chiếu TV / public viewer

Nghiệp vụ:

- khán giả xem dữ liệu công khai;
- TV hiển thị lịch, đang đấu, kết quả, knockout, thông báo;
- chia sẻ link giải đấu.

Liên kết với đăng nhập:

- Guest không nên dùng RPC quản trị.
- Public route nên dùng snapshot công khai, không phụ thuộc session.
- Account đăng nhập xem TV theo `view_event` hoặc `view_public`.

Điểm đúng:

- Đã có hướng `get_public_tournament_snapshot_v1`.

Điểm chưa đạt/rủi ro:

- Cần bảo đảm public snapshot không leak dữ liệu tài khoản/quyền nội bộ.
- TV tất cả nội dung phải lọc archived và chỉ hiển thị dữ liệu public hợp lệ.
- Nếu tournament/event bị archived, public TV không được hiển thị nữa.

Đề xuất:

- Duy trì public snapshot riêng.
- Tách rõ TV public và TV admin:
  - `/tournament/:slug`: public snapshot;
  - `/admin/workspace/:slug`: dữ liệu theo session/quyền.

## 4. Điểm chưa đạt tổng hợp

| Mức độ | Vấn đề | Ảnh hưởng |
|---|---|---|
| P0 | Chưa có route guard thống nhất cho workspace slug | User có thể vào URL sai quyền và thấy UI khó hiểu. |
| P0 | Context có thể set trước khi xác nhận access | Nguy cơ load sai giải/event trong UI. |
| P0 | Menu/nút chưa luôn kiểm tra permission theo event hiện tại | Có thể thấy hoặc bấm chức năng ngoài phạm vi. |
| P0 | REFEREE chưa chắc luôn thấy danh sách giải được phân quyền | Không biết phải vào giải nào khi đăng nhập nhầm URL. |
| P1 | Quyền màn lớn chưa tách theo action nhỏ | Một menu chứa nhiều thao tác có thể bị mở quá quyền. |
| P1 | Chưa có policy frontend tập trung | Logic quyền rải rác, khó bảo trì. |
| P1 | Chưa có contract hiển thị account-access rõ ràng | Màn quản lý tài khoản khó biết ai quản lý gì. |
| P2 | Public TV/admin TV cần contract riêng rõ hơn | Rủi ro leak dữ liệu hoặc load sai trạng thái archived. |

## 5. Đề xuất chỉnh sửa theo thứ tự

### Giai đoạn 1: Chuẩn hóa login và workspace access

Mục tiêu: xử lý triệt để trường hợp đăng nhập nhầm URL.

Việc cần làm:

1. Tạo helper frontend `resolveWorkspaceAccessAfterLogin`.
2. Sau login, gọi `list_accessible_workspaces_v1`.
3. Nếu role không phải SUPER_ADMIN và slug hiện tại không thuộc danh sách được quyền, chuyển về `/admin/workspaces`.
4. Trong `AdminWorkspace`, thêm route guard tương tự cho trường hợp đã đăng nhập sẵn hoặc refresh URL.
5. Khi bị redirect vì sai quyền, clear `activeTournamentId`, `currentEventId` nếu không còn hợp lệ.
6. Cho REFEREE thấy `/admin/workspaces`, nhưng không thấy nút quản lý giải.

Tiêu chí đạt:

- `tt1` đăng nhập từ `/admin/workspace/pic-cocdan` bị chuyển về danh sách giải được phân quyền.
- `tt1` chọn đúng giải được cấp thì vào được.
- `tt1` không thấy menu ngoài quyền.
- SUPER_ADMIN không bị ảnh hưởng.

### Giai đoạn 2: Chuẩn hóa permission policy frontend

Mục tiêu: menu/nút/action dùng một nguồn kiểm tra quyền.

Việc cần làm:

1. Tạo module `permissionPolicy`.
2. Tạo các hàm:
   - `canOpenWorkspaceDirectory(user)`;
   - `canAccessWorkspace(user, workspaceSlug)`;
   - `canViewMenu(menuId, context)`;
   - `canManageEventConfig(eventId)`;
   - `canManageTeams(eventId)`;
   - `canManageGroups(eventId)`;
   - `canManageSchedule(eventId)`;
   - `canEnterScores(eventId)`;
   - `canManageStandings(eventId)`;
   - `canManageKnockout(eventId)`;
   - `canManageReferees(eventId)`.
3. Thay các check rải rác trong UI bằng policy này.

Tiêu chí đạt:

- Bỏ quyền trong account management xong, reload hoặc refresh profile thì menu/nút biến mất đúng.
- UI không còn dựa vào permission tổng cho action theo event.

### Giai đoạn 3: Chuẩn hóa contract backend về quyền hiệu lực

Mục tiêu: frontend có dữ liệu quyền rõ ràng, không phải tự đoán.

Việc cần làm:

1. Rà `get_current_profile` để bảo đảm trả đủ:
   - account id;
   - role;
   - tenant;
   - permissions tổng;
   - event permissions;
   - danh sách tournament/workspace được quyền nếu phù hợp.
2. Cân nhắc thêm view/RPC `effective_access_grants_v1`.
3. Cập nhật `list_accessible_workspaces_v1` để trả thêm:
   - lý do được quyền;
   - role trong workspace;
   - event được cấp;
   - permission summary.

Tiêu chí đạt:

- Màn danh sách giải hiển thị rõ user có quyền gì trong từng giải.
- Màn quản lý tài khoản hiển thị rõ mỗi tài khoản quản lý gì.

### Giai đoạn 4: Rà từng nghiệp vụ theo action

Mục tiêu: tất cả thêm/sửa/xóa/chốt/reset đều bị khóa đúng theo permission hiện tại.

Thứ tự kiểm tra:

1. Tài khoản: create/update/delete/grant/revoke.
2. Giải đấu: create/update/archive/restore/hard delete.
3. Nội dung: create/update config/archive/restore/hard delete.
4. Đội: create/import/update/archive.
5. Bảng: setup/assign/dissolve.
6. Lịch: generate/delete/status waiting/playing.
7. Điểm: set score/finalize/reset/remove from scoring panel.
8. Xếp hạng: view/manage qualification.
9. KO: create/edit/lock/delete/resolve slots.
10. TV: admin view/public snapshot/announcement.

Tiêu chí đạt:

- Mỗi action có permission rõ ràng.
- UI khóa trước khi bấm.
- Backend vẫn chặn nếu gọi trực tiếp.
- Khi permission bị thu hồi từ browser khác, thao tác tiếp theo bị chặn.

## 6. Ma trận nghiệp vụ đề xuất

| Nghiệp vụ | Xem | Thêm/Sửa/Xóa | Scope bắt buộc |
|---|---|---|---|
| Danh sách giải được quyền | account đăng nhập | không áp dụng | account |
| Quản lý giải | `view_public` hoặc `manage_tournaments` | `manage_tournaments` | tenant/tournament |
| Quản lý tài khoản | `manage_accounts` hoặc `manage_referees` | theo quyền quản lý | tenant/event |
| Nội dung thi đấu | `view_event` | `manage_event_config` | event |
| Đội | `view_event` | `manage_teams` | event |
| Bảng | `view_event` | `manage_groups` | event |
| Lịch | `view_event` | `manage_schedule` | event |
| Nhập điểm | `view_event` | `enter_scores` | event/match |
| Xếp hạng | `view_event` | `manage_standings` | event |
| Knockout | `view_event` | `manage_knockout` | event |
| Trọng tài | `view_event` | `manage_referees` | event |
| TV public | public snapshot | không áp dụng | tournament public |

## 7. Lộ trình triển khai khuyến nghị

### Bước 1: Fix login/workspace guard

Làm trước vì đây là điểm vào của toàn hệ thống.

### Bước 2: Refactor menu visibility

Sau khi route đúng, menu phải đúng theo role + scope.

### Bước 3: Refactor action buttons

Mọi nút thêm/sửa/xóa/chốt/reset phải dùng cùng policy.

### Bước 4: Nâng cấp account management

Hiển thị rõ từng tài khoản được quyền quản lý tenant/tournament/event nào.

### Bước 5: Test thật theo role

Test tối thiểu:

- SUPER_ADMIN;
- TENANT_ADMIN;
- EVENT_ADMIN;
- REFEREE;
- VIEWER hoặc guest public.

Mỗi role cần test:

- đăng nhập đúng URL;
- đăng nhập sai URL;
- refresh URL;
- thao tác được quyền;
- thao tác bị thu quyền;
- browser khác thay đổi quyền;
- reload vẫn đúng.

## 8. Khuyến nghị cuối

Không nên sửa rời rạc từng màn.

Nên triển khai theo trục:

1. Login xác định identity.
2. Workspace access xác định được vào giải nào.
3. Event permission xác định được làm gì trong từng nội dung.
4. UI chỉ là lớp hiển thị và khóa thao tác sớm.
5. RPC/backend là nơi quyết định cuối cùng.

Nếu làm theo hướng này, hệ thống có thể mở rộng sang nhiều tenant, nhiều giải, nhiều môn, nhiều loại tài khoản và các quyền chi tiết hơn mà không bị vỡ logic nghiệp vụ.
