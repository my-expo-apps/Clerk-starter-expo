import * as React from 'react';

import { useAuth } from '@clerk/clerk-expo';

import { useSystemStatus } from '@/context/SystemStatusContext';
import { setClerkTokenProvider } from '@/services/connection-validator';

export function ClerkTokenBinder() {
  const system = useSystemStatus();
  const { getToken, isLoaded } = useAuth();

  React.useEffect(() => {
    if (!isLoaded) return;

    const provider = async () => {
      const token = await getToken();
      return token ?? null;
    };

    system.setClerkGetToken(provider);
    setClerkTokenProvider(provider);

    return () => {
      system.setClerkGetToken(null);
      setClerkTokenProvider(null);
    };
  }, [getToken, isLoaded, system]);

  return null;
}

