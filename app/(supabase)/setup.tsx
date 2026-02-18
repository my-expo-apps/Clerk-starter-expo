import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useSystemStatus } from '@/context/SystemStatusContext';
import { getRuntimeConfig, setRuntimeConfig, clearRuntimeConfig, type RuntimeConfig } from '@/lib/runtime-config';
import { initializeDatabase, type ValidationLogEntry } from '@/services/connection-validator';
import * as Clipboard from 'expo-clipboard';
import * as React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

const migrationPath = 'supabase/migrations/001_init.sql';

export default function Page() {
  const system = useSystemStatus();

  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [validatedOnce, setValidatedOnce] = React.useState(false);
  const [logsOpen, setLogsOpen] = React.useState(false);
  const [logs, setLogs] = React.useState<ValidationLogEntry[]>([]);

  const [supabaseUrl, setSupabaseUrl] = React.useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = React.useState('');
  const [clerkPublishableKey, setClerkPublishableKey] = React.useState('');

  React.useEffect(() => {
    void (async () => {
      const cfg = await getRuntimeConfig();
      if (!cfg) return;
      setSupabaseUrl(cfg.supabase_url);
      setSupabaseAnonKey(cfg.supabase_anon_key);
      setClerkPublishableKey(cfg.clerk_publishable_key);
    })();
  }, []);

  const normalizeClerkKey = (v: string) => {
    const trimmed = v.trim();
    // Accept people pasting "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_..."
    const prefix = 'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=';
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim();
    return trimmed;
  };

  const validateInputs = () => {
    const url = supabaseUrl.trim();
    const anon = supabaseAnonKey.trim();
    const clerkPk = normalizeClerkKey(clerkPublishableKey);

    if (!url || !anon || !clerkPk) return { ok: false as const, error: 'Please fill all fields.' };
    try {
      const u = new URL(url);
      if (!u.protocol.startsWith('http')) return { ok: false as const, error: 'Supabase URL must start with https://' };
    } catch {
      return { ok: false as const, error: 'Supabase URL is not a valid URL.' };
    }
    if (!clerkPk.startsWith('pk_')) return { ok: false as const, error: 'Clerk key must start with pk_...' };
    return { ok: true as const, url, anon, clerkPk };
  };

  const onSave = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const v = validateInputs();
      if (!v.ok) {
        setStatus(v.error);
        return;
      }
      const cfg: RuntimeConfig = {
        supabase_url: v.url,
        supabase_anon_key: v.anon,
        clerk_publishable_key: v.clerkPk,
      };
      await setRuntimeConfig(cfg);
      await system.reloadConfiguredFlag();
      setStatus('Saved runtime configuration.');
    } catch (e) {
      setStatus(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await clearRuntimeConfig();
      await system.reloadConfiguredFlag();
      setStatus('Cleared runtime configuration.');
    } catch (e) {
      setStatus(`Clear failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onValidate = async () => {
    setBusy(true);
    setStatus(null);
    setLogs([]);
    try {
      // Validate also saves current inputs so users don't need to press "Save" first.
      const v = validateInputs();
      if (!v.ok) {
        setStatus(v.error);
        return;
      }

      await setRuntimeConfig({
        supabase_url: v.url,
        supabase_anon_key: v.anon,
        clerk_publishable_key: v.clerkPk,
      });
      await system.reloadConfiguredFlag();

      const res = await system.refresh({
        onLog: (entry) => setLogs((l) => [...l, entry]),
      });
      setValidatedOnce(true);

      if (res.connection && res.schemaReady && res.rpcInstalled && res.bridgeReady) {
        setStatus('✅ System ready. You can use Schema Designer now.');
        return;
      }

      if (!res.connection) {
        setStatus(res.errorMessage ?? 'Supabase connection failed. Check URL/Anon key.');
        return;
      }
      if (!res.schemaReady) {
        setStatus('Schema not installed. Press "Initialize Database" or run migrations.');
        return;
      }
      if (!res.rpcInstalled) {
        setStatus(res.errorMessage ?? 'Bootstrap RPC missing. Run: supabase db push');
        return;
      }
      setStatus(res.errorMessage ?? 'Bridge not authorized. Ensure Edge Functions are deployed + env vars set.');
    } catch (e) {
      setStatus(`Validation error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onInitializeDatabase = async () => {
    setBusy(true);
    setStatus(null);
    setLogs([]);
    try {
      const v = validateInputs();
      if (!v.ok) {
        setStatus(v.error);
        return;
      }

      await setRuntimeConfig({
        supabase_url: v.url,
        supabase_anon_key: v.anon,
        clerk_publishable_key: v.clerkPk,
      });
      await system.reloadConfiguredFlag();

      const res = await initializeDatabase({
        onLog: (entry) => setLogs((l) => [...l, entry]),
      });

      if (!res.ok) {
        if (res.errorCode === 'bootstrap_rpc_missing') {
          setStatus('Bootstrap RPC missing. Run: supabase db push');
          return;
        }
        setStatus(res.errorMessage ?? 'Initialize failed.');
        return;
      }

      setStatus('✅ Initialized. Re-validating…');
      await onValidate();
    } catch (e) {
      setStatus(`Initialize error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onCopyMigrationPath = async () => {
    await Clipboard.setStringAsync(migrationPath);
    setStatus(`Copied: ${migrationPath}`);
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Supabase setup</ThemedText>
      <ThemedText type="subtitle">Runtime secrets + system validation</ThemedText>

      <View style={styles.card}>
        <ThemedText style={styles.label}>Supabase URL</ThemedText>
        <TextInput style={styles.input} value={supabaseUrl} onChangeText={setSupabaseUrl} placeholder="https://xxxx.supabase.co" />

        <ThemedText style={styles.label}>Supabase Anon Key</ThemedText>
        <TextInput style={styles.input} value={supabaseAnonKey} onChangeText={setSupabaseAnonKey} placeholder="eyJ..." />

        <ThemedText style={styles.label}>Clerk Publishable Key</ThemedText>
        <TextInput
          style={styles.input}
          value={clerkPublishableKey}
          onChangeText={setClerkPublishableKey}
          placeholder="pk_..."
          autoCapitalize="none"
          autoCorrect={false}
        />

        <ThemedText style={styles.note}>
          Migration path: {migrationPath}
        </ThemedText>

        <View style={styles.row}>
          <Pressable style={styles.button} onPress={onCopyMigrationPath}>
            <ThemedText style={styles.buttonText}>Copy migration path</ThemedText>
          </Pressable>

          <Pressable style={styles.button} onPress={onSave} disabled={busy}>
            {busy ? <ActivityIndicator /> : <ThemedText style={styles.buttonText}>Save</ThemedText>}
          </Pressable>

          <Pressable style={styles.button} onPress={onValidate} disabled={busy || !system.configured}>
            {busy ? <ActivityIndicator /> : <ThemedText style={styles.buttonText}>Validate & Authorize</ThemedText>}
          </Pressable>

          <Pressable style={styles.button} onPress={onInitializeDatabase} disabled={busy || !system.configured}>
            {busy ? <ActivityIndicator /> : <ThemedText style={styles.buttonText}>Initialize Database</ThemedText>}
          </Pressable>

          <Pressable style={styles.button} onPress={onClear} disabled={busy}>
            {busy ? <ActivityIndicator /> : <ThemedText style={styles.buttonText}>Clear</ThemedText>}
          </Pressable>
        </View>

        <View style={styles.badges}>
          <View style={[styles.badge, system.supabaseConnected ? styles.badgeOk : styles.badgeBad]}>
            <ThemedText style={styles.badgeText}>
              Supabase Connected: {system.supabaseConnected ? 'YES' : 'NO'}
            </ThemedText>
          </View>
          <View style={[styles.badge, system.schemaReady ? styles.badgeOk : styles.badgeBad]}>
            <ThemedText style={styles.badgeText}>Schema Installed: {system.schemaReady ? 'YES' : 'NO'}</ThemedText>
          </View>
          <View style={[styles.badge, system.rpcInstalled ? styles.badgeOk : styles.badgeBad]}>
            <ThemedText style={styles.badgeText}>Bootstrap RPC Installed: {system.rpcInstalled ? 'YES' : 'NO'}</ThemedText>
          </View>
          <View style={[styles.badge, system.bridgeAuthorized ? styles.badgeOk : styles.badgeBad]}>
            <ThemedText style={styles.badgeText}>Bridge Authorized: {system.bridgeAuthorized ? 'YES' : 'NO'}</ThemedText>
          </View>
        </View>

        <Pressable style={styles.logToggle} onPress={() => setLogsOpen((v) => !v)}>
          <ThemedText style={styles.logToggleText}>{logsOpen ? 'Hide logs' : 'Show logs'}</ThemedText>
        </Pressable>
        {logsOpen ? (
          <View style={styles.logsPanel}>
            {logs.length === 0 ? (
              <ThemedText style={styles.logsText}>No logs yet.</ThemedText>
            ) : (
              logs.map((l, idx) => (
                <ThemedText key={`${l.ts}-${idx}`} style={styles.logsText}>
                  [{new Date(l.ts).toLocaleTimeString()}] {l.level.toUpperCase()}: {l.message}
                </ThemedText>
              ))
            )}
          </View>
        ) : null}

        {validatedOnce && system.lastError ? <ThemedText style={styles.status}>{system.lastError}</ThemedText> : null}
        {status ? <ThemedText style={styles.status}>{status}</ThemedText> : null}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    gap: 12,
  },
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    gap: 12,
  },
  label: { fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.15)',
    color: '#fff',
  },
  note: { opacity: 0.85 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  buttonText: {
    fontWeight: '700',
  },
  status: {
    opacity: 0.9,
  },
  logToggle: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  logToggleText: { fontWeight: '700' },
  logsPanel: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    padding: 10,
    gap: 6,
    maxHeight: 220,
  },
  logsText: {
    fontSize: 12,
    opacity: 0.9,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  badgeOk: { backgroundColor: 'rgba(46, 204, 113, 0.15)' },
  badgeBad: { backgroundColor: 'rgba(231, 76, 60, 0.15)' },
  badgeText: { fontWeight: '700' },
});

