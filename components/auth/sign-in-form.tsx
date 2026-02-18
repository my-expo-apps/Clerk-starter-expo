import { ThemedText } from '@/components/themed-text';
import { useSignIn } from '@clerk/clerk-expo';
import type { EmailCodeFactor } from '@clerk/types';
import { Link, useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useThemeColor } from '@/components/Themed';

export function SignInForm({ onSwitchToSignUp }: { onSwitchToSignUp?: () => void }) {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();

  const [emailAddress, setEmailAddress] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState('');
  const [showEmailCode, setShowEmailCode] = React.useState(false);

  const onSignInPress = React.useCallback(async () => {
    if (!isLoaded) return;

    try {
      const signInAttempt = await signIn.create({
        identifier: emailAddress,
        password,
      });

      if (signInAttempt.status === 'complete') {
        await setActive({
          session: signInAttempt.createdSessionId,
          navigate: async ({ session }) => {
            if (session?.currentTask) {
              console.log(session?.currentTask);
              return;
            }

            router.replace('/');
          },
        });
      } else if (signInAttempt.status === 'needs_second_factor') {
        const emailCodeFactor = signInAttempt.supportedSecondFactors?.find(
          (factor): factor is EmailCodeFactor => factor.strategy === 'email_code'
        );

        if (emailCodeFactor) {
          await signIn.prepareSecondFactor({
            strategy: 'email_code',
            emailAddressId: emailCodeFactor.emailAddressId,
          });
          setShowEmailCode(true);
        }
      } else {
        console.error(JSON.stringify(signInAttempt, null, 2));
      }
    } catch (err) {
      console.error(JSON.stringify(err, null, 2));
    }
  }, [isLoaded, signIn, setActive, router, emailAddress, password]);

  const onVerifyPress = React.useCallback(async () => {
    if (!isLoaded) return;

    try {
      const signInAttempt = await signIn.attemptSecondFactor({
        strategy: 'email_code',
        code,
      });

      if (signInAttempt.status === 'complete') {
        await setActive({
          session: signInAttempt.createdSessionId,
          navigate: async ({ session }) => {
            if (session?.currentTask) {
              console.log(session?.currentTask);
              return;
            }

            router.replace('/');
          },
        });
      } else {
        console.error(JSON.stringify(signInAttempt, null, 2));
      }
    } catch (err) {
      console.error(JSON.stringify(err, null, 2));
    }
  }, [isLoaded, signIn, setActive, router, code]);

  const inputBg = useThemeColor({}, 'inputBackground');
  const inputBorder = useThemeColor({}, 'inputBorder');
  const text = useThemeColor({}, 'text');
  const primary = useThemeColor({}, 'primary');
  const primaryText = useThemeColor({}, 'primaryText');
  const muted = useThemeColor({}, 'mutedText');

  if (showEmailCode) {
    return (
      <View style={styles.container}>
        <ThemedText type="title" style={styles.title}>
          Verify your email
        </ThemedText>
        <ThemedText style={[styles.description, { color: muted }]}>
          A verification code has been sent to your email.
        </ThemedText>
        <TextInput
          style={[styles.input, { backgroundColor: inputBg, borderColor: inputBorder, color: text }]}
          value={code}
          placeholder="Enter verification code"
          placeholderTextColor="#666666"
          onChangeText={setCode}
          keyboardType="numeric"
        />
        <Pressable
          style={({ pressed }) => [styles.button, { backgroundColor: primary }, pressed && styles.buttonPressed]}
          onPress={onVerifyPress}
        >
          <ThemedText style={[styles.buttonText, { color: primaryText }]}>Verify</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ThemedText type="title" style={styles.title}>
        Sign in
      </ThemedText>

      <ThemedText style={styles.label}>Email address</ThemedText>
      <TextInput
        style={[styles.input, { backgroundColor: inputBg, borderColor: inputBorder, color: text }]}
        autoCapitalize="none"
        value={emailAddress}
        placeholder="Enter email"
        placeholderTextColor="#666666"
        onChangeText={setEmailAddress}
        keyboardType="email-address"
      />

      <ThemedText style={styles.label}>Password</ThemedText>
      <TextInput
        style={[styles.input, { backgroundColor: inputBg, borderColor: inputBorder, color: text }]}
        value={password}
        placeholder="Enter password"
        placeholderTextColor="#666666"
        secureTextEntry={true}
        onChangeText={setPassword}
      />

      <Pressable
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: primary },
          (!emailAddress || !password) && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
        onPress={onSignInPress}
        disabled={!emailAddress || !password}
      >
        <ThemedText style={[styles.buttonText, { color: primaryText }]}>Continue</ThemedText>
      </Pressable>

      <View style={styles.linkContainer}>
        <ThemedText>Don't have an account? </ThemedText>
        {onSwitchToSignUp ? (
          <Pressable onPress={onSwitchToSignUp}>
            <ThemedText type="link">Sign up</ThemedText>
          </Pressable>
        ) : (
          <Link href="/auth?mode=sign-up" asChild>
            <Pressable>
              <ThemedText type="link">Sign up</ThemedText>
            </Pressable>
          </Link>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  title: {
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    marginBottom: 16,
    opacity: 0.8,
  },
  label: {
    fontWeight: '600',
    fontSize: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: '#0a7ea4',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  linkContainer: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 12,
    alignItems: 'center',
  },
});

