/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

type Check = { name: string; ok: boolean; detail?: string };

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length ? v.trim() : null;
}

async function loadDotEnvIfPresent() {
  const rootEnv = path.join(process.cwd(), '.env');
  if (!fs.existsSync(rootEnv)) return;

  // Lazy import so repo doesn’t require dotenv at runtime unless using this script.
  const dotenv = await import('dotenv');
  dotenv.config({ path: rootEnv });
}

function mark(checks: Check[], name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
}

async function fetchJson(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { res, data };
}

async function main() {
  await loadDotEnvIfPresent();

  const checks: Check[] = [];

  const supabaseUrl = env('SUPABASE_URL');
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = env('SUPABASE_ANON_KEY') ?? serviceRoleKey;
  const clerkTestJwt = env('CLERK_TEST_JWT'); // optional

  const hasEnv = !!supabaseUrl && !!serviceRoleKey;
  mark(checks, 'CLI env present? (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)', hasEnv, hasEnv ? undefined : 'missing env');

  // App-side note only (no secrets on CLI)
  mark(checks, 'Runtime config present? (set inside app)', true, 'N/A (in-app runtime secrets UI)');

  if (!supabaseUrl || !serviceRoleKey) {
    printReport(checks);
    process.exit(1);
  }

  const functionsBase = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1`;
  const restBase = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1`;

  // Edge reachability checks (OPTIONS should not require auth)
  {
    const url = `${functionsBase}/bootstrap-system`;
    try {
      const res = await fetch(url, {
        method: 'OPTIONS',
        headers: { apikey: anonKey ?? '' },
      });
      mark(checks, 'Edge function reachable? bootstrap-system', res.ok, res.ok ? undefined : `HTTP ${res.status}`);
    } catch (e) {
      mark(checks, 'Edge function reachable? bootstrap-system', false, (e as Error).message);
    }
  }

  {
    const url = `${functionsBase}/clerk-jwt-verify`;
    try {
      const res = await fetch(url, {
        method: 'OPTIONS',
        headers: { apikey: anonKey ?? '' },
      });
      mark(checks, 'Edge function reachable? clerk-jwt-verify', res.ok, res.ok ? undefined : `HTTP ${res.status}`);
    } catch (e) {
      mark(checks, 'Edge function reachable? clerk-jwt-verify', false, (e as Error).message);
    }
  }

  // Optional: attempt bootstrap via Edge (requires a valid Clerk JWT)
  if (clerkTestJwt) {
    const url = `${functionsBase}/bootstrap-system`;
    try {
      const { res, data } = await fetchJson(url, {
        method: 'POST',
        headers: {
          apikey: anonKey ?? '',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ clerkToken: clerkTestJwt }),
      });
      const ok = res.ok && typeof data === 'object' && data !== null && (data as any).success === true;
      mark(checks, 'Bootstrap via Edge (CLERK_TEST_JWT)', ok, ok ? undefined : `HTTP ${res.status}`);
    } catch (e) {
      mark(checks, 'Bootstrap via Edge (CLERK_TEST_JWT)', false, (e as Error).message);
    }
  } else {
    mark(checks, 'Bootstrap via Edge (CLERK_TEST_JWT)', true, 'skipped (no CLERK_TEST_JWT)');
  }

  // RPC existence: bootstrap_install
  {
    const url = `${restBase}/rpc/bootstrap_install`;
    try {
      const { res, data } = await fetchJson(url, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const ok =
        res.ok && typeof data === 'object' && data !== null && (data as any).success === true;
      mark(checks, 'RPC exists? bootstrap_install()', ok, ok ? undefined : `HTTP ${res.status}`);
    } catch (e) {
      mark(checks, 'RPC exists? bootstrap_install()', false, (e as Error).message);
    }
  }

  // RPC existence + DB readiness: bootstrap_status
  let ready = false;
  {
    const url = `${restBase}/rpc/bootstrap_status`;
    try {
      const { res, data } = await fetchJson(url, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const ok = res.ok && typeof data === 'object' && data !== null && (data as any).success === true;
      mark(checks, 'RPC exists? bootstrap_status()', ok, ok ? undefined : `HTTP ${res.status}`);

      if (ok) {
        ready = (data as any).ready === true;
        mark(checks, 'DB ready? (bootstrap_status.ready)', ready, ready ? undefined : 'not ready');
      } else {
        mark(checks, 'DB ready? (bootstrap_status.ready)', false, 'bootstrap_status unavailable');
      }
    } catch (e) {
      mark(checks, 'RPC exists? bootstrap_status()', false, (e as Error).message);
      mark(checks, 'DB ready? (bootstrap_status.ready)', false, 'bootstrap_status unavailable');
    }
  }

  printReport(checks);
  process.exit(ready ? 0 : 1);
}

function printReport(checks: Check[]) {
  for (const c of checks) {
    const icon = c.ok ? '✔' : '✖';
    const suffix = c.detail ? ` — ${c.detail}` : '';
    console.log(`${icon} ${c.name}${suffix}`);
  }
}

main().catch((e) => {
  console.error('✖ validate: unexpected error');
  console.error((e as Error).message);
  process.exit(1);
});

