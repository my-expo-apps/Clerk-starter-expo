import { createHash, createHmac, randomUUID } from 'node:crypto';

export const CLERK_UUIDV5_NAMESPACE_DNS = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

export function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length ? v.trim() : null;
}

export function missingEnv(names: string[]): string[] {
  return names.filter((n) => !env(n));
}

export function describeIf(cond: boolean, vitestDescribe: typeof import('vitest').describe) {
  return cond ? vitestDescribe : vitestDescribe.skip;
}

export function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export function base64urlDecode(input: string) {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

export function decodeJwtNoVerify(token: string): { header: any; payload: any; signingInput: string; signatureB64u: string } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('jwt_malformed');
  const [h, p, s] = parts;
  const header = JSON.parse(base64urlDecode(h).toString('utf8'));
  const payload = JSON.parse(base64urlDecode(p).toString('utf8'));
  return { header, payload, signingInput: `${h}.${p}`, signatureB64u: s };
}

export function verifyHs256(token: string, secret: string): boolean {
  const { header, signingInput, signatureB64u } = decodeJwtNoVerify(token);
  if (header?.alg !== 'HS256') return false;
  const mac = createHmac('sha256', Buffer.from(secret, 'utf8')).update(signingInput).digest();
  const expected = mac
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return expected === signatureB64u;
}

function uuidToBytes(uuid: string) {
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToUuid(bytes: Uint8Array) {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

// Reference implementation using node:crypto (createHash).
export function uuidv5_node(name: string, namespaceUuid: string) {
  const nsBytes = Buffer.from(uuidToBytes(namespaceUuid));
  const nameBytes = Buffer.from(new TextEncoder().encode(name));
  const hash = createHash('sha1').update(Buffer.concat([nsBytes, nameBytes])).digest();
  const bytes = new Uint8Array(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

// Second implementation using WebCrypto subtle.digest to cross-check determinism.
export async function uuidv5_webcrypto(name: string, namespaceUuid: string) {
  const nsBytes = uuidToBytes(namespaceUuid);
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(nsBytes.length + nameBytes.length);
  data.set(nsBytes, 0);
  data.set(nameBytes, nsBytes.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
  const bytes = hash.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

export function randomUserId() {
  return randomUUID();
}

export function jsonHeaders(apikey: string, bearer: string) {
  return {
    apikey,
    authorization: `Bearer ${bearer}`,
    'content-type': 'application/json',
  };
}

