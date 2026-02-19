import { SetupCard } from '@/components/setup/setup-card';
import { Stepper, type StepperStep } from '@/components/setup/stepper';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { clearRuntimeConfig, getRuntimeConfig, setRuntimeConfig, type RuntimeConfig } from '@/lib/runtime-config';
import { type ValidationLogEntry } from '@/services/connection-validator';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

const migrationPath = 'supabase/migrations/001_init.sql';

type WizardStep = 0 | 1 | 2 | 3;

type CliStatusResponse =
  | { cliAvailable: false }
  | {
      cliAvailable: true;
      devOnly: true;
      supabase: {
        status: { ok: boolean; durationMs: number; exitCode?: number };
        functions: {
          ok: boolean;
          durationMs: number;
          exitCode?: number;
          requiredFunctions: string[];
          functionsPresent: boolean;
          detected: string[];
        };
      };
      clerk: { status: { ok: boolean; durationMs: number; exitCode?: number } };
      output?: Record<string, any>;
    };

function nextIncompleteStepFromCli(cli: CliStatusResponse | null): WizardStep {
  const cliOk = cli?.cliAvailable === true;
  const supabaseOk = cliOk && (cli as any).supabase?.status?.ok === true;
  const functionsOk = supabaseOk && (cli as any).supabase?.functions?.functionsPresent === true;
  const clerkOk = cliOk && (cli as any).clerk?.status?.ok === true;

  if (!cliOk) return 0;
  if (!supabaseOk) return 1;
  if (!functionsOk || !clerkOk) return 2;
  return 3;
}

async function fetchCliStatus(timeoutMs: number): Promise<CliStatusResponse> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/api/cli-status', {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const json = (await res.json()) as CliStatusResponse;
    return json;
  } finally {
    clearTimeout(id);
  }
}

export default function Page() {
  const router = useRouter();

  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [validatedOnce, setValidatedOnce] = React.useState(false);
  const [logsModalOpen, setLogsModalOpen] = React.useState(false);
  const [logs, setLogs] = React.useState<ValidationLogEntry[]>([]);
  const [checks, setChecks] = React.useState<CliStatusResponse | null>(null);
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

      const pushLog = (level: ValidationLogEntry['level'], message: string) =>
        setLogs((l) => [...l, { ts: Date.now(), level, message }]);

      if (!__DEV__) {
        pushLog('warn', 'CLI status route is dev-only.');
        setValidatedOnce(true);
        setStatus('CLI status is available only in development.');
        setChecks({ cliAvailable: false });
        return;
      }

      if (Platform.OS !== 'web') {
        // This route runs on the local Node runtime backing the web dev server.
        pushLog('warn', 'CLI status is only available on Web dev server.');
        setValidatedOnce(true);
        setStatus('CLI status is available only on Web (development).');
        setChecks({ cliAvailable: false });
        return;
      }

      pushLog('info', 'Fetching local CLI status…');
      const cli = await fetchCliStatus(4500);
      setValidatedOnce(true);
      setStepOverride(null);
      setChecks(cli);

      if (cli.cliAvailable !== true) {
        pushLog('error', 'CLI not available.');
        setStatus('CLI not available. Install Supabase CLI and Clerk CLI.');
        return;
      }

      const supabaseOk = cli.supabase.status.ok;
      const functionsPresent = cli.supabase.functions.functionsPresent;
      const clerkOk = cli.clerk.status.ok;

      pushLog('info', `supabase status: ${supabaseOk ? 'OK' : 'FAIL'}`);
      pushLog('info', `supabase functions list: ${cli.supabase.functions.ok ? 'OK' : 'FAIL'}`);
      pushLog('info', `required functions present: ${functionsPresent ? 'YES' : 'NO'}`);
      pushLog('info', `clerk status: ${clerkOk ? 'OK' : 'FAIL'}`);

      if (supabaseOk && functionsPresent && clerkOk) {
        setStatus('✅ CLI foundation ready.');
      } else {
        setStatus('CLI foundation not ready. Run: npm run setup-project');
      }
    } catch (e) {
      setStatus(`Validation error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onCopyMigrationPath = async () => {
    await Clipboard.setStringAsync(migrationPath);
    setStatus('Copied migration path.');
  };

  const stepIsComplete = (step: WizardStep) => {
    const cliOk = checks?.cliAvailable === true;
    const supabaseOk = cliOk && (checks as any).supabase?.status?.ok === true;
    const functionsOk = supabaseOk && (checks as any).supabase?.functions?.functionsPresent === true;
    const clerkOk = cliOk && (checks as any).clerk?.status?.ok === true;
    switch (step) {
      case 0:
        return cliOk;
      case 1:
        return supabaseOk;
      case 2:
        return functionsOk && clerkOk;
      case 3:
        return cliOk && supabaseOk && functionsOk && clerkOk;
    }
  };

  const activeStep = stepOverride ?? nextIncompleteStepFromCli(checks);

  const steps: StepperStep[] = [
    { key: 'connect', label: 'Connect', state: stepIsComplete(0) ? 'done' : activeStep === 0 ? 'active' : 'todo' },
    { key: 'install', label: 'Install', state: stepIsComplete(1) ? 'done' : activeStep === 1 ? 'active' : 'todo' },
    { key: 'authorize', label: 'Authorize', state: stepIsComplete(2) ? 'done' : activeStep === 2 ? 'active' : 'todo' },
    { key: 'ready', label: 'Ready', state: stepIsComplete(3) ? 'done' : activeStep === 3 ? 'active' : 'todo' },
  ];

  const maxAccessible = nextIncompleteStepFromCli(checks);
  const canNavigateToStep = (idx: number) => idx <= maxAccessible;

  const primaryAction = () => {
    switch (activeStep) {
      case 0:
        return { label: 'Connect', onPress: onValidate };
      case 1:
        return { label: 'Re-check', onPress: onValidate };
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
            <ThemedText style={styles.note}>Provisioning is CLI-first.</ThemedText>
            <Pressable style={styles.secondaryButton} onPress={onCopyMigrationPath}>
              <ThemedText style={styles.buttonText}>Copy migration path</ThemedText>
            </Pressable>
            <ThemedText style={styles.note}>
              Run <ThemedText style={styles.mono}>npm run setup-project</ThemedText> (recommended) or <ThemedText style={styles.mono}>supabase db push</ThemedText>.
            </ThemedText>

            <Pressable style={[styles.primaryButton, !canPrimary && styles.buttonDisabled]} onPress={primary.onPress} disabled={!canPrimary}>
              {busy ? <ActivityIndicator /> : <ThemedText style={styles.primaryButtonText}>{primary.label}</ThemedText>}
            </Pressable>
          </View>
        ) : null}

        {activeStep === 2 ? (
          <View style={styles.step}>
            <ThemedText style={styles.note}>Validate required Edge Functions and Clerk CLI.</ThemedText>
            <Pressable style={[styles.primaryButton, !canPrimary && styles.buttonDisabled]} onPress={primary.onPress} disabled={!canPrimary}>
              {busy ? <ActivityIndicator /> : <ThemedText style={styles.primaryButtonText}>{primary.label}</ThemedText>}
            </Pressable>
          </View>
        ) : null}

        {activeStep === 3 ? (
          <View style={styles.step}>
            <View style={styles.badges}>
              <View style={[styles.badge, stepIsComplete(0) ? styles.badgeOk : styles.badgeBad]}>
                <ThemedText style={styles.badgeText}>CLI</ThemedText>
              </View>
              <View style={[styles.badge, stepIsComplete(1) ? styles.badgeOk : styles.badgeBad]}>
                <ThemedText style={styles.badgeText}>Supabase</ThemedText>
              </View>
              <View style={[styles.badge, stepIsComplete(2) ? styles.badgeOk : styles.badgeBad]}>
                <ThemedText style={styles.badgeText}>Functions</ThemedText>
              </View>
              <View style={[styles.badge, checks?.cliAvailable === true && (checks as any).clerk?.status?.ok === true ? styles.badgeOk : styles.badgeBad]}>
                <ThemedText style={styles.badgeText}>Clerk</ThemedText>
              </View>
            </View>

            {checks && checks.cliAvailable === true ? (
              <View style={styles.statusBlock}>
                <StatusRow
                  label="supabase status"
                  ok={(checks as any).supabase?.status?.ok === true}
                  detail={(checks as any).supabase?.status?.durationMs ? `${(checks as any).supabase.status.durationMs}ms` : undefined}
                />
                <StatusRow
                  label="supabase functions list"
                  ok={(checks as any).supabase?.functions?.ok === true}
                  detail={(checks as any).supabase?.functions?.durationMs ? `${(checks as any).supabase.functions.durationMs}ms` : undefined}
                />
                <StatusRow
                  label="required functions present"
                  ok={(checks as any).supabase?.functions?.functionsPresent === true}
                />
                <StatusRow
                  label="clerk status"
                  ok={(checks as any).clerk?.status?.ok === true}
                  detail={(checks as any).clerk?.status?.durationMs ? `${(checks as any).clerk.status.durationMs}ms` : undefined}
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

