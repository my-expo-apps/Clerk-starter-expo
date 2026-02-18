import { describe, expect, it } from 'vitest';
import { CLERK_UUIDV5_NAMESPACE_DNS, isUuid, uuidv5_node, uuidv5_webcrypto } from './_utils';

describe('identity: UUIDv5 mapping', () => {
  it('is deterministic (same input -> same UUID)', async () => {
    const clerkUserId = 'user_test_123';
    const a = uuidv5_node(clerkUserId, CLERK_UUIDV5_NAMESPACE_DNS);
    const b = uuidv5_node(clerkUserId, CLERK_UUIDV5_NAMESPACE_DNS);
    const c = await uuidv5_webcrypto(clerkUserId, CLERK_UUIDV5_NAMESPACE_DNS);

    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(isUuid(a)).toBe(true);
  });

  it('changes when input changes', () => {
    const a = uuidv5_node('user_test_123', CLERK_UUIDV5_NAMESPACE_DNS);
    const b = uuidv5_node('user_test_124', CLERK_UUIDV5_NAMESPACE_DNS);
    expect(a).not.toBe(b);
  });
});

