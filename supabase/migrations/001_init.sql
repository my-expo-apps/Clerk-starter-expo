-- Basic schema for future apps (starter)
-- Aligned with Custom JWT Federation + deterministic auth.uid().

-- Extensions
create extension if not exists "pgcrypto";

-- PROFILES (id maps to auth.uid() from federated JWT)
create table if not exists public.profiles (
  id uuid primary key default auth.uid(),
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- PROJECTS
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_user_id on public.projects(user_id);

-- Schema drafts (store schema definitions as JSON for future generation)
create table if not exists public.schema_drafts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  definition jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists schema_drafts_set_updated_at on public.schema_drafts;
create trigger schema_drafts_set_updated_at
before update on public.schema_drafts
for each row execute function public.set_updated_at();

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.schema_drafts enable row level security;

-- profiles policies
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- projects policies
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own"
on public.projects for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own"
on public.projects for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own"
on public.projects for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own"
on public.projects for delete
to authenticated
using (auth.uid() = user_id);

-- schema_drafts policies (access via owning project)
drop policy if exists "schema_drafts_select_own" on public.schema_drafts;
create policy "schema_drafts_select_own"
on public.schema_drafts for select
to authenticated
using (
  exists (
    select 1 from public.projects p
    where p.id = schema_drafts.project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "schema_drafts_insert_own" on public.schema_drafts;
create policy "schema_drafts_insert_own"
on public.schema_drafts for insert
to authenticated
with check (
  exists (
    select 1 from public.projects p
    where p.id = schema_drafts.project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "schema_drafts_update_own" on public.schema_drafts;
create policy "schema_drafts_update_own"
on public.schema_drafts for update
to authenticated
using (
  exists (
    select 1 from public.projects p
    where p.id = schema_drafts.project_id
      and p.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.projects p
    where p.id = schema_drafts.project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "schema_drafts_delete_own" on public.schema_drafts;
create policy "schema_drafts_delete_own"
on public.schema_drafts for delete
to authenticated
using (
  exists (
    select 1 from public.projects p
    where p.id = schema_drafts.project_id
      and p.user_id = auth.uid()
  )
);

