-- =========================================================================
-- 0010_rls.sql
-- Row Level Security policies for haxvibe
-- Every user-facing table has RLS enabled with explicit policies.
-- Server-side service_role client bypasses RLS (used by api + worker).
-- =========================================================================

-- ---------- Helper functions ----------
create or replace function auth_org_id() returns uuid
  language sql stable security definer
as $$
  select organization_id from app_users where id = auth.uid() limit 1;
$$;

create or replace function is_admin() returns boolean
  language sql stable security definer
as $$
  select role = 'admin' from app_users where id = auth.uid() limit 1;
$$;

-- ---------- Enable RLS ----------
alter table organizations        enable row level security;
alter table app_users            enable row level security;
alter table subscriptions        enable row level security;
alter table domains              enable row level security;
alter table domain_verifications enable row level security;
alter table consent_records      enable row level security;
alter table scan_jobs            enable row level security;
alter table scan_results         enable row level security;
alter table vulnerabilities      enable row level security;
alter table reports              enable row level security;
alter table remediation_requests enable row level security;
alter table audit_log            enable row level security;
alter table ai_usage             enable row level security;

-- ---------- organizations ----------
drop policy if exists org_members_read on organizations;
create policy org_members_read on organizations
  for select using (id = auth_org_id() or is_admin());

drop policy if exists org_owner_update on organizations;
create policy org_owner_update on organizations
  for update using (
    id = auth_org_id()
    and exists (select 1 from app_users where id = auth.uid() and role in ('owner','admin'))
  );

-- ---------- app_users ----------
drop policy if exists users_read_same_org on app_users;
create policy users_read_same_org on app_users
  for select using (organization_id = auth_org_id() or id = auth.uid() or is_admin());

-- ---------- subscriptions ----------
drop policy if exists sub_read_own on subscriptions;
create policy sub_read_own on subscriptions
  for select using (organization_id = auth_org_id() or is_admin());

-- ---------- domains ----------
drop policy if exists domains_read on domains;
create policy domains_read on domains
  for select using (organization_id = auth_org_id() or is_admin());

drop policy if exists domains_insert on domains;
create policy domains_insert on domains
  for insert with check (organization_id = auth_org_id());

drop policy if exists domains_update on domains;
create policy domains_update on domains
  for update using (organization_id = auth_org_id());

drop policy if exists domains_delete on domains;
create policy domains_delete on domains
  for delete using (organization_id = auth_org_id() and is_admin());

-- ---------- domain_verifications ----------
drop policy if exists dv_read on domain_verifications;
create policy dv_read on domain_verifications
  for select using (
    exists (select 1 from domains d where d.id = domain_id and (d.organization_id = auth_org_id() or is_admin()))
  );

-- ---------- consent_records ----------
drop policy if exists consent_read on consent_records;
create policy consent_read on consent_records
  for select using (
    exists (select 1 from domains d where d.id = domain_id and (d.organization_id = auth_org_id() or is_admin()))
  );

drop policy if exists consent_insert on consent_records;
create policy consent_insert on consent_records
  for insert with check (user_id = auth.uid());

-- ---------- scan_jobs ----------
drop policy if exists scans_read on scan_jobs;
create policy scans_read on scan_jobs
  for select using (organization_id = auth_org_id() or is_admin());

drop policy if exists scans_insert on scan_jobs;
create policy scans_insert on scan_jobs
  for insert with check (
    organization_id = auth_org_id()
    and exists (
      select 1 from domains d
      where d.id = domain_id
        and d.organization_id = auth_org_id()
        and d.verified_at is not null
        and d.verification_expires_at > now()
    )
  );

-- ---------- vulnerabilities ----------
drop policy if exists vulns_read on vulnerabilities;
create policy vulns_read on vulnerabilities
  for select using (
    exists (select 1 from scan_jobs sj where sj.id = scan_job_id and (sj.organization_id = auth_org_id() or is_admin()))
  );

-- ---------- scan_results (raw — admins only) ----------
drop policy if exists scan_results_read on scan_results;
create policy scan_results_read on scan_results
  for select using (is_admin());

-- ---------- reports ----------
drop policy if exists reports_read on reports;
create policy reports_read on reports
  for select using (
    exists (select 1 from scan_jobs sj where sj.id = scan_job_id and (sj.organization_id = auth_org_id() or is_admin()))
  );

-- ---------- remediation_requests ----------
drop policy if exists rem_read on remediation_requests;
create policy rem_read on remediation_requests
  for select using (organization_id = auth_org_id() or is_admin());

drop policy if exists rem_insert on remediation_requests;
create policy rem_insert on remediation_requests
  for insert with check (organization_id = auth_org_id() and requested_by = auth.uid());

drop policy if exists rem_admin_update on remediation_requests;
create policy rem_admin_update on remediation_requests
  for update using (is_admin());

-- ---------- audit_log (own actions + admins) ----------
drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log
  for select using (actor_id = auth.uid() or is_admin());

-- ---------- ai_usage ----------
drop policy if exists ai_usage_read on ai_usage;
create policy ai_usage_read on ai_usage
  for select using (organization_id = auth_org_id() or is_admin());
