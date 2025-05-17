# RSU/ESOP Platform Specification (Current MVP)

**Version**: 0.9.0-mvp (Matches current codebase)

**Last Updated**: [Update with today's date]

---

## Table of Contents
1. [Overview](#1-overview)
2. [Functional Requirements](#2-functional-requirements)
3. [Data Model](#3-data-model)
4. [Key Business Logic & Rules](#4-key-business-logic--rules)
5. [API & UI Endpoints](#5-api--ui-endpoints)
6. [Admin Tools & Maintenance](#6-admin-tools--maintenance)
7. [Known Deviations from Canonical Spec](#7-known-deviations-from-canonical-spec)
8. [Project Structure & Scripts](#8-project-structure--scripts)

---

## 1. Overview
- This document describes the actual implementation and logic in the current codebase (MVP).
- All field names, flows, and UI/endpoint behaviors are as currently implemented.

## 2. Functional Requirements
- Multi-tenant RSU/ESOP platform
- Each tenant has exactly one equity pool (1:1 mapping)
- Employees, grants, vesting, and pool events are managed per tenant
- PPS (Price Per Share) history is tracked and can be backdated
- Admins can refresh PPS for all vesting events after PPS changes

## 3. Data Model (Key Tables)
- `tenant`: tenant_uid, name, currency, timezone, display_decimal_places
- `equity_pool`: pool_uid (PK), tenant_uid (unique, 1:1), initial_amount, total_pool, created_by
- `pool_event`: event_uid, pool_uid, tenant_uid, amount, event_type, effective_date, created_by
- `employee`: employee_uid, tenant_uid, ...
- `grant_record`: grant_uid, tenant_uid, employee_uid, share_amount, status, ...
- `vesting_event`: vesting_uid, grant_uid, tenant_uid, vest_date, shares_vested, pps_snapshot, ...
- `pps_history`: pps_uid, tenant_uid, effective_date, price_per_share, ...

## 4. Key Business Logic & Rules
- **Tenant/Pool:** 1 tenant = 1 pool. All pool and ledger endpoints use tenantUid.
- **PPS Logic:**
  - Each vesting event uses the PPS that is effective as of its vesting date (not just the latest PPS).
  - If PPS history is changed or backdated, an admin tool can refresh all vesting events to update their PPS snapshots.
- **Ledger:**
  - `/pools/:tenantUid/ledger` and `/pools/:tenantUid/ledger/data` always use tenantUid, never poolUid.
  - Ledger combines pool events, grant events, and "kept by employee" events for the tenant.
- **Registration & Pool Creation:**
  - Registration creates a tenant, admin user, and initial pool (amount can be 0).
  - If a tenant has no pool, admin can create one via UI.
- **Employee Status:**
  - Employees can be active, inactive, or terminated. Terminated status is now supported and filterable in the UI.
- **Grant Termination/Buyback:**
  - Buyback and kept-by-employee logic uses actual vested shares as of termination date, matching PPS and vesting event logic.
- **Manual vs. Automated Vesting Events:**
  - The system distinguishes between automated and manual vesting using the `source` column in the `vesting_event` table.
  - **Automated vesting** events have `source = 'auto'` (or similar).
  - **Manual vesting** events have `source` containing the word 'manual' (e.g., 'manual', 'manual_adjustment').
  - When displaying "manually vested after termination" (e.g., in the termination modal or reports), the system only includes vesting events after the termination date where the `source` column contains 'manual'.
  - This ensures only true manual adjustments or corrections are shown as manual, and scheduled vesting is not misclassified.
- When terminating an employee, the vested total includes all scheduled (auto) vesting up to the termination effective date AND all manual vesting events for the grant (regardless of creation date or vest_date). Manual vesting is always considered vested at termination.
- All dates (e.g., grant_date, vest_date, termination_effective_date) must be provided in YYYY-MM-DD format (ISO 8601). This applies to all API endpoints, UI forms, and business logic.

## 5. API & UI Endpoints
- `/pps` (GET/POST): View and add PPS records
- `/pps/refresh-vesting-pps` (POST): Admin endpoint to refresh PPS for all vesting events for the tenant
- `/pools` (GET): Pool dashboard (uses tenantUid)
- `/pools/:tenantUid/ledger` (GET): Equity ledger for tenant
- `/pools/:tenantUid/ledger/data` (GET): Ledger data (JSON)
- All links and AJAX calls use tenantUid, not poolUid

## 6. Admin Tools & Maintenance
- **PPS Refresh Tool:**
  - Admin UI button on PPS page: "Update PPS for All Grants"
  - Calls backend endpoint to update all vesting events' PPS snapshots for the tenant
- **Debug Logging:**
  - Key endpoints log event counts and data for troubleshooting

## 7. Known Deviations from Canonical Spec
- Some field names and flows may differ from the original spec; this document is the source of truth for the MVP
- PPS refresh and ledger logic are MVP-specific and may be refactored in future versions

## 8. Project Structure & Scripts

- All utility, fix, and maintenance scripts are now in the `scripts/` directory.
- Legacy migration and one-off scripts are in `/archive` for historical reference.
- All documentation, code, and API contracts are now UID-only. No integer IDs remain in the system.
- See `VESTING.md` for vesting logic, scripts, and troubleshooting.

**UID-Only Note (2024-06 and later):**
The platform is now fully UID-based. All entities (tenants, users, employees, grants, pools, PPS, events, etc.) use secure, random UID fields (e.g., `*_uid`) as their primary and foreign keys. Sequential integer IDs have been fully removed from the database schema, backend, frontend, and API. All endpoints, templates, and business logic now reference UIDs exclusively. This improves security (prevents ID-guessing) and multi-tenant isolation. All legacy migration documentation is now in `/archive`.

**This document is kept in sync with the codebase. Any changes to logic, endpoints, or flows should be reflected here.**

# Kiwi4 Platform Specification (Production-Ready)

## 1. Authentication & Session Management
- Only one of `req.session.user` (admin) or `req.session.employee` (employee) can be set at a time.
- If both are set, the session is destroyed and the user is forced to log in again.
- Logging in as one role clears the other role from the session.
- Logout destroys the session, clearing all sensitive data.

## 2. Access Control
- Admin-only and employee-only routes are protected by middleware that checks the correct session variable.
- No role switching is allowed without logging out.
- Strict separation between admin and employee dashboards and UI.

## 3. Security Features
- All routes are protected by CSRF tokens.
- Passwords are hashed with bcrypt; no plain-text passwords are stored or transmitted.
- Employee login uses a time-limited passcode sent to their email.
- Rate limiting and account lockout are enforced on login and passcode endpoints.
- Security headers are set using Helmet.
- Session cookies are `httpOnly`, `secure` in production, and have a 1-day expiry.
- All SQL queries use parameterized statements to prevent SQL injection.

## 4. Error Handling
- Friendly error pages are shown to users.
- Stack traces are only shown in non-production environments.
- 404 and 500 handlers are in place.

## 5. Logging
- Sensitive session data is only logged in development, never in production.
- Use a logging library for production error and access logs (recommended: winston or pino).

## 6. Deployment Requirements
- Set `NODE_ENV=production` in production.
- Set strong, unique values for all secrets in `.env` (never commit `.env` to version control).
- Enforce HTTPS and set `secure: true` for cookies.
- Use a process manager (e.g., pm2) to keep the app running.
- Regularly audit dependencies and update as needed.

---

For more details, see DESIGN-STANDARDS.md and PLAN.md.