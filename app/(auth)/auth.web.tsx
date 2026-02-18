import { AuthCard } from '@/components/auth/auth-card';
import { ThemedView } from '@/components/themed-view';
import { StyleSheet, View } from 'react-native';

export default function Page() {
  return (
    <ThemedView style={styles.screen}>
      <View style={styles.center}>
        <AuthCard />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  center: {
    flex: 1,
    padding: 16,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 32,
  },
});

