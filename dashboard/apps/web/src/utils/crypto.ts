// Simple WebCrypto helpers for encrypting/decrypting conversation data
// AES-GCM with PBKDF2-derived key. Stores salt in localStorage.

function getOrCreateSalt(): Uint8Array {
  try {
    const existing = localStorage.getItem('chat:salt');
    if (existing) {
      const raw = atob(existing);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return bytes;
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const b64 = btoa(String.fromCharCode(...Array.from(salt)));
    localStorage.setItem('chat:salt', b64);
    return salt;
  } catch {
    // Fallback deterministic salt if localStorage not available
    return new TextEncoder().encode('trae-chat-fallback-salt');
  }
}

export async function deriveKeyFromPassphrase(passphrase: string): Promise<CryptoKey> {
  const salt = getOrCreateSalt();
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as any, iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...Array.from(bytes)));
}

function fromBase64(b64: string): Uint8Array {
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function encryptJSON<T>(data: T, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const cipherBytes = new Uint8Array(cipher);
  const payload = new Uint8Array(iv.length + cipherBytes.length);
  payload.set(iv, 0);
  payload.set(cipherBytes, iv.length);
  return toBase64(payload);
}

export async function decryptJSON<T>(payloadB64: string, key: CryptoKey): Promise<T> {
  const payload = fromBase64(payloadB64);
  const iv = payload.slice(0, 12);
  const cipher = payload.slice(12);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  const text = new TextDecoder().decode(plainBuf);
  return JSON.parse(text) as T;
}