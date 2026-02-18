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

export async function getRuntimeConfig(): Promise<RuntimeConfig | null> {
  const raw = await SecureStore.getItemAsync(KEY);
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
  await SecureStore.setItemAsync(KEY, JSON.stringify(config), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

export async function clearRuntimeConfig(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

export async function isRuntimeConfigured(): Promise<boolean> {
  return (await getRuntimeConfig()) !== null;
}

