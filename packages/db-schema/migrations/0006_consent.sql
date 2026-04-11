-- =========================================================================
-- 0006_consent.sql
-- Consent records for legal compliance (Btk. 423. §)
-- =========================================================================

create table if not exists consent_records (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references domains(id) on delete cascade,
  user_id uuid not null references app_users(id),
  tos_version text not null,
  scan_scope text not null check (scan_scope in ('passive_only','active_scan','full')),
  ip_address inet,
  user_agent text,
  shared_hosting_acknowledged boolean not null default false,
  active boolean not null default true,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_consent_active on consent_records(domain_id, active) where active = true;
