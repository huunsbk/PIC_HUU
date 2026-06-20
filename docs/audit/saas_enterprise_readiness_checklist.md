# SaaS Enterprise Readiness Checklist

Date: 2026-06-20

| Area | Status | Notes |
| --- | --- | --- |
| Tenant isolation | Pass | Active cross-tenant event grants cleaned. |
| Subscription | Pass | Active tenants now have active Enterprise subscriptions. |
| Quota | Pass | `tenant_usage` view reports all active tenants can create users. |
| Account-role-permission | Pass | Standard roles exist; no legacy role in DB. |
| Auth/account linkage | Pass | No orphan auth users and no broken active account rows. |
| Audit log | Partial | New tenant/account server flows write audit logs. Historical audit is sparse. |
| Vercel deployment | Ready | Serverless API routes added under `api/admin`. |
| Supabase RLS/RPC | Improved | `create_tenant_v1` uses `SECURITY DEFINER` and provisions subscription. |
| UI test | Pending | Needs authenticated Vercel browser session to create accounts end to end. |
| Secret safety | Pass | No service-role key in `src`; server-only env key name used in API/Edge. |

## Remaining Manual Acceptance

- Login SUPER_ADMIN on Vercel.
- Create tenant doanh nghiệp mới.
- Create `TENANT_ADMIN`, `EVENT_ADMIN`, `REFEREE`, `VIEWER`.
- Login created accounts and verify tenant/menu scope.
- Assign `EVENT_ADMIN`/`REFEREE` to an event and verify scoped access.

