-- =========================================================================
-- 0002_types.sql
-- ENUM types for haxvibe
-- =========================================================================

do $$ begin
  create type scan_status as enum ('queued','running','completed','failed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type severity_level as enum ('info','low','medium','high','critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type verification_method as enum ('dns','meta','file');
exception when duplicate_object then null; end $$;

do $$ begin
  create type scan_type as enum ('passive','active','full');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_tier as enum ('free','pro','business');
exception when duplicate_object then null; end $$;

do $$ begin
  create type remediation_status as enum ('requested','assigned','in_progress','review','completed','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type actor_type as enum ('user','system','admin','api','worker');
exception when duplicate_object then null; end $$;
