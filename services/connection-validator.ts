import { createSupabaseClientFromRuntime } from '@/lib/supabase';
import { getRuntimeConfig } from '@/lib/runtime-config';

export type SystemConnectionResult = {
  supabase: boolean;
  clerk: boolean;
  bridge: boolean;
  error?: string;
};

// Optional token provider, set by SystemStatusContext when Clerk is available.
let clerkTokenProvider: null | (() => Promise<string | null>) = null;

export function setClerkTokenProvider(provider: null | (() => Promise<string | null>)) {
  clerkTokenProvider = provider;
}

export async function validateSystemConnection(): Promise<SystemConnectionResult> {
  const cfg = await getRuntimeConfig();
  if (!cfg) {
    return { supabase: false, clerk: false, bridge: false, error: 'System not configured.' };
  }

  try {
    const supabase = await createSupabaseClientFromRuntime();

    const sessionRes = await supabase.auth.getSession();
    const supabaseOk = !sessionRes.error;

    const projectsRes = await supabase.from('projects').select('id').limit(1);
    const dbOk = !projectsRes.error;

    const supabaseConnected = supabaseOk && dbOk;

    let clerkConnected = false;
    let bridgeAuthorized = false;

    const token = clerkTokenProvider ? await clerkTokenProvider() : null;
    clerkConnected = !!token;

    if (supabaseConnected && token) {
      const invoke = await supabase.functions.invoke('clerk-jwt-verify', {
        body: { clerkToken: token },
      });

      if (invoke.error) {
        return {
          supabase: supabaseConnected,
          clerk: clerkConnected,
          bridge: false,
          error: invoke.error.message,
        };
      }

      const data = invoke.data as
        | { success: true; session: { access_token: string; refresh_token: null } }
        | { success: false; error: string; code?: string };

      if ('success' in data && data.success && data.session?.access_token) {
        // Custom JWT federation: we only have an access token.
        // auth-js `setSession` requires refresh_token; so we validate by fetching the user with this JWT.
        const userRes = await supabase.auth.getUser(data.session.access_token);
        bridgeAuthorized = !userRes.error && !!userRes.data?.user;
        if (!bridgeAuthorized) {
          return {
            supabase: supabaseConnected,
            clerk: clerkConnected,
            bridge: false,
            error: userRes.error?.message ?? 'bridge_failed: invalid_supabase_jwt',
          };
        }
      } else {
        bridgeAuthorized = false;
        return {
          supabase: supabaseConnected,
          clerk: clerkConnected,
          bridge: false,
          error: 'success' in data ? `${data.code ?? 'bridge_failed'}: ${data.error}` : 'bridge_failed: Bridge failed',
        };
      }
    }

    return {
      supabase: supabaseConnected,
      clerk: clerkConnected,
      bridge: bridgeAuthorized,
      ...(supabaseConnected ? null : { error: projectsRes.error?.message || sessionRes.error?.message }),
    };
  } catch (e) {
    return { supabase: false, clerk: false, bridge: false, error: (e as Error).message };
  }
}

