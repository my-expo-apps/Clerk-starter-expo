import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type RuntimeConfig = {
  supabase_url: string;
  supabase_anon_key: string;
  clerk_publishable_key: string;
};

const KEY = 'runtime_config_v1';

function isFilled(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function getWebStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    const s = getWebStorage();
    return s ? s.getItem(key) : null;
  }
  return await SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    const s = getWebStorage();
    if (!s) throw new Error('Runtime config storage is unavailable on web.');
    s.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    const s = getWebStorage();
    s?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function getRuntimeConfig(): Promise<RuntimeConfig | null> {
  const raw = await getItem(KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<RuntimeConfig>;
    if (
      isFilled(parsed.supabase_url) &&
      isFilled(parsed.supabase_anon_key) &&
      isFilled(parsed.clerk_publishable_key)
    ) {
      return {
        supabase_url: parsed.supabase_url.trim(),
        supabase_anon_key: parsed.supabase_anon_key.trim(),
        clerk_publishable_key: parsed.clerk_publishable_key.trim(),
      };
    }

    return null;
  } catch {
    return null;
  }
}

export async function setRuntimeConfig(config: RuntimeConfig): Promise<void> {
  await setItem(KEY, JSON.stringify(config));
}

export async function clearRuntimeConfig(): Promise<void> {
  await deleteItem(KEY);
}

export async function isRuntimeConfigured(): Promise<boolean> {
  return (await getRuntimeConfig()) !== null;
}

