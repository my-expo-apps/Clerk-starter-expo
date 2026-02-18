// Force a consistent bluish-dark UI (requested).
// If you later want to follow the device setting, revert this to:
// export { useColorScheme } from 'react-native';
export function useColorScheme() {
  return 'dark' as const;
}
