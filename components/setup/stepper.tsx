import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';

export type StepperStep = {
  key: string;
  label: string;
  state: 'done' | 'active' | 'todo';
};

export function Stepper({
  steps,
  onStepPress,
}: {
  steps: StepperStep[];
  onStepPress?: (idx: number) => void;
}) {
  return (
    <View style={styles.row}>
      {steps.map((s, idx) => {
        const dotStyle =
          s.state === 'done' ? styles.dotDone : s.state === 'active' ? styles.dotActive : styles.dotTodo;
        const textStyle = s.state === 'active' ? styles.textActive : styles.text;

        return (
          <React.Fragment key={s.key}>
            <Pressable
              onPress={() => onStepPress?.(idx)}
              style={styles.step}
              accessibilityRole="button"
              accessibilityLabel={`Step ${idx + 1}: ${s.label}`}
            >
              <View style={[styles.dot, dotStyle]} />
              <ThemedText style={textStyle}>{s.label}</ThemedText>
            </Pressable>
            {idx < steps.length - 1 ? <View style={styles.bar} /> : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  dotDone: { backgroundColor: '#2ecc71' },
  dotActive: { backgroundColor: '#4aa3ff' },
  dotTodo: { backgroundColor: 'rgba(255,255,255,0.25)' },
  bar: {
    width: 20,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginHorizontal: 2,
  },
  text: { opacity: 0.85, fontWeight: '700' },
  textActive: { opacity: 1, fontWeight: '800' },
});

