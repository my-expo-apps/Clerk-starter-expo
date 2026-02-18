import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/lib/supabase';
import * as Clipboard from 'expo-clipboard';
import * as React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

const migrationPath = 'supabase/migrations/001_init.sql';

export default function Page() {
  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const onTest = async () => {
    setBusy(true);
    setStatus(null);
    try {
      // Minimal sanity check: attempt a harmless query. It will fail with a useful message
      // until migrations are applied and RLS/auth are configured.
      const res = await supabase.from('projects').select('id').limit(1);
      if (res.error) {
        setStatus(`Supabase reached, but query failed: ${res.error.message}`);
      } else {
        setStatus('Connected to Supabase and query succeeded.');
      }
    } catch (e) {
      setStatus(`Connection error: ${(e as Error).message}`);
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
      <ThemedText type="subtitle">Prep mode: schema + client config</ThemedText>

      <View style={styles.card}>
        <ThemedText>
          1) Create a Supabase project{'\n'}
          2) Add env vars:{'\n'}
          - EXPO_PUBLIC_SUPABASE_URL{'\n'}
          - EXPO_PUBLIC_SUPABASE_ANON_KEY{'\n'}
          3) Run the starter migration: {migrationPath}
        </ThemedText>

        <View style={styles.row}>
          <Pressable style={styles.button} onPress={onCopyMigrationPath}>
            <ThemedText style={styles.buttonText}>Copy migration path</ThemedText>
          </Pressable>

          <Pressable style={styles.button} onPress={onTest} disabled={busy}>
            {busy ? <ActivityIndicator /> : <ThemedText style={styles.buttonText}>Test connection</ThemedText>}
          </Pressable>
        </View>

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
});

