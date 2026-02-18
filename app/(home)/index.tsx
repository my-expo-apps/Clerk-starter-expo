import { SignOutButton } from '@/components/sign-out-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth, useSession, useUser } from '@clerk/clerk-expo';
import { Redirect } from 'expo-router';
import { StyleSheet } from 'react-native';

export default function Page() {
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
});

