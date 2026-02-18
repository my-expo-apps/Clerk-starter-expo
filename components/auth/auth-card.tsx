import { SignInForm } from '@/components/auth/sign-in-form';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { ThemedText } from '@/components/themed-text';
import { useThemeColor } from '@/components/Themed';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

type Mode = 'sign-in' | 'sign-up';

function normalizeMode(value: unknown): Mode {
  return value === 'sign-up' ? 'sign-up' : 'sign-in';
}

export function AuthCard() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();

  const [activeMode, setActiveMode] = React.useState<Mode>(() => normalizeMode(mode));

  React.useEffect(() => {
    setActiveMode(normalizeMode(mode));
  }, [mode]);

  const primary = useThemeColor({}, 'primary');
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'mutedText');

  const setMode = React.useCallback(
    (next: Mode) => {
      setActiveMode(next);
      router.setParams({ mode: next });
    },
    [router]
  );

  return (
    <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
      <ThemedText type="title" style={styles.title}>
        Account
      </ThemedText>
      <ThemedText type="subtitle" style={[styles.subtitle, { marginTop: 4 }]}>
        Sign in or create an account
      </ThemedText>

      <View style={[styles.tabs, { borderColor: border }]}>
        <Pressable
          onPress={() => setMode('sign-in')}
          style={[
            styles.tab,
            { borderColor: border },
            activeMode === 'sign-in' && { backgroundColor: primary, borderColor: primary },
          ]}
        >
          <ThemedText style={[styles.tabText, activeMode === 'sign-in' && styles.tabTextActive]}>
            Sign in
          </ThemedText>
        </Pressable>

        <Pressable
          onPress={() => setMode('sign-up')}
          style={[
            styles.tab,
            { borderColor: border },
            activeMode === 'sign-up' && { backgroundColor: primary, borderColor: primary },
          ]}
        >
          <ThemedText style={[styles.tabText, activeMode === 'sign-up' && styles.tabTextActive]}>
            Sign up
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.form}>
        {activeMode === 'sign-in' ? (
          <SignInForm onSwitchToSignUp={() => setMode('sign-up')} />
        ) : (
          <SignUpForm onSwitchToSignIn={() => setMode('sign-in')} />
        )}
      </View>

      <ThemedText style={{ color: muted, marginTop: 12, fontSize: 12 }}>
        Tip: You can switch tabs anytime.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 420 : 520,
    borderWidth: 1,
    borderRadius: 20,
    padding: Platform.OS === 'web' ? 14 : 18,
    gap: 8,
  },
  title: {
    ...(Platform.OS === 'web' ? { fontSize: 24 } : null),
  },
  subtitle: {
    ...(Platform.OS === 'web' ? { fontSize: 16 } : null),
  },
  tabs: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  tab: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: Platform.OS === 'web' ? 8 : 10,
    alignItems: 'center',
  },
  tabText: {
    fontWeight: '700',
    ...(Platform.OS === 'web' ? { fontSize: 14 } : null),
  },
  tabTextActive: {
    color: '#06131f',
  },
  form: {
    marginTop: Platform.OS === 'web' ? 8 : 10,
  },
});

