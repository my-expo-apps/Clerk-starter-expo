export type FriendlyError = {
  code:
    | 'supabase_unreachable'
    | 'edge_not_deployed'
    | 'rpc_missing'
    | 'invalid_clerk_issuer'
    | 'jwt_signature_mismatch'
    | 'unknown';
  message: string;
};

export function mapKnownFailure(input: { message?: string; kind?: string; status?: number } | string): FriendlyError | null {
  const msg = typeof input === 'string' ? input : input.message ?? '';
  const kind = typeof input === 'string' ? '' : input.kind ?? '';
  const status = typeof input === 'string' ? undefined : input.status;

  const hay = `${kind} ${status ?? ''} ${msg}`.toLowerCase();

  if (
    hay.includes('supabase_unreachable') ||
    hay.includes('enotfound') ||
    hay.includes('econnrefused') ||
    hay.includes('fetch failed') ||
    hay.includes('network') ||
    hay.includes('timeout')
  ) {
    return { code: 'supabase_unreachable', message: 'Supabase is not reachable. Check SUPABASE_URL and network/DNS.' };
  }

  if (hay.includes('not_deployed') || (typeof status === 'number' && status === 404) || hay.includes('404')) {
    return { code: 'edge_not_deployed', message: 'Edge function is not deployed (404). Deploy via: supabase functions deploy <name>' };
  }

  if (hay.includes('bootstrap_rpc_missing') || hay.includes('rpc_missing') || hay.includes('function') && hay.includes('does not exist')) {
    return { code: 'rpc_missing', message: 'Bootstrap RPC is missing. Run: supabase db push' };
  }

  if (hay.includes('clerk_jwt_issuer') && hay.includes('not a valid url')) {
    return { code: 'invalid_clerk_issuer', message: 'Invalid Clerk issuer URL. Check CLERK_JWT_ISSUER.' };
  }

  if (hay.includes('jwt') && (hay.includes('signature') || hay.includes('jwks') || hay.includes('kid'))) {
    return { code: 'jwt_signature_mismatch', message: 'JWT signature mismatch. Check Clerk issuer/JWKS and token audience.' };
  }

  return null;
}

