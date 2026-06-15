# ENTERPRISE DISASTER RECOVERY & BACKUP POLICY

**Effective:** Protocol Activation Phase 3
**Scope:** Supabase Database Cluster, Authentication Users, Storage Buckets

## 1. Backup Strategy (RPO/RTO defined)
- **Daily Backups:** Point-In-Time-Recovery (PITR) enabled. Nightly complete cluster snapshots.
- **Retention:** 30 Rolling Days online retention via Supabase infrastructure limits.
- **Monthly Archives:** Logical schema & data exports stored offline in Glacier cold storage.

## 2. Disaster Recovery Procedure
1. Verify nature of failure (data corruption vs. infrastructure outage).
2. For logical corruption within 30 days: Utilize Supabase PITR rollback to state immediately preceding incident.
3. For infrastructure compromise: Provision new Supabase Cluster via Terraform/CLI. Execute daily schema restore, followed by logical data hydration.
4. Rotate all Edge Keys, JWT Secrets, and Environment Variables globally prior to ingress restoration.

## 3. Restore Testing Checklist
- [ ] Spin up local replication image utilizing production `pg_dump`.
- [ ] Confirm `auth.users` decrypt cycle functional.
- [ ] Assert `active_sessions` purge on reboot.
- [ ] Verify `tenant_id` invariants remain intact with testing framework.
