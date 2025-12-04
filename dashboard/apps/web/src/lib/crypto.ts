// Minimal AES-GCM crypto helpers using Web Crypto API
// Provides passphrase-based encryption with PBKDF2 key derivation.

export type EncryptedBlob = {
  alg: 'AES-GCM';
  kdf: 'PBKDF2';
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
  iterations: number;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function deriveKey(passphrase: string, saltBytes: BufferSource, iterations = 150000): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJSON(data: any, passphrase: string): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = textEncoder.encode(JSON.stringify(data));
  const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const blob: EncryptedBlob = {
    alg: 'AES-GCM',
    kdf: 'PBKDF2',
    salt: b64(salt),
    iv: b64(iv),
    ciphertext: b64(new Uint8Array(ctBuf)),
    iterations: 150000,
  };
  return blob;
}

export async function decryptJSON(blob: EncryptedBlob, passphrase: string): Promise<any> {
  const salt = fromB64(blob.salt);
  const iv = fromB64(blob.iv);
  const key = await deriveKey(passphrase, salt, blob.iterations || 150000);
  const ct = fromB64(blob.ciphertext);
  const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  const json = textDecoder.decode(ptBuf);
  return JSON.parse(json);
}

function b64(arr: Uint8Array<ArrayBuffer>): string {
  let str = '';
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
  // eslint-disable-next-line no-undef
  return btoa(str);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  // eslint-disable-next-line no-undef
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}