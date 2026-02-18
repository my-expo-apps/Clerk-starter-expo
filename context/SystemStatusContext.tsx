import * as React from 'react';

import { getRuntimeConfig, isRuntimeConfigured } from '@/lib/runtime-config';
import { setClerkTokenProvider, validateSystemConnection, type SystemValidationResult, type ValidationLogEntry } from '@/services/connection-validator';

export type SystemStatus = {
  configured: boolean;
  supabaseConnected: boolean;
  schemaReady: boolean;
  rpcInstalled: boolean;
  clerkConnected: boolean;
  bridgeAuthorized: boolean;
  lastError?: string;
};

type SystemStatusContextValue = SystemStatus & {
  refresh: (opts?: { onLog?: (entry: ValidationLogEntry) => void }) => Promise<SystemValidationResult>;
  setClerkGetToken: (fn: null | (() => Promise<string | null>)) => void;
  reloadConfiguredFlag: () => Promise<boolean>;
};

const SystemStatusContext = React.createContext<SystemStatusContextValue | null>(null);

export function useSystemStatus() {
  const ctx = React.useContext(SystemStatusContext);
  if (!ctx) throw new Error('useSystemStatus must be used within SystemStatusProvider');
  return ctx;
}

export function SystemStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<SystemStatus>({
    configured: false,
    supabaseConnected: false,
    schemaReady: false,
    rpcInstalled: false,
    clerkConnected: false,
    bridgeAuthorized: false,
  });

  const clerkGetTokenRef = React.useRef<null | (() => Promise<string | null>)>(null);

  const reloadConfiguredFlag = React.useCallback(async () => {
    const configured = await isRuntimeConfigured();
    setStatus((s) => ({ ...s, configured }));
    return configured;
  }, []);

  React.useEffect(() => {
    // Initial load (no secrets exposed)
    void reloadConfiguredFlag();
    void getRuntimeConfig(); // warm SecureStore
  }, [reloadConfiguredFlag]);

  const refresh = React.useCallback(async (opts?: { onLog?: (entry: ValidationLogEntry) => void }) => {
    const res = await validateSystemConnection(opts);
    const configured = await isRuntimeConfigured();

    // Keep this independent of the validator model:
    // we consider Clerk "connected" if we can fetch a Clerk token.
    let clerkConnected = false;
    try {
      const token = clerkGetTokenRef.current ? await clerkGetTokenRef.current() : null;
      clerkConnected = !!token;
    } catch {
      clerkConnected = false;
    }

    setStatus((s) => ({
      ...s,
      configured,
      supabaseConnected: res.connection,
      schemaReady: res.schemaReady,
      rpcInstalled: res.rpcInstalled,
      clerkConnected,
      bridgeAuthorized: res.bridgeReady,
      lastError: res.errorMessage,
    }));
    return res;
  }, []);

  const setClerkGetToken = React.useCallback((fn: null | (() => Promise<string | null>)) => {
    clerkGetTokenRef.current = fn;
    setClerkTokenProvider(fn);
  }, []);

  const value = React.useMemo<SystemStatusContextValue>(
    () => ({
      ...status,
      refresh,
      setClerkGetToken,
      reloadConfiguredFlag,
    }),
    [status, refresh, setClerkGetToken, reloadConfiguredFlag]
  );

  return <SystemStatusContext.Provider value={value}>{children}</SystemStatusContext.Provider>;
}

