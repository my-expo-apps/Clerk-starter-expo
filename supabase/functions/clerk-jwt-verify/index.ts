import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'npm:jose@5';

type Ok<T> = { success: true } & T;
type ErrCode =
  | 'invalid_body'
  | 'rate_limited'
  | 'env_missing'
  | 'jwt_invalid'
  | 'jwt_issuer_invalid'
  | 'jwt_audience_invalid'
  | 'user_create_failed'
  | 'session_create_failed'
  | 'internal_error';

type Err = { success: false; error: string; code: ErrCode };

type VerifyRequestBody = {
  clerkToken?: unknown;
};

type VerifyResponseBody =
  | Ok<{ session: { access_token: string; refresh_token: null } }>
  | Err;

function json(body: VerifyResponseBody, status = 200) {
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

function pickEmail(payload: Record<string, unknown>) {
  const candidates = [
    payload.email,
    payload.email_address,
    payload.primary_email_address,
    payload.preferred_username,
  ];
  for (const c of candidates) {
    if (isNonEmptyString(c) && c.includes('@')) return c;
  }
  return null;
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

// Short-lived session cache (avoid generating multiple sessions unnecessarily)
// (removed) session cache logic — custom JWT federation should mint fresh access tokens.

// Supabase auth.users.id is UUID. Clerk `sub` typically is not.
// For deterministic mapping we derive a UUID v5 from the Clerk user id.
// This makes the bridge clone-ready and avoids relying on email for identity.
function uuidV5FromString(name: string, namespaceUuid: string) {
  const nsBytes = uuidToBytes(namespaceUuid);
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(nsBytes.length + nameBytes.length);
  data.set(nsBytes, 0);
  data.set(nameBytes, nsBytes.length);

  return crypto.subtle.digest('SHA-1', data).then((hash) => {
    const bytes = new Uint8Array(hash).slice(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
    return bytesToUuid(bytes);
  });
}

function uuidToBytes(uuid: string) {
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToUuid(bytes: Uint8Array) {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

async function ensureAuthUser(
  supabaseAdmin: ReturnType<typeof createClient>,
  supabaseUserId: string,
  clerkUserId: string,
  payload: Record<string, unknown>
) {
  const emailFromJwt = pickEmail(payload);
  const email = emailFromJwt ?? `clerk+${clerkUserId}@example.invalid`;

  const meta = {
    ...(typeof payload === 'object' ? { clerk_iss: payload.iss } : null),
    clerk_user_id: clerkUserId,
  };

  const existing = await supabaseAdmin.auth.admin.getUserById(supabaseUserId);
  if (!existing.error && existing.data?.user) {
    return { email };
  }

  const created = await supabaseAdmin.auth.admin.createUser({
    id: supabaseUserId,
    email,
    email_confirm: true,
    user_metadata: meta,
    app_metadata: { provider: 'clerk' },
  });

  if (created.error) {
    // If it already exists (race), continue; otherwise surface clean error.
    const recheck = await supabaseAdmin.auth.admin.getUserById(supabaseUserId);
    if (!recheck.error && recheck.data?.user) return { email };
    throw new Error(`USER_CREATE_FAILED:${created.error.message}`);
  }

  return { email };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return json({ success: true, session: { access_token: '', refresh_token: null } }, 200);
  }

  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed', code: 'invalid_body' }, 405);
  }

  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip);
    if (!rl.ok) {
      return json({ success: false, error: 'rate_limited', code: 'rate_limited' }, 429);
    }

    const supabaseUrl = getEnv('SUPABASE_URL');
    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseJwtSecret = getEnv('SUPABASE_JWT_SECRET');
    const expectedIssuer = getEnv('CLERK_JWT_ISSUER');
    const expectedAudience = getEnv('CLERK_EXPECTED_AUDIENCE');
    const jwksUrl = Deno.env.get('CLERK_JWKS_URL') ?? `${expectedIssuer.replace(/\/+$/, '')}/.well-known/jwks.json`;

    const body = (await req.json()) as VerifyRequestBody;
    if (!isNonEmptyString(body.clerkToken)) {
      return json({ success: false, error: 'Invalid body. Expected { clerkToken: string }', code: 'invalid_body' }, 400);
    }

    const jwks = createRemoteJWKSet(new URL(jwksUrl));
    let verified;
    try {
      verified = await jwtVerify(body.clerkToken, jwks, {
        issuer: expectedIssuer,
        audience: expectedAudience,
      });
    } catch {
      return json({ success: false, error: 'jwt_invalid', code: 'jwt_invalid' }, 401);
    }

    const payload = verified.payload as Record<string, unknown>;
    const iss = payload.iss;
    if (iss !== expectedIssuer) {
      return json({ success: false, error: 'Invalid issuer', code: 'jwt_issuer_invalid' }, 401);
    }

    const clerkUserId = payload.sub;
    if (!isNonEmptyString(clerkUserId)) {
      return json({ success: false, error: 'Missing user_id', code: 'jwt_invalid' }, 401);
    }

    // Deterministic mapping (UUID v5 derived from Clerk user id)
    const namespace = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace UUID
    const supabaseUserId = await uuidV5FromString(clerkUserId, namespace);

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    let email: string;
    try {
      ({ email } = await ensureAuthUser(supabaseAdmin, supabaseUserId, clerkUserId, payload));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith('USER_CREATE_FAILED:')) {
        return json({ success: false, error: 'Failed to create user', code: 'user_create_failed' }, 500);
      }
      return json({ success: false, error: 'Internal error', code: 'internal_error' }, 500);
    }

    // Custom JWT federation: mint a Supabase-compatible JWT signed with SUPABASE_JWT_SECRET (HS256).
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 60 * 60; // 1 hour

    const accessToken = await new SignJWT({
      aud: 'authenticated',
      email,
      role: 'authenticated',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(supabaseUserId)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(new TextEncoder().encode(supabaseJwtSecret));

    return json(
      {
        success: true,
        session: {
          access_token: accessToken,
          refresh_token: null,
        },
      },
      200
    );
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.startsWith('Missing env:')) {
      return json({ success: false, error: 'Missing env', code: 'env_missing' }, 500);
    }
    return json({ success: false, error: 'Internal error', code: 'internal_error' }, 500);
  }
});

