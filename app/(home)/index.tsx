import { SignOutButton } from '@/components/sign-out-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useSystemStatus } from '@/context/SystemStatusContext';
import { useAuth, useSession, useUser } from '@clerk/clerk-expo';
import { Link, Redirect } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

export default function Page() {
  const system = useSystemStatus();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();

  const { session } = useSession();
  console.log(session?.currentTask);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/auth?mode=sign-in" />;

  const email = user?.emailAddresses?.[0]?.emailAddress;

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Welcome!</ThemedText>
      <ThemedText>Hello{email ? ` ${email}` : ''}</ThemedText>

      <ThemedText style={styles.sectionTitle}>System Status</ThemedText>
      <ThemedView style={styles.statusBox}>
        <ThemedText>
          Clerk: <ThemedText style={system.clerkConnected ? styles.ok : styles.bad}>{system.clerkConnected ? 'OK' : 'FAIL'}</ThemedText>
        </ThemedText>
        <ThemedText>
          Supabase:{' '}
          <ThemedText style={system.supabaseConnected ? styles.ok : styles.bad}>
            {system.supabaseConnected ? 'OK' : 'FAIL'}
          </ThemedText>
        </ThemedText>
        <ThemedText>
          Bridge:{' '}
          <ThemedText style={system.bridgeAuthorized ? styles.ok : styles.bad}>
            {system.bridgeAuthorized ? 'AUTHORIZED' : 'BLOCKED'}
          </ThemedText>
        </ThemedText>
      </ThemedView>

      <Link href="/(supabase)/setup" asChild>
        <Pressable>
          <ThemedText type="link">Supabase setup</ThemedText>
        </Pressable>
      </Link>
      {system.bridgeAuthorized ? (
        <Link href="/(supabase)/schema-designer" asChild>
          <Pressable>
            <ThemedText type="link">Schema designer</ThemedText>
          </Pressable>
        </Link>
      ) : (
        <ThemedText style={styles.disabledLink}>Schema designer (locked)</ThemedText>
      )}

      <SignOutButton />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    gap: 16,
  },
  sectionTitle: {
    fontWeight: '800',
    marginTop: 8,
  },
  statusBox: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    borderColor: 'rgba(255,255,255,0.12)',
    gap: 6,
  },
  ok: { color: '#2ecc71', fontWeight: '800' },
  bad: { color: '#e74c3c', fontWeight: '800' },
  disabledLink: { opacity: 0.7 },
});

