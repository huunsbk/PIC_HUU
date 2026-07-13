# Phase 5D - Structured Audit Contract

## Muc tieu

Bo sung hop dong audit co cau truc cho cac thao tac moi, dong thoi giu nguyen
`action`, `details` va `timestamp` de UI va du lieu lich su tiep tuc hoat dong.

## Truong moi

- actor: `actor_account_id`, `actor_role`
- phan loai: `category`
- doi tuong: `entity_type`, `entity_id`
- ket qua: `result`, `reason`
- payload co cau truc: `details_json`

## An toan du lieu

- Khong backfill hoac viet lai log cu.
- Payload moi duoc loai bo de quy cac khoa mat khau, token, secret va
  authorization truoc khi ghi.
- Client authenticated khong duoc goi truc tiep ham sanitize.
- Quyen ghi truc tiep `audit_logs` cua frontend van bi thu hoi.

## Tuong thich

`log_audit_event_v1` giu nguyen signature. Cac RPC nghiep vu cu khong can sua.
Vercel account API ghi them actor, target va result nhung van luu `details` text
de bao toan kha nang doc hien tai.

## Rollback

Co the phuc hoi function cu va bo cac index moi. Khong can xoa cac cot moi;
giu cot nullable la rollback an toan nhat cho production.
