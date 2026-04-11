-- =========================================================================
-- 0003_organizations.sql
-- Organizations and app_users (linked to Supabase auth.users)
-- =========================================================================

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 200),
  billing_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  display_name text,
  role text not null default 'member' check (role in ('owner','admin','member')),
  locale text not null default 'hu',
  totp_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_users_org on app_users(organization_id);
