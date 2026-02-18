export type RuntimeConfig = {
  supabase_url: string;
  supabase_anon_key: string;
  clerk_publishable_key: string;
};

const KEY = 'runtime_config_v1';

function isFilled(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export async function getRuntimeConfig(): Promise<RuntimeConfig | null> {
  const storage = getStorage();
  if (!storage) return null;

  const raw = storage.getItem(KEY);
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
  const storage = getStorage();
  if (!storage) throw new Error('Runtime config storage is unavailable on web.');
  storage.setItem(KEY, JSON.stringify(config));
}

export async function clearRuntimeConfig(): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(KEY);
}

export async function isRuntimeConfigured(): Promise<boolean> {
  return (await getRuntimeConfig()) !== null;
}

