import { ThemedText } from '@/components/themed-text';
import { useSignUp } from '@clerk/clerk-expo';
import { Link, useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useThemeColor } from '@/components/Themed';

export function SignUpForm({ onSwitchToSignIn }: { onSwitchToSignIn?: () => void }) {
  const { isLoaded, signUp, setActive } = useSignUp();
  const router = useRouter();

  const [emailAddress, setEmailAddress] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [pendingVerification, setPendingVerification] = React.useState(false);
  const [code, setCode] = React.useState('');

  const onSignUpPress = async () => {
    if (!isLoaded) return;

    try {
      await signUp.create({
        emailAddress,
        password,
      });

      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
    } catch (err) {
      console.error(JSON.stringify(err, null, 2));
    }
  };

  const onVerifyPress = async () => {
    if (!isLoaded) return;

    try {
      const signUpAttempt = await signUp.attemptEmailAddressVerification({
        code,
      });

      if (signUpAttempt.status === 'complete') {
        await setActive({
          session: signUpAttempt.createdSessionId,
          navigate: async ({ session }) => {
            if (session?.currentTask) {
              console.log(session?.currentTask);
              return;
            }

            router.replace('/');
          },
        });
      } else {
        console.error(JSON.stringify(signUpAttempt, null, 2));
      }
    } catch (err) {
      console.error(JSON.stringify(err, null, 2));
    }
  };

  const inputBg = useThemeColor({}, 'inputBackground');
  const inputBorder = useThemeColor({}, 'inputBorder');
  const text = useThemeColor({}, 'text');
  const primary = useThemeColor({}, 'primary');
  const primaryText = useThemeColor({}, 'primaryText');
  const muted = useThemeColor({}, 'mutedText');

  if (pendingVerification) {
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
          placeholder="Enter your verification code"
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
        Sign up
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
        onPress={onSignUpPress}
        disabled={!emailAddress || !password}
      >
        <ThemedText style={[styles.buttonText, { color: primaryText }]}>Continue</ThemedText>
      </Pressable>

      <View style={styles.linkContainer}>
        <ThemedText>Have an account? </ThemedText>
        {onSwitchToSignIn ? (
          <Pressable onPress={onSwitchToSignIn}>
            <ThemedText type="link">Sign in</ThemedText>
          </Pressable>
        ) : (
          <Link href="/auth?mode=sign-in" asChild>
            <Pressable>
              <ThemedText type="link">Sign in</ThemedText>
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

