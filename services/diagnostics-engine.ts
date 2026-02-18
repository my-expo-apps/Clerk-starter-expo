import type { ValidationLogEntry } from '@/services/connection-validator';

export type DiagnosticResult = {
  connection: boolean;
  schemaReady: boolean;
  rpcInstalled: boolean;
  bridgeReady: boolean;
  errorCode?: string;
  errorMessage?: string;
  checks: {
    host: { ok: boolean; ms: number; status?: number; error?: string; kind?: 'ok' | 'timeout' | 'not_deployed' | 'http_error' | 'unknown' };
    edgeClerkVerify: { ok: boolean; ms: number; status?: number; error?: string; kind?: 'ok' | 'timeout' | 'not_deployed' | 'http_error' | 'unknown' };
    edgeBootstrapSystem: { ok: boolean; ms: number; status?: number; error?: string; kind?: 'ok' | 'timeout' | 'not_deployed' | 'http_error' | 'unknown' };
    rpcStatus: { ok: boolean; ms: number; status?: number; error?: string; kind?: 'ok' | 'timeout' | 'not_deployed' | 'bootstrap_rpc_missing' | 'http_error' | 'unknown'; statusObj?: any };
    supabaseJwt: { ok: boolean; ms: number; status?: number; error?: string; kind?: 'ok' | 'timeout' | 'http_error' | 'unknown' };
  };
};

type LogFn = (entry: ValidationLogEntry) => void;

type FetchResult<T> =
  | { ok: true; ms: number; status: number; data: T }
  | { ok: false; ms: number; status?: number; error: string };

const TIMEOUT_MS = 3000;

function log(onLog: LogFn | undefined, level: ValidationLogEntry['level'], message: string) {
  onLog?.({ ts: Date.now(), level, message });
}

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<FetchResult<T>> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const ms = Date.now() - start;
    const text = await res.text().catch(() => '');
    let data: T = null as T;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = text as unknown as T;
      }
    }
    if (!res.ok) return { ok: false, ms, status: res.status, error: typeof (data as any)?.error === 'string' ? (data as any).error : `HTTP ${res.status}` };
    return { ok: true, ms, status: res.status, data };
  } catch (e) {
    const ms = Date.now() - start;
    const name = (e as Error)?.name;
    if (name === 'AbortError') return { ok: false, ms, error: 'timeout' };
    return { ok: false, ms, error: (e as Error).message };
  } finally {
    clearTimeout(id);
  }
}

function trimSlash(url: string) {
  return url.replace(/\/+$/, '');
}

function classify(res: { ok: boolean; status?: number; error?: string }) {
  if (res.ok) return { kind: 'ok' as const };
  if (res.error === 'timeout') return { kind: 'timeout' as const };
  if (res.status === 404) return { kind: 'not_deployed' as const };
  if (typeof res.status === 'number') return { kind: 'http_error' as const };
  return { kind: 'unknown' as const };
}

export async function testHost(params: { supabaseUrl: string; onLog?: LogFn }) {
  const url = `${trimSlash(params.supabaseUrl)}/auth/v1/health`;
  log(params.onLog, 'info', 'Testing Supabase host…');
  const res = await fetchJsonWithTimeout<any>(url, { method: 'GET' });
  return {
    ok: res.ok,
    ms: res.ms,
    status: res.ok ? res.status : res.status,
    error: res.ok ? undefined : res.error,
    ...classify({ ok: res.ok, status: res.ok ? res.status : res.status, error: res.ok ? undefined : res.error }),
  };
}

export async function testEdgeFunction(params: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  name: string;
  method?: 'POST' | 'OPTIONS';
  body?: unknown;
  onLog?: LogFn;
}) {
  const url = `${trimSlash(params.supabaseUrl)}/functions/v1/${params.name}`;
  log(params.onLog, 'info', `Testing Edge function: ${params.name}…`);
  const res = await fetchJsonWithTimeout<any>(url, {
    method: params.method ?? 'POST',
    headers: {
      apikey: params.supabaseAnonKey,
      'content-type': 'application/json',
    },
    ...(params.method === 'OPTIONS' ? null : { body: JSON.stringify(params.body ?? {}) }),
  });

  // Edge functions in this repo generally return { success: false, error, code } on failure.
  const successField = res.ok ? (res.data as any)?.success : null;
  const ok = res.ok && (successField === true || successField === undefined);
  return {
    ok,
    ms: res.ms,
    status: res.ok ? res.status : res.status,
    error: ok ? undefined : res.ok ? JSON.stringify((res.data as any)?.error ?? res.data) : res.error,
    data: res.ok ? res.data : undefined,
    ...classify({ ok, status: res.ok ? res.status : res.status, error: ok ? undefined : res.ok ? undefined : res.error }),
  };
}

export async function testRpc(params: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  clerkToken: string;
  onLog?: LogFn;
}) {
  // We call the stable Edge wrapper which uses service_role server-side.
  const res = await testEdgeFunction({
    supabaseUrl: params.supabaseUrl,
    supabaseAnonKey: params.supabaseAnonKey,
    name: 'bootstrap-status',
    body: { clerkToken: params.clerkToken },
    onLog: params.onLog,
  });

  if (!res.ok) {
    return { ok: false, ms: res.ms, status: res.status, error: res.error, ...classify({ ok: false, status: res.status, error: res.error }) };
  }
  const statusObj = (res.data as any)?.status;
  const ok = (res.data as any)?.success === true && !!statusObj;
  const kind =
    (res.data as any)?.code === 'bootstrap_rpc_missing' ? ('bootstrap_rpc_missing' as const) : ok ? ('ok' as const) : ('unknown' as const);
  return { ok, ms: res.ms, status: res.status, error: ok ? undefined : 'rpc_status_failed', kind, statusObj };
}

export async function runDiagnostics(params: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  clerkToken?: string | null;
  onLog?: LogFn;
}): Promise<DiagnosticResult> {
  const host = await testHost({ supabaseUrl: params.supabaseUrl, onLog: params.onLog });

  const edgeClerkVerify = params.clerkToken
    ? await testEdgeFunction({
        supabaseUrl: params.supabaseUrl,
        supabaseAnonKey: params.supabaseAnonKey,
        name: 'clerk-jwt-verify',
        body: { clerkToken: params.clerkToken },
        onLog: params.onLog,
      })
    : { ok: false, ms: 0, error: 'clerk_token_missing' as const, data: undefined };

  // RPC status (bootstrap_status) via Edge wrapper
  const rpcStatus = params.clerkToken
    ? await testRpc({
        supabaseUrl: params.supabaseUrl,
        supabaseAnonKey: params.supabaseAnonKey,
        clerkToken: params.clerkToken,
        onLog: params.onLog,
      })
    : { ok: false, ms: 0, error: 'clerk_token_missing' as const, status: undefined };

  // Can we reach bootstrap-system without executing it? (use OPTIONS)
  const edgeBootstrapSystem = params.clerkToken
    ? await testEdgeFunction({
        supabaseUrl: params.supabaseUrl,
        supabaseAnonKey: params.supabaseAnonKey,
        name: 'bootstrap-system',
        method: 'OPTIONS',
        onLog: params.onLog,
      })
    : { ok: false, ms: 0, error: 'clerk_token_missing' as const, data: undefined };

  // Verify minted Supabase JWT actually works against Supabase Auth API
  let supabaseJwt: { ok: boolean; ms: number; status?: number; error?: string; kind?: 'ok' | 'timeout' | 'http_error' | 'unknown' } = {
    ok: false,
    ms: 0,
    error: 'bridge_not_attempted',
    kind: 'unknown',
  };
  if (edgeClerkVerify.ok) {
    const accessToken = (edgeClerkVerify.data as any)?.session?.access_token as string | undefined;
    if (accessToken) {
      log(params.onLog, 'info', 'Validating minted Supabase JWT…');
      const url = `${trimSlash(params.supabaseUrl)}/auth/v1/user`;
      const res = await fetchJsonWithTimeout<any>(
        url,
        {
          method: 'GET',
          headers: {
            apikey: params.supabaseAnonKey,
            authorization: `Bearer ${accessToken}`,
          },
        },
        TIMEOUT_MS
      );
      supabaseJwt = {
        ok: res.ok,
        ms: res.ms,
        status: res.ok ? res.status : res.status,
        error: res.ok ? undefined : res.error,
        ...classify({ ok: res.ok, status: res.ok ? res.status : res.status, error: res.ok ? undefined : res.error }),
      };
    } else {
      supabaseJwt = { ok: false, ms: edgeClerkVerify.ms, error: 'missing_access_token', kind: 'unknown' };
    }
  }

  const connection = host.ok;
  const rpcInstalled = rpcStatus.ok;
  const schemaReady =
    rpcInstalled && rpcStatus.statusObj?.tables
      ? rpcStatus.statusObj.tables.projects === true && rpcStatus.statusObj.tables.profiles === true
      : false;
  const bridgeReady = supabaseJwt.ok;

  const errorCode =
    !connection
      ? 'supabase_unreachable'
      : !params.clerkToken
        ? 'clerk_token_missing'
        : !rpcInstalled && (rpcStatus.error === 'bootstrap_rpc_missing' || (rpcStatus as any)?.code === 'bootstrap_rpc_missing')
          ? 'bootstrap_rpc_missing'
          : undefined;

  const errorMessage =
    errorCode === 'bootstrap_rpc_missing'
      ? 'Run: supabase db push'
      : errorCode === 'clerk_token_missing'
        ? 'Sign in first so the app can fetch a Clerk token.'
        : errorCode === 'supabase_unreachable'
          ? 'Supabase host is unreachable.'
          : undefined;

  return {
    connection,
    schemaReady,
    rpcInstalled,
    bridgeReady,
    errorCode,
    errorMessage,
    checks: {
      host,
      edgeClerkVerify,
      edgeBootstrapSystem,
      rpcStatus,
      supabaseJwt,
    },
  };
}

