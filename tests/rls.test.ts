import { describe, expect, it } from 'vitest';
import { describeIf, env, jsonHeaders, missingEnv, randomUserId, signJwtHs256 } from './_utils';

// We need anon key for RLS requests, service role for bootstrap RPC, and JWT secret to mint user JWTs.
const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET'];
const missing = missingEnv(required);
const d = describeIf(missing.length === 0, describe);

d('rls: projects isolation', () => {
  it('prevents user B from reading user A rows', async () => {
    const supabaseUrl = env('SUPABASE_URL')!;
    const anonKey = env('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseJwtSecret = env('SUPABASE_JWT_SECRET')!;

    const restBase = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1`;

    // Ensure schema is installed before testing RLS.
    const installRes = await fetch(`${restBase}/rpc/bootstrap_install`, {
      method: 'POST',
      headers: jsonHeaders(serviceRoleKey, serviceRoleKey),
      body: JSON.stringify({}),
    });
    expect(installRes.ok).toBe(true);
    const installJson = (await installRes.json()) as any;
    expect(installJson?.success).toBe(true);

    const now = Math.floor(Date.now() / 1000);
    const exp = now + 60 * 30;

    const userA = randomUserId();
    const userB = randomUserId();

    const jwtA = signJwtHs256(
      { aud: 'authenticated', role: 'authenticated', sub: userA, iat: now, exp, email: 'a@example.invalid' },
      supabaseJwtSecret
    );
    const jwtB = signJwtHs256(
      { aud: 'authenticated', role: 'authenticated', sub: userB, iat: now, exp, email: 'b@example.invalid' },
      supabaseJwtSecret
    );

    // Insert with user A
    const name = `vitest_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const insertRes = await fetch(`${restBase}/projects?select=id,name`, {
      method: 'POST',
      headers: jsonHeaders(anonKey, jwtA),
      body: JSON.stringify({ name }),
    });
    expect(insertRes.ok).toBe(true);
    const inserted = (await insertRes.json()) as any[];
    expect(Array.isArray(inserted)).toBe(true);
    expect(inserted.length).toBe(1);
    const projectId = inserted[0]?.id as string;
    expect(typeof projectId).toBe('string');

    // Read with user A (should see it)
    const readARes = await fetch(`${restBase}/projects?select=id,name&id=eq.${encodeURIComponent(projectId)}`, {
      method: 'GET',
      headers: { apikey: anonKey, authorization: `Bearer ${jwtA}` },
    });
    expect(readARes.ok).toBe(true);
    const rowsA = (await readARes.json()) as any[];
    expect(rowsA.length).toBe(1);

    // Read with user B (should NOT see it)
    const readBRes = await fetch(`${restBase}/projects?select=id,name&id=eq.${encodeURIComponent(projectId)}`, {
      method: 'GET',
      headers: { apikey: anonKey, authorization: `Bearer ${jwtB}` },
    });
    expect(readBRes.ok).toBe(true);
    const rowsB = (await readBRes.json()) as any[];
    expect(rowsB.length).toBe(0);

    // Cleanup (best-effort): delete as user A (should succeed)
    await fetch(`${restBase}/projects?id=eq.${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
      headers: { apikey: anonKey, authorization: `Bearer ${jwtA}` },
    });
  });

  it('skips cleanly when env missing', () => {
    if (missing.length === 0) return;
    expect(missing.length).toBeGreaterThan(0);
  });
});

