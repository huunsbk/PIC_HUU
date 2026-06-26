# Content PDF Requirements - UI Button Test Matrix

Date: 2026-06-26

| Menu | Button / Control | Account | Expected | Actual | Console | Network | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chia bảng | Tạo bảng trống | Admin | Empty groups created, teams remain waiting | Pending production E2E | Pending | Pending | Pending |
| Chia bảng | Drag waiting -> group | Admin | Team assigned once, ordered in group | Pending production E2E | Pending | Pending | Pending |
| Chia bảng | Drag group -> waiting | Admin | Team unassigned | Pending production E2E | Pending | Pending | Pending |
| Nhập điểm | Select match row | REFEREE | Active match panel opens | Pending production E2E | Pending | Pending | Pending |
| Nhập điểm | Save set | REFEREE | `match_sets` updates, match not finalized | Pending production E2E | Pending | Pending | Pending |
| Nhập điểm | Chốt trận | REFEREE | `finalize_match_score_v1` decides winner | Pending production E2E | Pending | Pending | Pending |
| Nhập điểm | X close panel | REFEREE | Panel closes without finalizing | Pending production E2E | Pending | Pending | Pending |
| Knockout | Prepare candidates | Admin | Blocked until all groups complete | Pending production E2E | Pending | Pending | Pending |
| Knockout | Generate bracket | Admin | Rank labels persist | Pending production E2E | Pending | Pending | Pending |
| Knockout | Delete bracket | Admin | KO matches soft-deleted | Pending production E2E | Pending | Pending | Pending |
| Nội dung thi đấu | Cấp quyền trọng tài | Admin | Grant modal opens and RPC works | Pending production E2E | Pending | Pending | Pending |
| Nội dung thi đấu | Archive event | Admin | Event archived/restored | Pending production E2E | Pending | Pending | Pending |
| Nội dung thi đấu | Copy link | Admin | Public link copied | Pending production E2E | Pending | Pending | Pending |
| Nội dung thi đấu | Open dashboard | Admin | Dashboard opens | Pending production E2E | Pending | Pending | Pending |
