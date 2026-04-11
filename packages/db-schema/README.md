# @haxvibe/db-schema

SQL migrations and seed data for the haxvibe Supabase Postgres database.

## Migration workflow

Migrations are applied **both** to local `migrations/` directory (source of truth in git) and to the live Supabase project (`hvzfxxtzukgryanmgeoh`) via Supabase MCP tools.

Naming: `NNNN_slug.sql` where NNNN is a zero-padded sequence.

## Current migrations

- `0001_extensions.sql` — required Postgres extensions
- `0002_types.sql` — ENUM types
- `0003_organizations.sql` — organizations + app_users
- `0004_subscriptions.sql` — billing subscriptions
- `0005_domains.sql` — domains + domain_verifications
- `0006_consent.sql` — consent records (legal compliance)
- `0007_scans.sql` — scan_jobs + scan_results + vulnerabilities
- `0008_reports_remediation.sql` — reports + remediation_requests
- `0009_audit_and_ai_usage.sql` — audit_log + ai_usage tracking
- `0010_rls.sql` — Row Level Security policies

See `docs/IMPLEMENTATION_PLAN.md` §5 for the full schema specification.
