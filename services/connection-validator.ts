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
      // Best-effort bridge validation:
      // If you deploy a Supabase Edge Function named `clerk-jwt-verify`, it can validate the Clerk JWT
      // and optionally return a Supabase session. Until then, we treat "bridge" as unauthorized.
      const invoke = await supabase.functions.invoke('clerk-jwt-verify', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!invoke.error) {
        const data = invoke.data as
          | { ok?: boolean; supabase_access_token?: string; supabase_refresh_token?: string }
          | null
          | undefined;

        if (data?.supabase_access_token && data?.supabase_refresh_token) {
          const set = await supabase.auth.setSession({
            access_token: data.supabase_access_token,
            refresh_token: data.supabase_refresh_token,
          });
          bridgeAuthorized = !set.error;
        } else {
          bridgeAuthorized = data?.ok === true;
        }
      } else {
        bridgeAuthorized = false;
      }
    }

    return {
      supabase: supabaseConnected,
      clerk: clerkConnected,
      bridge: bridgeAuthorized,
      ...(supabaseConnected ? null : { error: projectsRes.error?.message || sessionRes.error?.message }),
      ...(supabaseConnected && token && !bridgeAuthorized
        ? { error: 'Bridge not authorized. Deploy clerk-jwt-verify edge function (or return Supabase session tokens).' }
        : null),
    };
  } catch (e) {
    return { supabase: false, clerk: false, bridge: false, error: (e as Error).message };
  }
}

