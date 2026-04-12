-- 0012_app_users_trigger.sql
-- Auto-create app_users row when Supabase auth.users record is inserted.
-- The new row has organization_id = NULL (user needs onboarding via /auth/register-org).

create or replace function handle_new_auth_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  insert into app_users (id, display_name, role, locale)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    'member',
    'hu'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_auth_user();
