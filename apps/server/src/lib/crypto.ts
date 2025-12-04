import crypto from 'crypto';

function getRawKey(): Buffer {
  const env = process.env.CONV_ENCRYPTION_KEY || '';
  if (env) {
    try {
      if (/^[A-Fa-f0-9]{64}$/.test(env)) return Buffer.from(env, 'hex');
      if (/^[A-Za-z0-9+/=]+$/.test(env) && env.length >= 44) {
        const b = Buffer.from(env, 'base64');
        if (b.length === 32) return b;
      }
      const utf = Buffer.from(env, 'utf-8');
      if (utf.length >= 32) return utf.slice(0, 32);
    } catch {}
  }
  return crypto.createHash('sha256').update('dev-conv-key').digest();
}

const KEY = getRawKey();

export function encryptString(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(String(plaintext), 'utf-8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptString(ciphertext: string): string {
  try {
    const buf = Buffer.from(String(ciphertext), 'base64');
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const enc = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf-8');
  } catch {
    return '';
  }
}