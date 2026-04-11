-- =========================================================================
-- 0001_extensions.sql
-- Required Postgres extensions for haxvibe
-- =========================================================================

create extension if not exists "pgcrypto" schema extensions;
create extension if not exists "uuid-ossp" schema extensions;
create extension if not exists "pg_trgm";
