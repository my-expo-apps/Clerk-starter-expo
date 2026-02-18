import { StyleSheet } from 'react-native';

import { Text, useThemeColor, type TextProps } from './Themed';

type ThemedTextType = 'default' | 'title' | 'subtitle' | 'link';

export type ThemedTextProps = TextProps & {
  type?: ThemedTextType;
};

export function ThemedText({ type = 'default', style, ...props }: ThemedTextProps) {
  const linkColor = useThemeColor({}, 'primary');
  const mutedText = useThemeColor({}, 'mutedText');

  return (
    <Text
      style={[
        styles[type],
        type === 'link' && { color: linkColor },
        type === 'subtitle' && { color: mutedText },
        style,
      ]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  default: {},
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  link: {
    fontWeight: '600',
  },
});

