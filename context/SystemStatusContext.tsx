import * as React from 'react';

import { getRuntimeConfig, isRuntimeConfigured } from '@/lib/runtime-config';
import { setClerkTokenProvider, validateSystemConnection, type SystemConnectionResult } from '@/services/connection-validator';

export type SystemStatus = {
  configured: boolean;
  supabaseConnected: boolean;
  clerkConnected: boolean;
  bridgeAuthorized: boolean;
  lastError?: string;
};

type SystemStatusContextValue = SystemStatus & {
  refresh: () => Promise<SystemConnectionResult>;
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
    clerkConnected: false,
    bridgeAuthorized: false,
  });

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

  const refresh = React.useCallback(async () => {
    const res = await validateSystemConnection();
    const configured = await isRuntimeConfigured();
    setStatus((s) => ({
      ...s,
      configured,
      supabaseConnected: res.supabase,
      clerkConnected: res.clerk,
      bridgeAuthorized: res.bridge,
      lastError: res.error,
    }));
    return res;
  }, []);

  const setClerkGetToken = React.useCallback((fn: null | (() => Promise<string | null>)) => {
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

