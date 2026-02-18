import type { ValidationLogEntry } from '@/services/connection-validator';

export type DiagnosticResult = {
  connection: boolean;
  schemaReady: boolean;
  rpcInstalled: boolean;
  bridgeReady: boolean;
  errorCode?: string;
  errorMessage?: string;
  checks: {
    host: { ok: boolean; ms: number; error?: string };
    edgeClerkVerify: { ok: boolean; ms: number; error?: string };
    edgeBootstrapSystem: { ok: boolean; ms: number; error?: string };
    rpcStatus: { ok: boolean; ms: number; error?: string; status?: any };
    supabaseJwt: { ok: boolean; ms: number; error?: string };
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

export async function testHost(params: { supabaseUrl: string; onLog?: LogFn }) {
  const url = `${trimSlash(params.supabaseUrl)}/auth/v1/health`;
  log(params.onLog, 'info', 'Testing Supabase host…');
  const res = await fetchJsonWithTimeout<any>(url, { method: 'GET' });
  return {
    ok: res.ok,
    ms: res.ms,
    error: res.ok ? undefined : res.error,
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
    error: ok ? undefined : res.ok ? JSON.stringify((res.data as any)?.error ?? res.data) : res.error,
    data: res.ok ? res.data : undefined,
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

  if (!res.ok) return { ok: false, ms: res.ms, error: res.error };
  const status = (res.data as any)?.status;
  const rpcOk = (res.data as any)?.success === true && !!status;
  return { ok: rpcOk, ms: res.ms, error: rpcOk ? undefined : 'rpc_status_failed', status };
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
  let supabaseJwt: { ok: boolean; ms: number; error?: string } = { ok: false, ms: 0, error: 'bridge_not_attempted' };
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
      supabaseJwt = { ok: res.ok, ms: res.ms, error: res.ok ? undefined : res.error };
    } else {
      supabaseJwt = { ok: false, ms: edgeClerkVerify.ms, error: 'missing_access_token' };
    }
  }

  const connection = host.ok;
  const rpcInstalled = rpcStatus.ok;
  const schemaReady =
    rpcInstalled && rpcStatus.status?.tables
      ? rpcStatus.status.tables.projects === true && rpcStatus.status.tables.profiles === true
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
      edgeClerkVerify: { ok: edgeClerkVerify.ok, ms: edgeClerkVerify.ms, error: edgeClerkVerify.error },
      edgeBootstrapSystem: { ok: edgeBootstrapSystem.ok, ms: edgeBootstrapSystem.ms, error: edgeBootstrapSystem.error },
      rpcStatus: { ok: rpcStatus.ok, ms: rpcStatus.ms, error: rpcStatus.error, status: rpcStatus.status },
      supabaseJwt,
    },
  };
}

