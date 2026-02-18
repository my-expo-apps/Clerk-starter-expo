import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useSystemStatus } from '@/context/SystemStatusContext';
import { getRuntimeConfig, setRuntimeConfig, clearRuntimeConfig, type RuntimeConfig } from '@/lib/runtime-config';
import { initializeDatabase, type ValidationLogEntry } from '@/services/connection-validator';
import * as Clipboard from 'expo-clipboard';
import * as React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

const migrationPath = 'supabase/migrations/001_init.sql';

type WizardStep = 0 | 1 | 2 | 3;

function stepTitle(step: WizardStep) {
  switch (step) {
    case 0:
      return '1) Connect Services';
    case 1:
      return '2) Install Database';
    case 2:
      return '3) Authorize Bridge';
    case 3:
      return '4) Ready';
  }
}

function statusIcon(ok: boolean, pending?: boolean) {
  if (ok) return '✅';
  if (pending) return '⏳';
  return '⬜';
}

function nextIncompleteStep(system: ReturnType<typeof useSystemStatus>): WizardStep {
  if (!system.supabaseConnected) return 0;
  if (!system.schemaReady || !system.rpcInstalled) return 1;
  if (!system.bridgeAuthorized) return 2;
  return 3;
}

export default function Page() {
  const system = useSystemStatus();

  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [validatedOnce, setValidatedOnce] = React.useState(false);
  const [logsOpen, setLogsOpen] = React.useState(false);
  const [logs, setLogs] = React.useState<ValidationLogEntry[]>([]);
  const [activeStep, setActiveStep] = React.useState<WizardStep>(0);
  const [openSteps, setOpenSteps] = React.useState<Record<WizardStep, boolean>>({
    0: true,
    1: false,
    2: false,
    3: false,
  });

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

  React.useEffect(() => {
    const s = nextIncompleteStep(system);
    setActiveStep(s);
    setOpenSteps((o) => ({ ...o, [s]: true }));
  }, [system.supabaseConnected, system.schemaReady, system.rpcInstalled, system.bridgeAuthorized]);

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

  const toggleStepOpen = (step: WizardStep) => {
    setOpenSteps((o) => ({ ...o, [step]: !o[step] }));
  };

  const stepIsComplete = (step: WizardStep) => {
    switch (step) {
      case 0:
        return system.supabaseConnected;
      case 1:
        return system.schemaReady && system.rpcInstalled;
      case 2:
        return system.bridgeAuthorized;
      case 3:
        return system.supabaseConnected && system.schemaReady && system.rpcInstalled && system.bridgeAuthorized;
    }
  };

  const primaryAction = () => {
    switch (activeStep) {
      case 0:
        return { label: 'Connect', onPress: onValidate };
      case 1:
        return { label: 'Install', onPress: onInitializeDatabase };
      case 2:
        return { label: 'Authorize', onPress: onValidate };
      case 3:
        return { label: 'Complete', onPress: onValidate };
    }
  };

  const primary = primaryAction();

  const Progress = () => {
    const steps: WizardStep[] = [0, 1, 2, 3];
    return (
      <View style={styles.progressRow}>
        {steps.map((s, i) => {
          const done = stepIsComplete(s);
          const isActive = s === activeStep;
          return (
            <View key={s} style={styles.progressItem}>
              <View style={[styles.progressDot, done ? styles.progressDotOk : isActive ? styles.progressDotActive : styles.progressDotIdle]} />
              {i < steps.length - 1 ? <View style={[styles.progressBar, done ? styles.progressBarOk : styles.progressBarIdle]} /> : null}
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Supabase setup</ThemedText>
      <ThemedText type="subtitle">Guided wizard (runtime secrets + validation)</ThemedText>
      <Progress />

      <View style={styles.card}>
        {/* STEP 1 */}
        <Pressable onPress={() => toggleStepOpen(0)} style={styles.stepHeader}>
          <ThemedText style={styles.stepTitle}>
            {statusIcon(stepIsComplete(0), activeStep === 0 && busy)} {stepTitle(0)}
          </ThemedText>
          <ThemedText style={styles.stepMeta}>{openSteps[0] ? 'Hide' : 'Show'}</ThemedText>
        </Pressable>
        {openSteps[0] ? (
          <View style={styles.stepBody}>
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

            <View style={styles.row}>
              <Pressable style={styles.secondaryButton} onPress={onSave} disabled={busy}>
                {busy ? <ActivityIndicator /> : <ThemedText style={styles.buttonText}>Save</ThemedText>}
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={onClear} disabled={busy}>
                {busy ? <ActivityIndicator /> : <ThemedText style={styles.buttonText}>Clear</ThemedText>}
              </Pressable>
            </View>

            {activeStep === 0 ? (
              <Pressable style={[styles.primaryButton, (!system.configured || busy) && styles.buttonDisabled]} onPress={primary.onPress} disabled={busy || !system.configured}>
                {busy ? <ActivityIndicator /> : <ThemedText style={styles.primaryButtonText}>{primary.label}</ThemedText>}
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* STEP 2 */}
        <Pressable onPress={() => toggleStepOpen(1)} style={styles.stepHeader}>
          <ThemedText style={styles.stepTitle}>
            {statusIcon(stepIsComplete(1), activeStep === 1 && busy)} {stepTitle(1)}
          </ThemedText>
          <ThemedText style={styles.stepMeta}>{openSteps[1] ? 'Hide' : 'Show'}</ThemedText>
        </Pressable>
        {openSteps[1] ? (
          <View style={styles.stepBody}>
            <ThemedText style={styles.note}>Migration path: {migrationPath}</ThemedText>
            <Pressable style={styles.secondaryButton} onPress={onCopyMigrationPath}>
              <ThemedText style={styles.buttonText}>Copy migration path</ThemedText>
            </Pressable>
            <ThemedText style={styles.note}>
              If the database is missing tables/RPC, install via the bootstrap flow or run: <ThemedText style={styles.mono}>supabase db push</ThemedText>
            </ThemedText>

            {activeStep === 1 ? (
              <Pressable style={[styles.primaryButton, (!system.configured || busy) && styles.buttonDisabled]} onPress={primary.onPress} disabled={busy || !system.configured}>
                {busy ? <ActivityIndicator /> : <ThemedText style={styles.primaryButtonText}>{primary.label}</ThemedText>}
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* STEP 3 */}
        <Pressable onPress={() => toggleStepOpen(2)} style={styles.stepHeader}>
          <ThemedText style={styles.stepTitle}>
            {statusIcon(stepIsComplete(2), activeStep === 2 && busy)} {stepTitle(2)}
          </ThemedText>
          <ThemedText style={styles.stepMeta}>{openSteps[2] ? 'Hide' : 'Show'}</ThemedText>
        </Pressable>
        {openSteps[2] ? (
          <View style={styles.stepBody}>
            <ThemedText style={styles.note}>
              This step verifies Clerk → Supabase federation via the deployed Edge Function and mints a Supabase-compatible JWT.
            </ThemedText>
            <ThemedText style={styles.note}>
              You must be signed in (so the app can fetch a Clerk session token).
            </ThemedText>

            {activeStep === 2 ? (
              <Pressable style={[styles.primaryButton, (!system.configured || busy) && styles.buttonDisabled]} onPress={primary.onPress} disabled={busy || !system.configured}>
                {busy ? <ActivityIndicator /> : <ThemedText style={styles.primaryButtonText}>{primary.label}</ThemedText>}
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* STEP 4 */}
        <Pressable onPress={() => toggleStepOpen(3)} style={styles.stepHeader}>
          <ThemedText style={styles.stepTitle}>
            {statusIcon(stepIsComplete(3), activeStep === 3 && busy)} {stepTitle(3)}
          </ThemedText>
          <ThemedText style={styles.stepMeta}>{openSteps[3] ? 'Hide' : 'Show'}</ThemedText>
        </Pressable>
        {openSteps[3] ? (
          <View style={styles.stepBody}>
            <View style={styles.badges}>
              <View style={[styles.badge, system.supabaseConnected ? styles.badgeOk : styles.badgeBad]}>
                <ThemedText style={styles.badgeText}>Supabase Connected</ThemedText>
              </View>
              <View style={[styles.badge, system.schemaReady ? styles.badgeOk : styles.badgeBad]}>
                <ThemedText style={styles.badgeText}>Schema Installed</ThemedText>
              </View>
              <View style={[styles.badge, system.rpcInstalled ? styles.badgeOk : styles.badgeBad]}>
                <ThemedText style={styles.badgeText}>Bootstrap RPC Installed</ThemedText>
              </View>
              <View style={[styles.badge, system.bridgeAuthorized ? styles.badgeOk : styles.badgeBad]}>
                <ThemedText style={styles.badgeText}>Bridge Authorized</ThemedText>
              </View>
            </View>

            {activeStep === 3 ? (
              <Pressable style={[styles.primaryButton, (!system.configured || busy) && styles.buttonDisabled]} onPress={primary.onPress} disabled={busy || !system.configured}>
                {busy ? <ActivityIndicator /> : <ThemedText style={styles.primaryButtonText}>{primary.label}</ThemedText>}
              </Pressable>
            ) : null}
          </View>
        ) : null}

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
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  progressItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  progressDotOk: { backgroundColor: '#2ecc71' },
  progressDotActive: { backgroundColor: '#4aa3ff' },
  progressDotIdle: { backgroundColor: 'rgba(255,255,255,0.25)' },
  progressBar: {
    width: 24,
    height: 2,
    marginHorizontal: 6,
  },
  progressBarOk: { backgroundColor: 'rgba(46, 204, 113, 0.9)' },
  progressBarIdle: { backgroundColor: 'rgba(255,255,255,0.2)' },
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
  mono: { fontFamily: 'monospace' },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  buttonText: {
    fontWeight: '700',
  },
  primaryButton: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(74,163,255,0.7)',
    backgroundColor: 'rgba(74,163,255,0.14)',
    alignItems: 'center',
  },
  primaryButtonText: { fontWeight: '800' },
  buttonDisabled: { opacity: 0.5 },
  status: {
    opacity: 0.9,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  stepTitle: { fontWeight: '800' },
  stepMeta: { opacity: 0.8 },
  stepBody: {
    gap: 10,
    paddingBottom: 8,
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

