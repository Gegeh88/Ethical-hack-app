-- =========================================================================
-- 0007_scans.sql
-- Scan jobs, raw scan results, and normalized vulnerabilities
-- =========================================================================

create table if not exists scan_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  domain_id uuid not null references domains(id) on delete cascade,
  requested_by uuid not null references app_users(id),
  consent_record_id uuid references consent_records(id),
  type scan_type not null,
  status scan_status not null default 'queued',
  progress integer not null default 0 check (progress between 0 and 100),
  current_step text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  error_stack text,
  bull_job_id text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_scan_org_status on scan_jobs(organization_id, status);
create index if not exists idx_scan_domain on scan_jobs(domain_id);
create index if not exists idx_scan_queue on scan_jobs(status, queued_at);

create table if not exists scan_results (
  id uuid primary key default gen_random_uuid(),
  scan_job_id uuid not null references scan_jobs(id) on delete cascade,
  agent text not null,
  raw jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_scan_results_job on scan_results(scan_job_id);

create table if not exists vulnerabilities (
  id uuid primary key default gen_random_uuid(),
  scan_job_id uuid not null references scan_jobs(id) on delete cascade,
  domain_id uuid not null references domains(id) on delete cascade,
  source_agent text not null,
  template_id text,
  title text not null,
  description text,
  severity severity_level not null,
  cvss_score numeric,
  cve text[],
  tags text[],
  matched_at text,
  evidence jsonb,
  ai_explanation jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_vuln_job on vulnerabilities(scan_job_id);
create index if not exists idx_vuln_domain_sev on vulnerabilities(domain_id, severity);
create index if not exists idx_vuln_tags on vulnerabilities using gin (tags);
create index if not exists idx_vuln_cve on vulnerabilities using gin (cve);
create index if not exists idx_vuln_title_trgm on vulnerabilities using gin (title gin_trgm_ops);
