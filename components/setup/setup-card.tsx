import * as React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { ThemedView } from '@/components/themed-view';

export function SetupCard({ style, ...props }: ViewProps) {
  return (
    <View style={styles.center}>
      <ThemedView {...props} style={[styles.card, style]} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    width: '100%',
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 720, // ~max-w-2xl
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    padding: 16,
    gap: 12,
  },
});

