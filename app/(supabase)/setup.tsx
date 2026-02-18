import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SetupCard } from '@/components/setup/setup-card';
import { Stepper, type StepperStep } from '@/components/setup/stepper';
import { useSystemStatus } from '@/context/SystemStatusContext';
import { getRuntimeConfig, setRuntimeConfig, clearRuntimeConfig, type RuntimeConfig } from '@/lib/runtime-config';
import { initializeDatabase, type ValidationLogEntry } from '@/services/connection-validator';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

const migrationPath = 'supabase/migrations/001_init.sql';

type WizardStep = 0 | 1 | 2 | 3;

function nextIncompleteStep(system: ReturnType<typeof useSystemStatus>): WizardStep {
  if (!system.supabaseConnected) return 0;
  if (!system.schemaReady || !system.rpcInstalled) return 1;
  if (!system.bridgeAuthorized) return 2;
  return 3;
}

export default function Page() {
  const router = useRouter();
  const system = useSystemStatus();

  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [validatedOnce, setValidatedOnce] = React.useState(false);
  const [logsModalOpen, setLogsModalOpen] = React.useState(false);
  const [logs, setLogs] = React.useState<ValidationLogEntry[]>([]);
  const [checks, setChecks] = React.useState<null | Record<string, any>>(null);
  const [stepOverride, setStepOverride] = React.useState<WizardStep | null>(null);

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

  const inputsOk = validateInputs().ok;

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
      setStatus('Saved.');
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
      setStatus('Cleared.');
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
    setChecks(null);
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

      const res = await system.refresh({
        onLog: (entry) => setLogs((l) => [...l, entry]),
      });
      setValidatedOnce(true);
      setStepOverride(null);
      setChecks(res.checks ?? null);

      if (res.connection && res.schemaReady && res.rpcInstalled && res.bridgeReady) {
        setStatus('✅ Ready.');
        return;
      }

      if (!res.connection) {
        setStatus(res.errorMessage ?? 'Supabase connection failed.');
        return;
      }
      if (!res.schemaReady) {
        setStatus('Schema missing. Install.');
        return;
      }
      if (!res.rpcInstalled) {
        setStatus(res.errorMessage ?? 'Bootstrap RPC missing. Run: supabase db push');
        return;
      }
      setStatus(res.errorMessage ?? 'Bridge not authorized.');
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
          setStatus('Run: supabase db push');
          return;
        }
        setStatus(res.errorMessage ?? 'Install failed.');
        return;
      }

      setStatus('✅ Installed. Re-checking…');
      await onValidate();
    } catch (e) {
      setStatus(`Install error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onCopyMigrationPath = async () => {
    await Clipboard.setStringAsync(migrationPath);
    setStatus('Copied migration path.');
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

  const activeStep = stepOverride ?? nextIncompleteStep(system);

  const steps: StepperStep[] = [
    { key: 'connect', label: 'Connect', state: stepIsComplete(0) ? 'done' : activeStep === 0 ? 'active' : 'todo' },
    { key: 'install', label: 'Install', state: stepIsComplete(1) ? 'done' : activeStep === 1 ? 'active' : 'todo' },
    { key: 'authorize', label: 'Authorize', state: stepIsComplete(2) ? 'done' : activeStep === 2 ? 'active' : 'todo' },
    { key: 'ready', label: 'Ready', state: stepIsComplete(3) ? 'done' : activeStep === 3 ? 'active' : 'todo' },
  ];

  const maxAccessible = nextIncompleteStep(system);
  const canNavigateToStep = (idx: number) => idx <= maxAccessible;

  const primaryAction = () => {
    switch (activeStep) {
      case 0:
        return { label: 'Connect', onPress: onValidate };
      case 1:
        return { label: 'Install', onPress: onInitializeDatabase };
      case 2:
        return { label: 'Authorize', onPress: onValidate };
      case 3:
        return { label: 'Complete', onPress: () => router.push('/(supabase)/schema-designer') };
    }
  };

  const primary = primaryAction();

  const canPrimary = inputsOk && !busy;

  const StatusRow = ({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) => {
    return (
      <View style={styles.statusRow}>
        <ThemedText style={styles.statusRowText}>
          {ok ? '✅' : '❌'} {label}
        </ThemedText>
        {detail ? <ThemedText style={styles.statusRowDetail}>{detail}</ThemedText> : null}
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SetupCard>
        <ThemedText type="title">Setup</ThemedText>
        <Stepper
          steps={steps}
          onStepPress={(idx) => {
            if (!canNavigateToStep(idx)) return;
            setStepOverride(idx as WizardStep);
          }}
        />

        {activeStep === 0 ? (
          <View style={styles.step}>
            <TextInput style={styles.input} value={supabaseUrl} onChangeText={setSupabaseUrl} placeholder="Supabase URL" />
            <TextInput style={styles.input} value={supabaseAnonKey} onChangeText={setSupabaseAnonKey} placeholder="Supabase anon key" />
            <TextInput
              style={styles.input}
              value={clerkPublishableKey}
              onChangeText={setClerkPublishableKey}
              placeholder="Clerk publishable key"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Pressable style={styles.tertiary} onPress={onClear} disabled={busy}>
              <ThemedText style={styles.tertiaryText}>Clear</ThemedText>
            </Pressable>

            <Pressable style={[styles.primaryButton, !canPrimary && styles.buttonDisabled]} onPress={primary.onPress} disabled={!canPrimary}>
              {busy ? <ActivityIndicator /> : <ThemedText style={styles.primaryButtonText}>{primary.label}</ThemedText>}
            </Pressable>
          </View>
        ) : null}

        {activeStep === 1 ? (
          <View style={styles.step}>
            <ThemedText style={styles.note}>Install schema + bootstrap RPC.</ThemedText>
            <Pressable style={styles.secondaryButton} onPress={onCopyMigrationPath}>
              <ThemedText style={styles.buttonText}>Copy migration path</ThemedText>
            </Pressable>
            <ThemedText style={styles.note}>
              If RPC is missing, run <ThemedText style={styles.mono}>supabase db push</ThemedText>.
            </ThemedText>

            <Pressable style={[styles.primaryButton, !canPrimary && styles.buttonDisabled]} onPress={primary.onPress} disabled={!canPrimary}>
              {busy ? <ActivityIndicator /> : <ThemedText style={styles.primaryButtonText}>{primary.label}</ThemedText>}
            </Pressable>
          </View>
        ) : null}

        {activeStep === 2 ? (
          <View style={styles.step}>
            <ThemedText style={styles.note}>Authorize Clerk → Supabase bridge (sign in first).</ThemedText>
            <Pressable style={[styles.primaryButton, !canPrimary && styles.buttonDisabled]} onPress={primary.onPress} disabled={!canPrimary}>
              {busy ? <ActivityIndicator /> : <ThemedText style={styles.primaryButtonText}>{primary.label}</ThemedText>}
            </Pressable>
          </View>
        ) : null}

        {activeStep === 3 ? (
          <View style={styles.step}>
            <View style={styles.badges}>
              <View style={[styles.badge, system.supabaseConnected ? styles.badgeOk : styles.badgeBad]}>
                <ThemedText style={styles.badgeText}>Supabase</ThemedText>
              </View>
              <View style={[styles.badge, system.schemaReady ? styles.badgeOk : styles.badgeBad]}>
                <ThemedText style={styles.badgeText}>Schema</ThemedText>
              </View>
              <View style={[styles.badge, system.rpcInstalled ? styles.badgeOk : styles.badgeBad]}>
                <ThemedText style={styles.badgeText}>RPC</ThemedText>
              </View>
              <View style={[styles.badge, system.bridgeAuthorized ? styles.badgeOk : styles.badgeBad]}>
                <ThemedText style={styles.badgeText}>Bridge</ThemedText>
              </View>
            </View>

            {checks ? (
              <View style={styles.statusBlock}>
                <StatusRow label="Supabase host" ok={checks.host?.ok === true} detail={checks.host?.ms ? `${checks.host.ms}ms` : undefined} />
                <StatusRow
                  label="Edge: clerk-jwt-verify"
                  ok={checks.edgeClerkVerify?.ok === true}
                  detail={checks.edgeClerkVerify?.ms ? `${checks.edgeClerkVerify.ms}ms` : undefined}
                />
                <StatusRow
                  label="Edge: bootstrap-status (RPC)"
                  ok={checks.rpcStatus?.ok === true}
                  detail={checks.rpcStatus?.ms ? `${checks.rpcStatus.ms}ms` : undefined}
                />
                <StatusRow
                  label="Minted Supabase JWT"
                  ok={checks.supabaseJwt?.ok === true}
                  detail={checks.supabaseJwt?.ms ? `${checks.supabaseJwt.ms}ms` : undefined}
                />
              </View>
            ) : null}

            <Pressable style={[styles.primaryButton, !canPrimary && styles.buttonDisabled]} onPress={primary.onPress} disabled={!canPrimary}>
              {busy ? <ActivityIndicator /> : <ThemedText style={styles.primaryButtonText}>{primary.label}</ThemedText>}
            </Pressable>
          </View>
        ) : null}

        <View style={styles.footerRow}>
          <Pressable style={styles.footerBtn} onPress={onSave} disabled={busy || !inputsOk}>
            <ThemedText style={styles.footerText}>Save</ThemedText>
          </Pressable>
          <Pressable style={styles.footerBtn} onPress={() => setLogsModalOpen(true)}>
            <ThemedText style={styles.footerText}>Logs</ThemedText>
          </Pressable>
          <Pressable style={styles.footerBtn} onPress={onValidate} disabled={busy || !inputsOk}>
            <ThemedText style={styles.footerText}>Re-check</ThemedText>
          </Pressable>
        </View>

        {validatedOnce && system.lastError ? <ThemedText style={styles.status}>{system.lastError}</ThemedText> : null}
        {status ? <ThemedText style={styles.status}>{status}</ThemedText> : null}
      </SetupCard>

      <Modal visible={logsModalOpen} transparent animationType="fade" onRequestClose={() => setLogsModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <ThemedText style={styles.modalTitle}>Logs</ThemedText>
              <Pressable onPress={() => setLogsModalOpen(false)}>
                <ThemedText style={styles.footerText}>Close</ThemedText>
              </Pressable>
            </View>
            <ScrollView style={styles.modalBody} contentContainerStyle={{ paddingBottom: 10 }}>
              {logs.length === 0 ? (
                <ThemedText style={styles.logsText}>No logs yet.</ThemedText>
              ) : (
                logs.map((l, idx) => (
                  <ThemedText key={`${l.ts}-${idx}`} style={styles.logsText}>
                    [{new Date(l.ts).toLocaleTimeString()}] {l.level.toUpperCase()}: {l.message}
                  </ThemedText>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    gap: 12,
  },
  step: {
    gap: 10,
    paddingTop: 4,
  },
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
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'flex-start',
  },
  buttonText: { fontWeight: '700' },
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
  tertiary: { alignSelf: 'flex-start', paddingVertical: 6 },
  tertiaryText: { opacity: 0.85, fontWeight: '700' },
  status: { opacity: 0.9 },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 4,
  },
  footerBtn: { paddingVertical: 6, paddingHorizontal: 8 },
  footerText: { fontWeight: '800', opacity: 0.9 },
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
  statusBlock: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  statusRowText: { fontWeight: '800', opacity: 0.95 },
  statusRowDetail: { opacity: 0.75 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 20,
    justifyContent: 'center',
  },
  modalCard: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(10, 14, 28, 0.98)',
    padding: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
  },
  modalTitle: { fontWeight: '900' },
  modalBody: { maxHeight: 320 },
  logsText: { fontSize: 12, opacity: 0.92 },
});

