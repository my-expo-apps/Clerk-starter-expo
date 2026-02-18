-- Stable bootstrap installer (no pg-meta dependency).
-- Provides a safe, permission-restricted RPC for Edge bootstrap.

create extension if not exists "uuid-ossp";

create or replace function public.bootstrap_install()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  did_change boolean := false;
  has_rls boolean;
begin
  -- Ensure updated_at trigger helper exists
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_updated_at'
  ) then
    did_change := true;
    execute $fn$
      create function public.set_updated_at()
      returns trigger
      language plpgsql
      as $$
      begin
        new.updated_at = now();
        return new;
      end;
      $$;
    $fn$;
  end if;

  -- PROFILES table
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'profiles'
  ) then
    did_change := true;
    execute $sql$
      create table public.profiles (
        id uuid primary key default auth.uid(),
        display_name text,
        created_at timestamptz default now(),
        updated_at timestamptz default now()
      );
    $sql$;
  end if;

  -- PROJECTS table
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'projects'
  ) then
    did_change := true;
    execute $sql$
      create table public.projects (
        id uuid primary key default uuid_generate_v4(),
        user_id uuid not null default auth.uid(),
        name text not null,
        created_at timestamptz default now(),
        updated_at timestamptz default now()
      );
    $sql$;
  end if;

  -- Index
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'idx_projects_user_id'
      and c.relkind = 'i'
  ) then
    did_change := true;
    execute 'create index idx_projects_user_id on public.projects(user_id);';
  end if;

  -- Triggers (create only if missing)
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'profiles'
      and t.tgname = 'profiles_set_updated_at'
      and not t.tgisinternal
  ) then
    did_change := true;
    execute 'create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'projects'
      and t.tgname = 'projects_set_updated_at'
      and not t.tgisinternal
  ) then
    did_change := true;
    execute 'create trigger projects_set_updated_at before update on public.projects for each row execute function public.set_updated_at();';
  end if;

  -- Enable RLS if not enabled
  select relrowsecurity into has_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'profiles';
  if has_rls is distinct from true then
    did_change := true;
    execute 'alter table public.profiles enable row level security;';
  end if;

  select relrowsecurity into has_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'projects';
  if has_rls is distinct from true then
    did_change := true;
    execute 'alter table public.projects enable row level security;';
  end if;

  -- Policies (create only if missing)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_select_own') then
    did_change := true;
    execute 'create policy projects_select_own on public.projects for select to authenticated using (auth.uid() = user_id);';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_insert_own') then
    did_change := true;
    execute 'create policy projects_insert_own on public.projects for insert to authenticated with check (auth.uid() = user_id);';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_update_own') then
    did_change := true;
    execute 'create policy projects_update_own on public.projects for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_delete_own') then
    did_change := true;
    execute 'create policy projects_delete_own on public.projects for delete to authenticated using (auth.uid() = user_id);';
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_own') then
    did_change := true;
    execute 'create policy profiles_select_own on public.profiles for select to authenticated using (auth.uid() = id);';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_own') then
    did_change := true;
    execute 'create policy profiles_update_own on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);';
  end if;

  if did_change then
    return jsonb_build_object('success', true, 'bootstrapped', true);
  end if;
  return jsonb_build_object('success', true, 'already_initialized', true);
end;
$$;

revoke all on function public.bootstrap_install() from public;
grant execute on function public.bootstrap_install() to service_role;

