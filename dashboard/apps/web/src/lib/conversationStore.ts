import { decryptJSON, encryptJSON, type EncryptedBlob } from './crypto';

export type ChatMessageLike = any; // Keep flexible to avoid tight coupling

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessageLike[];
}

export interface ConversationHistory {
  version: number;
  lastActiveId?: string;
  conversations: Conversation[];
  // Optional flags
  encrypted?: boolean;
}

export const HISTORY_KEY = 'trae2.chat.history.v1';
export const HISTORY_ENC_KEY = 'trae2.chat.history.enc';
export const HISTORY_BACKUP_KEY = 'trae2.chat.history.v1.backup';
export const HISTORY_ENC_BACKUP_KEY = 'trae2.chat.history.enc.backup';

export type LoadResult = {
  data?: ConversationHistory;
  encrypted?: boolean;
  needsPassphrase?: boolean;
  error?: string;
};

export async function loadHistory(passphrase?: string | null): Promise<LoadResult> {
  try {
    const encRaw = localStorage.getItem(HISTORY_ENC_KEY) || localStorage.getItem(HISTORY_ENC_BACKUP_KEY);
    const raw = localStorage.getItem(HISTORY_KEY) || localStorage.getItem(HISTORY_BACKUP_KEY);
    if (encRaw) {
      const blob: EncryptedBlob = JSON.parse(encRaw);
      if (!passphrase) {
        return { encrypted: true, needsPassphrase: true };
      }
      try {
        const data = await decryptJSON(blob, passphrase);
        return { data, encrypted: true };
      } catch (e: any) {
        return { error: String(e?.message || e || 'Decryption failed'), encrypted: true };
      }
    }
    if (raw) {
      const data = JSON.parse(raw) as ConversationHistory;
      return { data, encrypted: false };
    }
    // No history exists
    return { data: { version: 1, conversations: [], lastActiveId: undefined, encrypted: false }, encrypted: false };
  } catch (e: any) {
    return { error: String(e?.message || e) };
  }
}

export async function saveHistory(history: ConversationHistory, passphrase?: string | null): Promise<void> {
  try {
    if (passphrase) {
      const blob = await encryptJSON(history, passphrase);
      localStorage.setItem(HISTORY_ENC_KEY, JSON.stringify(blob));
      localStorage.setItem(HISTORY_ENC_BACKUP_KEY, JSON.stringify(blob));
      // Remove plaintext to prevent leakage
      localStorage.removeItem(HISTORY_KEY);
      localStorage.removeItem(HISTORY_BACKUP_KEY);
    } else {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      localStorage.setItem(HISTORY_BACKUP_KEY, JSON.stringify(history));
      localStorage.removeItem(HISTORY_ENC_KEY);
      localStorage.removeItem(HISTORY_ENC_BACKUP_KEY);
    }
  } catch (e) {
    // Best-effort; surface error to caller
    throw e;
  }
}

// Reliable save with verification and light retries
export async function saveHistoryReliable(history: ConversationHistory, passphrase?: string | null): Promise<void> {
  await saveHistory(history, passphrase);
  const verify = () => {
    const a = localStorage.getItem(HISTORY_KEY);
    const b = localStorage.getItem(HISTORY_BACKUP_KEY);
    if (!a || !b) return false;
    try { return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b)); } catch { return false; }
  };
  if (verify()) return;
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 50 + i * 50));
    await saveHistory(history, passphrase);
    if (verify()) return;
  }
  throw new Error('Local conversation save verification failed');
}

// Stable client id for cloud backups
export function getClientId(): string {
  const key = 'trae2.client.id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = 'cli_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(key, id);
  }
  return id;
}

export function addConversation(history: ConversationHistory, title: string): ConversationHistory {
  const now = Date.now();
  const conv: Conversation = { id: genId(), title, createdAt: now, updatedAt: now, messages: [] };
  const next: ConversationHistory = {
    ...history,
    conversations: [conv, ...history.conversations],
    lastActiveId: conv.id,
  };
  return next;
}

export function updateConversation(history: ConversationHistory, convId: string, updater: (c: Conversation) => Conversation): ConversationHistory {
  const nextConvs = history.conversations.map((c) => c.id === convId ? updater(c) : c);
  return { ...history, conversations: nextConvs };
}

export function deleteConversation(history: ConversationHistory, convId: string): ConversationHistory {
  const nextConvs = history.conversations.filter((c) => c.id !== convId);
  const nextActive = history.lastActiveId === convId ? nextConvs[0]?.id : history.lastActiveId;
  return { ...history, conversations: nextConvs, lastActiveId: nextActive };
}

export function setLastActive(history: ConversationHistory, convId?: string): ConversationHistory {
  return { ...history, lastActiveId: convId };
}

export function genId(): string {
  // Prefer cryptographically-strong UUID when available; fallback otherwise
  try {
    if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
      return (crypto as any).randomUUID();
    }
  } catch {}
  return 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}