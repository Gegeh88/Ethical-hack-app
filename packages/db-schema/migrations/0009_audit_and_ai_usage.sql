-- =========================================================================
-- 0009_audit_and_ai_usage.sql
-- Append-only audit log (legal) and AI usage tracking (cost control)
-- =========================================================================

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references app_users(id),
  actor_type actor_type not null default 'user',
  action text not null,
  resource_type text,
  resource_id uuid,
  ip_address inet,
  user_agent text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_actor on audit_log(actor_id, created_at desc);
create index if not exists idx_audit_action on audit_log(action, created_at desc);
create index if not exists idx_audit_resource on audit_log(resource_type, resource_id);

-- Append-only: block UPDATE and DELETE via rules
drop rule if exists audit_log_no_update on audit_log;
drop rule if exists audit_log_no_delete on audit_log;
create rule audit_log_no_update as on update to audit_log do instead nothing;
create rule audit_log_no_delete as on delete to audit_log do instead nothing;

create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  scan_job_id uuid references scan_jobs(id) on delete set null,
  organization_id uuid references organizations(id) on delete set null,
  prompt_id text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(10,6),
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_usage_org on ai_usage(organization_id, created_at desc);
