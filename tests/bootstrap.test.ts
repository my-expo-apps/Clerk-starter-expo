import { describe, expect, it } from 'vitest';
import { describeIf, env, jsonHeaders, missingEnv } from './_utils';

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = missingEnv(required);
const d = describeIf(missing.length === 0, describe);

d('bootstrap: RPC installer + status', () => {
  it('bootstraps and reports ready === true', async () => {
    const supabaseUrl = env('SUPABASE_URL')!;
    const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY')!;
    const restBase = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1`;

    // Install (idempotent)
    const installRes = await fetch(`${restBase}/rpc/bootstrap_install`, {
      method: 'POST',
      headers: jsonHeaders(serviceRoleKey, serviceRoleKey),
      body: JSON.stringify({}),
    });
    expect(installRes.ok).toBe(true);
    const installJson = (await installRes.json()) as any;
    expect(installJson?.success).toBe(true);

    // Status
    const statusRes = await fetch(`${restBase}/rpc/bootstrap_status`, {
      method: 'POST',
      headers: jsonHeaders(serviceRoleKey, serviceRoleKey),
      body: JSON.stringify({}),
    });
    expect(statusRes.ok).toBe(true);
    const statusJson = (await statusRes.json()) as any;
    expect(statusJson?.success).toBe(true);
    expect(statusJson?.ready).toBe(true);
  });

  it('skips cleanly when env missing', () => {
    if (missing.length === 0) return;
    expect(missing.length).toBeGreaterThan(0);
  });
});

