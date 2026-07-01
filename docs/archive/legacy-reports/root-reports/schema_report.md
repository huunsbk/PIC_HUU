# Phase 4 Schema Report

## Tables
- `subscription_plans`: Holds the available SaaS plans (Starter, Pro, Business, Enterprise) and their feature limits.
- `tenant_subscriptions`: Tracks active and historical subscriptions per tenant, pointing to the specific plan.
- `invoices`: Stores billing and charge metadata generated per billing cycle.
- `payments`: Tracks transactional events and mapped provider statuses for specific invoices.

## Indexes
- `idx_subscription_tenant`: B-tree index on `tenant_subscriptions(tenant_id)` optimizing query speeds for SaaS dashboards and limit guards.
- `idx_invoice_tenant`: B-tree index on `invoices(tenant_id)` optimizing query speeds and reports.

## Policies
- `Plans_Select`: Allows all authenticated users to read available subscription plans.
- `Plans_All`: Restricts plan mutation to `SUPER_ADMIN` only.
- `Subscriptions_Select`: Allows tenant admins and super admins to view isolated subscription statuses.
- `Subscriptions_All`: Restricts subscription mutations to `SUPER_ADMIN` only.
- `Invoices_Select`: Restricts invoice reads to tenant owners and super admins.
- `Invoices_All`: Restricts invoice mutations.
- `Payments_Select`: Restricts read access on payments.
- `Payments_All`: Restricts mutations on payments.
