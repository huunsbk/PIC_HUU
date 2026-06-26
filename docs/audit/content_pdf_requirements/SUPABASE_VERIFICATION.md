# Content PDF Requirements - Supabase Verification

Date: 2026-06-26

## Applied SQL

- `supabase/migrations/enterprise_completion_v1/014_content_pdf_group_order_and_setdiff.sql`
- `supabase/migrations/enterprise_completion_v1/015_content_pdf_score_finalize_and_knockout_cleanup.sql`
- `supabase/migrations/enterprise_completion_v1/016_content_pdf_knockout_rank_labels.sql`

## RPC Signature Verification

Read-only verification returned:

- `finalize_match_score_v1(text)`: exists
- `clear_knockout_bracket_v1(text)`: exists
- `update_match_set_score_v1(text, integer, integer, integer)`: exists
- `prepare_knockout_candidates_v1(text, integer, integer, boolean)`: exists
- `get_workspace_context_v1(p_slug text)`: exists

## Match Status Verification

Active match status values after migration:

- `finished`: 31
- `pending`: 47
- `playing`: 1

No active `in_progress` rows remain.

## Knockout Slot Verification

Đôi Nam active KO selections and round-1 match metadata now use:

- `Hạng 1 bảng A`
- `Hạng 1 bảng B`
- `Hạng 1 bảng C`
- `Hạng 1 bảng D`
- `Hạng 2 bảng A`
- `Hạng 2 bảng B`
- `Hạng 2 bảng C`
- `Hạng 2 bảng D`

The UI keeps these rank-slot labels as the primary bracket line and shows resolved team names as secondary text.

## Safety

- No `auth.users` delete/reset was performed.
- No `TRUNCATE CASCADE` was used.
- No service role key, token, or password is committed.
