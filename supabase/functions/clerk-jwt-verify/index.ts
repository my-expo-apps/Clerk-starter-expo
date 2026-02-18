import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';

type Ok<T> = { success: true } & T;
type Err = { success: false; error: string };

type VerifyRequestBody = {
  clerkToken?: unknown;
};

type VerifyResponseBody =
  | Ok<{ session: { access_token: string; refresh_token: string } }>
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

async function findUserByEmail(
  supabaseAdmin: ReturnType<typeof createClient>,
  email: string
): Promise<{ id: string } | null> {
  // Best-effort lookup via listUsers pagination.
  // This avoids needing additional DB tables while keeping behavior deterministic for small projects.
  for (let page = 1; page <= 10; page++) {
    const res = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (res.error) return null;
    const found = res.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return { id: found.id };
    if (res.data.users.length < 200) break;
  }
  return null;
}

async function ensureAuthUser(
  supabaseAdmin: ReturnType<typeof createClient>,
  clerkUserId: string,
  payload: Record<string, unknown>
) {
  const emailFromJwt = pickEmail(payload);
  const email = emailFromJwt ?? `clerk+${clerkUserId}@example.invalid`;

  const meta = {
    ...(typeof payload === 'object' ? { clerk_iss: payload.iss } : null),
    clerk_user_id: clerkUserId,
  };

  const existing = await findUserByEmail(supabaseAdmin, email);
  if (existing) {
    await supabaseAdmin.auth.admin.updateUserById(existing.id, { user_metadata: meta });
    return { email };
  }

  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: meta,
    app_metadata: { provider: 'clerk' },
  });

  if (created.error) {
    // If a user already exists but listUsers didn't find it (race / pagination), we still proceed.
    return { email };
  }

  return { email };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return json({ success: true, session: { access_token: '', refresh_token: '' } }, 200);
  }

  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    const supabaseUrl = getEnv('SUPABASE_URL');
    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    const expectedIssuer = getEnv('CLERK_JWT_ISSUER');
    const jwksUrl = Deno.env.get('CLERK_JWKS_URL') ?? `${expectedIssuer.replace(/\/+$/, '')}/.well-known/jwks.json`;

    const body = (await req.json()) as VerifyRequestBody;
    if (!isNonEmptyString(body.clerkToken)) {
      return json({ success: false, error: 'Invalid body. Expected { clerkToken: string }' }, 400);
    }

    const jwks = createRemoteJWKSet(new URL(jwksUrl));
    const verified = await jwtVerify(body.clerkToken, jwks, {
      issuer: expectedIssuer,
    });

    const payload = verified.payload as Record<string, unknown>;
    const iss = payload.iss;
    if (iss !== expectedIssuer) {
      return json({ success: false, error: 'Invalid issuer' }, 401);
    }

    const clerkUserId = payload.sub;
    if (!isNonEmptyString(clerkUserId)) {
      return json({ success: false, error: 'Missing user_id' }, 401);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { email } = await ensureAuthUser(supabaseAdmin, clerkUserId, payload);

    // Create a Supabase session by generating a magiclink token and verifying it server-side.
    const link = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: 'https://example.invalid' },
    });

    if (link.error) {
      return json({ success: false, error: `Failed to generate link: ${link.error.message}` }, 500);
    }

    const tokenHash =
      (link.data as any)?.properties?.hashed_token ??
      (link.data as any)?.properties?.hashedToken ??
      null;

    if (!isNonEmptyString(tokenHash)) {
      return json({ success: false, error: 'Missing token hash from generateLink' }, 500);
    }

    const verifiedOtp = await supabaseAdmin.auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    } as any);

    if (verifiedOtp.error || !verifiedOtp.data?.session) {
      return json(
        {
          success: false,
          error: verifiedOtp.error?.message ?? 'Failed to create session',
        },
        500
      );
    }

    const session = verifiedOtp.data.session;
    if (!session.access_token || !session.refresh_token) {
      return json({ success: false, error: 'Session missing tokens' }, 500);
    }

    return json({
      success: true,
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      },
    });
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 500);
  }
});

