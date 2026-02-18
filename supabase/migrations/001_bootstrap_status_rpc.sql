-- Bootstrap status introspection RPC (stable, no dynamic SQL).
-- This is meant for automated validation / health checks.

create or replace function public.bootstrap_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  projects_table boolean;
  profiles_table boolean;
  projects_rls boolean;
  profiles_rls boolean;
  projects_policies integer := 0;
  profiles_policies integer := 0;
  trig_projects boolean;
  trig_profiles boolean;
  idx_projects_user_id boolean;
  ready boolean;
begin
  -- Tables
  projects_table := exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'projects'
  );
  profiles_table := exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'profiles'
  );

  -- RLS flags (false if table missing)
  select coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'projects'
  ), false) into projects_rls;

  select coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'profiles'
  ), false) into profiles_rls;

  -- Policy counts
  select count(*) into projects_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'projects';

  select count(*) into profiles_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'profiles';

  -- Triggers
  trig_projects := exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'projects'
      and t.tgname = 'projects_set_updated_at'
      and not t.tgisinternal
  );

  trig_profiles := exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'profiles'
      and t.tgname = 'profiles_set_updated_at'
      and not t.tgisinternal
  );

  -- Index
  idx_projects_user_id := exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'idx_projects_user_id'
      and c.relkind = 'i'
  );

  ready :=
    projects_table
    and profiles_table
    and projects_rls
    and profiles_rls
    and trig_projects
    and trig_profiles
    and idx_projects_user_id
    and projects_policies >= 4
    and profiles_policies >= 2;

  return jsonb_build_object(
    'success', true,
    'tables', jsonb_build_object('projects', projects_table, 'profiles', profiles_table),
    'rls', jsonb_build_object('projects', projects_rls, 'profiles', profiles_rls),
    'policies', jsonb_build_object('projects', projects_policies, 'profiles', profiles_policies),
    'triggers', jsonb_build_object('projects_updated_at', trig_projects, 'profiles_updated_at', trig_profiles),
    'indexes', jsonb_build_object('idx_projects_user_id', idx_projects_user_id),
    'ready', ready
  );
end;
$$;

revoke all on function public.bootstrap_status() from public;
grant execute on function public.bootstrap_status() to service_role;

