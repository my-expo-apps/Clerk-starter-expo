export function getClerkPublishableKey() {
  const key = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!key) {
    throw new Error(
      'Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Create a .env file (not committed) and set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...'
    );
  }

  return key;
}

