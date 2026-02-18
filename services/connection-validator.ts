import { getRuntimeConfig } from '@/lib/runtime-config';
import { runDiagnostics, type DiagnosticResult } from '@/services/diagnostics-engine';

export type SystemValidationResult = {
  connection: boolean;
  schemaReady: boolean;
  rpcInstalled: boolean;
  bridgeReady: boolean;
  errorCode?: string;
  errorMessage?: string;
  checks?: DiagnosticResult['checks'];
};

export type ValidationLogEntry = {
  ts: number;
  level: 'info' | 'warn' | 'error';
  message: string;
};

type ValidateOptions = {
  onLog?: (entry: ValidationLogEntry) => void;
};

// Optional token provider, set by SystemStatusContext when Clerk is available.
let clerkTokenProvider: null | (() => Promise<string | null>) = null;

export function setClerkTokenProvider(provider: null | (() => Promise<string | null>)) {
  clerkTokenProvider = provider;
}

function log(opts: ValidateOptions | undefined, level: ValidationLogEntry['level'], message: string) {
  opts?.onLog?.({ ts: Date.now(), level, message });
}

function looksLikeMissingTable(message: string) {
  const msg = message.toLowerCase();
  return msg.includes('does not exist') || msg.includes('relation') || msg.includes('not found');
}

export async function initializeDatabase(opts?: ValidateOptions): Promise<{ ok: boolean; errorCode?: string; errorMessage?: string }> {
  const cfg = await getRuntimeConfig();
  if (!cfg) return { ok: false, errorCode: 'not_configured', errorMessage: 'System not configured.' };

  const token = clerkTokenProvider ? await clerkTokenProvider() : null;
  if (!token) return { ok: false, errorCode: 'clerk_token_missing', errorMessage: 'Sign in first to initialize.' };

  try {
    log(opts, 'info', 'Calling bootstrap-system…');

    // Use direct Edge call with 3s timeout semantics via diagnostics engine helper.
    const baseUrl = cfg.supabase_url;
    const anonKey = cfg.supabase_anon_key;
    const url = `${baseUrl.replace(/\/+$/, '')}/functions/v1/bootstrap-system`;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 3000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { apikey: anonKey, 'content-type': 'application/json' },
        body: JSON.stringify({ clerkToken: token }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(id);
    }

    const text = await res.text().catch(() => '');
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok || !data) {
      const msg = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`;
      const lower = msg.toLowerCase();
      const rpcMissing =
        lower.includes('bootstrap_install') &&
        (lower.includes('could not find') || lower.includes('not found') || lower.includes('pgrst202'));
      if (rpcMissing) return { ok: false, errorCode: 'bootstrap_rpc_missing', errorMessage: 'Run: supabase db push' };
      return { ok: false, errorCode: 'bootstrap_failed', errorMessage: msg };
    }

    const ok = data.success === true && (data.bootstrapped === true || data.already_initialized === true);
    if (!ok) return { ok: false, errorCode: 'bootstrap_failed', errorMessage: 'bootstrap_failed' };
    return { ok: true };
  } catch (e) {
    return { ok: false, errorCode: 'bootstrap_failed', errorMessage: (e as Error).message };
  }
}

export async function validateSystemConnection(opts?: ValidateOptions): Promise<SystemValidationResult> {
  const cfg = await getRuntimeConfig();
  if (!cfg) {
    return {
      connection: false,
      schemaReady: false,
      rpcInstalled: false,
      bridgeReady: false,
      errorCode: 'not_configured',
      errorMessage: 'System not configured.',
    };
  }

  try {
    const token = clerkTokenProvider ? await clerkTokenProvider() : null;
    const diag = await runDiagnostics({
      supabaseUrl: cfg.supabase_url,
      supabaseAnonKey: cfg.supabase_anon_key,
      clerkToken: token,
      onLog: opts?.onLog,
    });

    return {
      connection: diag.connection,
      schemaReady: diag.schemaReady,
      rpcInstalled: diag.rpcInstalled,
      bridgeReady: diag.bridgeReady,
      errorCode: diag.errorCode,
      errorMessage: diag.errorMessage,
      checks: diag.checks,
    };
  } catch (e) {
    return {
      connection: false,
      schemaReady: false,
      rpcInstalled: false,
      bridgeReady: false,
      errorCode: 'unexpected_error',
      errorMessage: (e as Error).message,
    };
  }
}

