# UI Menu Command Inventory

## Prompt 07-D Navigation Labels

| Old label | New label | Purpose |
|---|---|---|
| Trang chủ | Tổng quan giải | Tournament dashboard |
| Enterprise Workspaces | Quản lý giải đấu | Tournament management |
| Event Center | Nội dung thi đấu | Event/content management |
| Tuyển chọn vòng trong | Xếp hạng & Vào vòng trong | Standings and knockout qualification |
| Sơ đồ trực tiếp | Sơ đồ Knockout | Knockout bracket |

## Context Header

The app header shows:

- Đơn vị
- Giải
- Nội dung thi đấu

## Management Pages

| Page | Role | Backing RPC |
|---|---|---|
| Quản lý đơn vị | SUPER_ADMIN | `list_tenants_v1`, `create_tenant_v1`, `archive_tenant_v1`, `restore_tenant_v1` |
| Quản lý giải đấu | SUPER_ADMIN, TENANT_ADMIN | `list_tournaments_v1`, `create_tournament_v1`, `archive_tournament_v1` |
| Nội dung thi đấu | SUPER_ADMIN, TENANT_ADMIN | `update_event_config_v1` plus event read/create flow |
