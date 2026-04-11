-- =========================================================================
-- 0011_security_fixes.sql
-- Address Supabase advisor warnings from 0010_rls:
--   1. function_search_path_mutable — pin search_path on SECURITY DEFINER funcs
--   2. extension_in_public — move pg_trgm to the 'extensions' schema
-- =========================================================================

-- ---------- Pin search_path on SECURITY DEFINER helpers ----------
create or replace function auth_org_id() returns uuid
  language sql stable security definer
  set search_path = public, pg_temp
as $$
  select organization_id from app_users where id = auth.uid() limit 1;
$$;

create or replace function is_admin() returns boolean
  language sql stable security definer
  set search_path = public, pg_temp
as $$
  select role = 'admin' from app_users where id = auth.uid() limit 1;
$$;

-- ---------- Move pg_trgm to extensions schema ----------
alter extension pg_trgm set schema extensions;
