-- =========================================================================
-- 0008_reports_remediation.sql
-- Generated reports and remediation requests
-- =========================================================================

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  scan_job_id uuid not null references scan_jobs(id) on delete cascade,
  domain_id uuid not null references domains(id) on delete cascade,
  summary_hu text,
  pdf_url text,
  pdf_generated_at timestamptz,
  finding_count integer not null default 0,
  severity_counts jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now()
);

create index if not exists idx_reports_job on reports(scan_job_id);

create table if not exists remediation_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  domain_id uuid not null references domains(id) on delete cascade,
  requested_by uuid not null references app_users(id),
  vulnerability_ids uuid[] not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  deadline timestamptz,
  status remediation_status not null default 'requested',
  admin_notes text,
  fix_suggestions jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rem_org_status on remediation_requests(organization_id, status);
