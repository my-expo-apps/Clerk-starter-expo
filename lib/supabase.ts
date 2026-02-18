import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { getRuntimeConfig } from '@/lib/runtime-config';

export async function createSupabaseClientFromRuntime() {
  const cfg = await getRuntimeConfig();
  if (!cfg) {
    throw new Error('System not configured. Please open Supabase Setup and save runtime configuration.');
  }

  return createClient(cfg.supabase_url, cfg.supabase_anon_key, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

