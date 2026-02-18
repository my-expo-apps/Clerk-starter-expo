-- Basic schema for future apps (starter)
-- Apply via Supabase SQL Editor or Supabase CLI migrations.

-- Extensions
create extension if not exists "pgcrypto";

-- Profiles (ties to Supabase auth.users by default)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Projects (a simple container for future apps)
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

-- projects policies
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own"
on public.projects for select
using (auth.uid() = owner_id);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own"
on public.projects for insert
with check (auth.uid() = owner_id);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own"
on public.projects for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own"
on public.projects for delete
using (auth.uid() = owner_id);

-- schema_drafts policies (access via owning project)
drop policy if exists "schema_drafts_select_own" on public.schema_drafts;
create policy "schema_drafts_select_own"
on public.schema_drafts for select
using (
  exists (
    select 1 from public.projects p
    where p.id = schema_drafts.project_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "schema_drafts_insert_own" on public.schema_drafts;
create policy "schema_drafts_insert_own"
on public.schema_drafts for insert
with check (
  exists (
    select 1 from public.projects p
    where p.id = schema_drafts.project_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "schema_drafts_update_own" on public.schema_drafts;
create policy "schema_drafts_update_own"
on public.schema_drafts for update
using (
  exists (
    select 1 from public.projects p
    where p.id = schema_drafts.project_id
      and p.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.projects p
    where p.id = schema_drafts.project_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "schema_drafts_delete_own" on public.schema_drafts;
create policy "schema_drafts_delete_own"
on public.schema_drafts for delete
using (
  exists (
    select 1 from public.projects p
    where p.id = schema_drafts.project_id
      and p.owner_id = auth.uid()
  )
);

