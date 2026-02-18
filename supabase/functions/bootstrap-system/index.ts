import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';

type ErrCode = 'invalid_body' | 'env_missing' | 'jwt_invalid' | 'rate_limited' | 'bootstrap_failed' | 'internal_error';

type Ok =
  | { bootstrapped: true }
  | { already_initialized: true };

type Err = { success: false; code: ErrCode; error: string };

type ResponseBody = (Ok & { success: true }) | Err;

type ReqBody = { clerkToken?: unknown };

function json(body: ResponseBody, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
    },
  });
}

function getEnv(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function getClientIp(req: Request) {
  const h = req.headers;
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return h.get('cf-connecting-ip') || h.get('x-real-ip') || 'unknown';
}

// Basic per-IP rate limit (in-memory; edge-local)
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string) {
  const now = Date.now();
  const item = rateMap.get(ip);
  if (!item || now > item.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true };
  }
  if (item.count >= RATE_LIMIT_MAX) return { ok: false };
  item.count++;
  return { ok: true };
}

const RLS_BASE_SQL = `-- RLS Bootstrap Kit (Custom JWT Federation compatible)
create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key default auth.uid(),
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
on public.profiles for delete
to authenticated
using (auth.uid() = id);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_idx on public.projects(user_id);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

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
`;

async function tableExists(supabaseAdmin: ReturnType<typeof createClient>) {
  // Using RPC-free check. If the table doesn't exist, PostgREST will return an error.
  const res = await supabaseAdmin.from('projects').select('id').limit(1);
  if (!res.error) return true;
  const msg = res.error.message.toLowerCase();
  if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('not found')) return false;
  // Unknown error — treat as exists check failed.
  throw new Error(`TABLE_CHECK_FAILED:${res.error.message}`);
}

async function runSqlViaPgMeta(supabaseUrl: string, serviceRoleKey: string, sql: string) {
  // Supabase Studio uses the pg-meta API; in many projects this endpoint is available:
  // POST {SUPABASE_URL}/pg/meta/query  { query: "..." }
  const url = `${supabaseUrl.replace(/\/+$/, '')}/pg/meta/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SQL_EXEC_FAILED:${res.status}:${text}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ success: true, already_initialized: true }, 200);
  if (req.method !== 'POST') return json({ success: false, code: 'invalid_body', error: 'Method not allowed' }, 405);

  try {
    const ip = getClientIp(req);
    if (!checkRateLimit(ip).ok) {
      return json({ success: false, code: 'rate_limited', error: 'rate_limited' }, 429);
    }

    const supabaseUrl = getEnv('SUPABASE_URL');
    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    const expectedIssuer = getEnv('CLERK_JWT_ISSUER');
    const expectedAudience = getEnv('CLERK_EXPECTED_AUDIENCE');
    const jwksUrl = Deno.env.get('CLERK_JWKS_URL') ?? `${expectedIssuer.replace(/\/+$/, '')}/.well-known/jwks.json`;

    const body = (await req.json()) as ReqBody;
    if (!isNonEmptyString(body.clerkToken)) {
      return json({ success: false, code: 'invalid_body', error: 'Invalid body. Expected { clerkToken: string }' }, 400);
    }

    // Verify Clerk JWT (only allow authenticated calls)
    const jwks = createRemoteJWKSet(new URL(jwksUrl));
    try {
      await jwtVerify(body.clerkToken, jwks, { issuer: expectedIssuer, audience: expectedAudience });
    } catch {
      return json({ success: false, code: 'jwt_invalid', error: 'jwt_invalid' }, 401);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const exists = await tableExists(supabaseAdmin);
    if (exists) return json({ success: true, already_initialized: true }, 200);

    // Bootstrap: execute base SQL
    await runSqlViaPgMeta(supabaseUrl, serviceRoleKey, RLS_BASE_SQL);
    return json({ success: true, bootstrapped: true }, 200);
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.startsWith('Missing env:')) {
      return json({ success: false, code: 'env_missing', error: 'Missing env' }, 500);
    }
    if (msg.startsWith('SQL_EXEC_FAILED:') || msg.startsWith('TABLE_CHECK_FAILED:')) {
      return json({ success: false, code: 'bootstrap_failed', error: msg }, 500);
    }
    return json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
  }
});

