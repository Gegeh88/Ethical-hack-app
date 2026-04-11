-- =========================================================================
-- 0005_domains.sql
-- Domains and domain verifications (legal ownership proof)
-- =========================================================================

create table if not exists domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  added_by uuid references app_users(id),
  host text not null,
  verified_at timestamptz,
  verification_method verification_method,
  verification_expires_at timestamptz,
  is_shared_hosting boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_org_host unique (organization_id, host),
  constraint host_format check (host ~ '^[a-z0-9][-a-z0-9.]*\.[a-z]{2,}$')
);

create index if not exists idx_domains_org on domains(organization_id);
create index if not exists idx_domains_verified on domains(verified_at) where verified_at is not null;

create table if not exists domain_verifications (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references domains(id) on delete cascade,
  token text not null,
  method verification_method,
  status text not null default 'pending' check (status in ('pending','verified','failed','expired')),
  evidence jsonb,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  expires_at timestamptz not null
);

create index if not exists idx_dv_domain_status on domain_verifications(domain_id, status);
create index if not exists idx_dv_token on domain_verifications(token);
