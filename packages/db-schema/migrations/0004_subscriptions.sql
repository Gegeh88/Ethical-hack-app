-- =========================================================================
-- 0004_subscriptions.sql
-- Billing subscriptions
-- =========================================================================

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tier subscription_tier not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uniq_sub_org on subscriptions(organization_id);
create index if not exists idx_sub_stripe on subscriptions(stripe_subscription_id);
