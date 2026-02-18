import { createSupabaseClientFromRuntime } from '@/lib/supabase';
import { getRuntimeConfig } from '@/lib/runtime-config';

export type SystemValidationResult = {
  connection: boolean;
  schemaReady: boolean;
  rpcInstalled: boolean;
  bridgeReady: boolean;
  errorCode?: string;
  errorMessage?: string;
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
    const supabase = await createSupabaseClientFromRuntime();
    log(opts, 'info', 'Calling bootstrap-system…');

    const boot = await supabase.functions.invoke('bootstrap-system', { body: { clerkToken: token } });
    if (boot.error) {
      const lower = (boot.error.message ?? '').toLowerCase();
      const rpcMissing =
        lower.includes('bootstrap_install') &&
        (lower.includes('could not find') || lower.includes('not found') || lower.includes('pgrst202'));
      if (rpcMissing) {
        return { ok: false, errorCode: 'bootstrap_rpc_missing', errorMessage: 'Run: supabase db push' };
      }
      return { ok: false, errorCode: 'bootstrap_failed', errorMessage: boot.error.message };
    }

    const data = boot.data as any;
    const ok = data && data.success === true && (data.bootstrapped === true || data.already_initialized === true);
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
    log(opts, 'info', 'Creating Supabase client…');
    const supabase = await createSupabaseClientFromRuntime();

    log(opts, 'info', 'Checking Supabase connection…');
    const sessionRes = await supabase.auth.getSession();
    if (sessionRes.error) {
      return {
        connection: false,
        schemaReady: false,
        rpcInstalled: false,
        bridgeReady: false,
        errorCode: 'supabase_connection_failed',
        errorMessage: sessionRes.error.message,
      };
    }

    // Best-effort schema existence check (no secrets, no side effects)
    log(opts, 'info', 'Checking schema tables…');
    const projectsRes = await supabase.from('projects').select('id').limit(1);
    const profilesRes = await supabase.from('profiles').select('id').limit(1);

    const projectsExists = !projectsRes.error || !looksLikeMissingTable(projectsRes.error.message);
    const profilesExists = !profilesRes.error || !looksLikeMissingTable(profilesRes.error.message);
    let schemaReady = projectsExists && profilesExists;

    // Clerk token presence (used for Edge introspection + bridge)
    const token = clerkTokenProvider ? await clerkTokenProvider() : null;

    // RPC installed + canonical readiness (via Edge -> service_role -> bootstrap_status)
    let rpcInstalled = false;
    if (token) {
      log(opts, 'info', 'Checking bootstrap RPC status…');
      const statusInvoke = await supabase.functions.invoke('bootstrap-status', { body: { clerkToken: token } });
      if (statusInvoke.error) {
        rpcInstalled = false;
        log(opts, 'warn', 'bootstrap-status not available.');
      } else {
        const data = statusInvoke.data as any;
        if (data?.success === true && data?.status) {
          rpcInstalled = true;
          const tables = data.status.tables as any;
          if (tables?.projects === true && tables?.profiles === true) schemaReady = true;
        } else if (data?.success === false && data?.code === 'bootstrap_rpc_missing') {
          rpcInstalled = false;
          return {
            connection: true,
            schemaReady,
            rpcInstalled: false,
            bridgeReady: false,
            errorCode: 'bootstrap_rpc_missing',
            errorMessage: 'Run: supabase db push',
          };
        }
      }
    }

    // Bridge authorization
    let bridgeReady = false;
    if (token) {
      log(opts, 'info', 'Authorizing bridge…');
      const invoke = await supabase.functions.invoke('clerk-jwt-verify', { body: { clerkToken: token } });
      if (invoke.error) {
        return {
          connection: true,
          schemaReady,
          rpcInstalled,
          bridgeReady: false,
          errorCode: 'bridge_failed',
          errorMessage: invoke.error.message,
        };
      }

      const data = invoke.data as
        | { success: true; session: { access_token: string; refresh_token: null } }
        | { success: false; error: string; code?: string };

      if ('success' in data && data.success && data.session?.access_token) {
        const userRes = await supabase.auth.getUser(data.session.access_token);
        bridgeReady = !userRes.error && !!userRes.data?.user;
        if (!bridgeReady) {
          return {
            connection: true,
            schemaReady,
            rpcInstalled,
            bridgeReady: false,
            errorCode: 'bridge_failed',
            errorMessage: userRes.error?.message ?? 'bridge_failed',
          };
        }
      } else {
        return {
          connection: true,
          schemaReady,
          rpcInstalled,
          bridgeReady: false,
          errorCode: 'bridge_failed',
          errorMessage: 'success' in data ? `${data.code ?? 'bridge_failed'}: ${data.error}` : 'bridge_failed',
        };
      }
    }

    return {
      connection: true,
      schemaReady,
      rpcInstalled,
      bridgeReady,
      ...(schemaReady ? null : { errorCode: 'schema_missing', errorMessage: 'Schema not installed.' }),
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

