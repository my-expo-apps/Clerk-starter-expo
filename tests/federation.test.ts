import { describe, expect, it } from 'vitest';
import {
  CLERK_UUIDV5_NAMESPACE_DNS,
  decodeJwtNoVerify,
  describeIf,
  env,
  isUuid,
  missingEnv,
  uuidv5_node,
  verifyHs256,
} from './_utils';

const required = ['SUPABASE_URL', 'SUPABASE_JWT_SECRET', 'CLERK_TEST_JWT'];
const missing = missingEnv(required);
const d = describeIf(missing.length === 0, describe);

d('federation: clerk-jwt-verify edge function', () => {
  it('returns a Supabase JWT with expected claims + valid HS256 signature', async () => {
    const supabaseUrl = env('SUPABASE_URL')!;
    const supabaseJwtSecret = env('SUPABASE_JWT_SECRET')!;
    const clerkTestJwt = env('CLERK_TEST_JWT')!;

    const apiKey = env('SUPABASE_ANON_KEY') ?? env('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    expect(apiKey.length).toBeGreaterThan(0);

    const { payload: clerkPayload } = decodeJwtNoVerify(clerkTestJwt);
    const clerkUserId = clerkPayload?.sub;
    expect(typeof clerkUserId).toBe('string');
    expect((clerkUserId as string).length).toBeGreaterThan(0);

    const expectedSupabaseUserId = uuidv5_node(clerkUserId as string, CLERK_UUIDV5_NAMESPACE_DNS);
    expect(isUuid(expectedSupabaseUserId)).toBe(true);

    const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/clerk-jwt-verify`, {
      method: 'POST',
      headers: {
        apikey: apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ clerkToken: clerkTestJwt }),
    });

    expect(res.ok).toBe(true);
    const json = (await res.json()) as any;
    expect(json?.success).toBe(true);
    expect(typeof json?.session?.access_token).toBe('string');

    const accessToken = json.session.access_token as string;
    expect(accessToken.split('.').length).toBe(3);
    expect(verifyHs256(accessToken, supabaseJwtSecret)).toBe(true);

    const { header, payload } = decodeJwtNoVerify(accessToken);
    expect(header?.alg).toBe('HS256');
    expect(payload?.aud).toBe('authenticated');
    expect(payload?.role).toBe('authenticated');
    expect(payload?.sub).toBe(expectedSupabaseUserId);
    expect(typeof payload?.exp).toBe('number');
    expect(typeof payload?.iat).toBe('number');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('skips cleanly when env missing', () => {
    if (missing.length === 0) return;
    expect(missing.length).toBeGreaterThan(0);
  });
});

