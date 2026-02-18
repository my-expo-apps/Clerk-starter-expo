import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';

type ErrCode = 'invalid_body' | 'env_missing' | 'jwt_invalid' | 'rate_limited' | 'bootstrap_rpc_missing' | 'status_failed' | 'internal_error';
type ResponseBody =
  | { success: true; status: unknown }
  | { success: false; code: ErrCode; error: string };

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ success: true, status: null }, 200);
  if (req.method !== 'POST') return json({ success: false, code: 'invalid_body', error: 'Method not allowed' }, 405);

  try {
    const ip = getClientIp(req);
    if (!checkRateLimit(ip).ok) return json({ success: false, code: 'rate_limited', error: 'rate_limited' }, 429);

    const supabaseUrl = getEnv('SUPABASE_URL');
    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    const expectedIssuer = getEnv('CLERK_JWT_ISSUER');
    const expectedAudience = getEnv('CLERK_EXPECTED_AUDIENCE');
    const jwksUrl = Deno.env.get('CLERK_JWKS_URL') ?? `${expectedIssuer.replace(/\/+$/, '')}/.well-known/jwks.json`;

    const body = (await req.json()) as ReqBody;
    if (!isNonEmptyString(body.clerkToken)) {
      return json({ success: false, code: 'invalid_body', error: 'Invalid body. Expected { clerkToken: string }' }, 400);
    }

    const jwks = createRemoteJWKSet(new URL(jwksUrl));
    try {
      await jwtVerify(body.clerkToken, jwks, { issuer: expectedIssuer, audience: expectedAudience });
    } catch {
      return json({ success: false, code: 'jwt_invalid', error: 'jwt_invalid' }, 401);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const res = await supabaseAdmin.rpc('bootstrap_status');
    if (res.error) {
      const lower = res.error.message.toLowerCase();
      const rpcMissing = lower.includes('bootstrap_status') && (lower.includes('could not find') || lower.includes('not found'));
      if (rpcMissing) {
        return json({ success: false, code: 'bootstrap_rpc_missing', error: 'bootstrap_rpc_missing' }, 500);
      }
      return json({ success: false, code: 'status_failed', error: res.error.message }, 500);
    }

    return json({ success: true, status: res.data }, 200);
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.startsWith('Missing env:')) return json({ success: false, code: 'env_missing', error: 'Missing env' }, 500);
    return json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
  }
});

