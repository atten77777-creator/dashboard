// Conversation storage and sync utilities

import { deriveKeyFromPassphrase, encryptJSON, decryptJSON } from './crypto';

export type Role = 'user' | 'assistant' | 'system';

export type AnyMessage = {
  role: Role;
  content: string;
  timestamp?: number;
  // Preserve any extra fields used by chat (sql, result, extractedSql, etc.)
  [key: string]: any;
};

export type ConversationContext = {
  llmType?: string;
  selectedTables?: string[];
  useAllTables?: boolean;
  persona?: string;
  schemaVersion?: number;
  schemaError?: string | null;
  failedTables?: string[];
  // Extendable context
  [key: string]: any;
};

export type Conversation = {
  id: string;
  title: string;
  messages: AnyMessage[];
  context: ConversationContext;
  createdAt: number;
  updatedAt: number;
  version: number;
  important?: boolean;
  pinned?: boolean;
  encryption?: boolean;
  conflicts?: { at: number; detail: string }[];
  versions?: { at: number; title: string; messagesCount: number }[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  messagesCount: number;
  pinned?: boolean;
  important?: boolean;
};

const INDEX_KEY = 'chat:conversations:index';

function getIndex(): ConversationSummary[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function setIndex(index: ConversationSummary[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {}
}

function buildTitle(messages: AnyMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  const text = (firstUser?.content || '').trim();
  if (!text) return 'Untitled Conversation';
  return text.length > 80 ? text.slice(0, 77) + '…' : text;
}

export async function saveConversation(conv: Conversation, opts?: { passphrase?: string; apiBase?: string; cloudSync?: boolean }) {
  const keyName = `chat:conversations:${conv.id}`;
  const payload: Conversation = {
    ...conv,
    title: conv.title || buildTitle(conv.messages),
    updatedAt: Date.now(),
    version: (conv.version ?? 0) + 1,
  };

  const { passphrase, apiBase, cloudSync } = opts || {};
  try {
    if (payload.encryption && passphrase) {
      const key = await deriveKeyFromPassphrase(passphrase);
      const cipher = await encryptJSON(payload, key);
      localStorage.setItem(keyName, JSON.stringify({ enc: true, data: cipher }));
    } else {
      localStorage.setItem(keyName, JSON.stringify({ enc: false, data: payload }));
    }
    // maintain index
    const index = getIndex();
    const summary: ConversationSummary = {
      id: payload.id,
      title: payload.title,
      updatedAt: payload.updatedAt,
      createdAt: payload.createdAt ?? Date.now(),
      messagesCount: payload.messages.length,
      pinned: payload.pinned,
      important: payload.important,
    };
    const existingIdx = index.findIndex(i => i.id === payload.id);
    if (existingIdx >= 0) index[existingIdx] = summary; else index.push(summary);
    index.sort((a, b) => b.updatedAt - a.updatedAt);
    setIndex(index);

    // backup last 3
    backupConversation(payload);

    // optional cloud sync
    if (cloudSync && apiBase) {
      try {
        await syncConversation(payload, apiBase);
      } catch (e: any) {
        payload.conflicts = payload.conflicts || [];
        payload.conflicts.push({ at: Date.now(), detail: `Sync failed: ${String(e?.message || e)}` });
        localStorage.setItem(keyName, JSON.stringify({ enc: false, data: payload }));
      }
    }
  } catch {}
}

export async function loadConversation(id: string, opts?: { passphrase?: string }): Promise<Conversation | null> {
  try {
    const raw = localStorage.getItem(`chat:conversations:${id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.enc) {
      const key = await deriveKeyFromPassphrase(String(opts?.passphrase || ''));
      return await decryptJSON(parsed.data, key);
    }
    return parsed?.data as Conversation;
  } catch {
    return null;
  }
}

export function listConversations(): ConversationSummary[] {
  return getIndex();
}

export function deleteConversation(id: string) {
  try {
    localStorage.removeItem(`chat:conversations:${id}`);
    const index = getIndex().filter(i => i.id !== id);
    setIndex(index);
  } catch {}
}

function backupConversation(conv: Conversation) {
  try {
    const keyPrefix = `chat:conversations:${conv.id}:backup:`;
    const stamp = Date.now();
    localStorage.setItem(keyPrefix + stamp, JSON.stringify(conv));
    // keep only last 3
    const keys = Object.keys(localStorage).filter(k => k.startsWith(keyPrefix)).sort().reverse();
    for (let i = 3; i < keys.length; i++) localStorage.removeItem(keys[i]);
  } catch {}
}

async function syncConversation(conv: Conversation, apiBase: string) {
  // naive sync: try PUT, fallback to POST
  const putRes = await fetch(`${apiBase}/conversations/${encodeURIComponent(conv.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conv),
  });
  if (putRes.ok) return;
  const postRes = await fetch(`${apiBase}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conv),
  });
  if (!postRes.ok) throw new Error(`Sync failed with status ${postRes.status}`);
}

export function markImportant(id: string, important: boolean) {
  try {
    const raw = localStorage.getItem(`chat:conversations:${id}`);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const conv: Conversation = parsed?.enc ? parsed : parsed?.data;
    conv.important = important;
    conv.versions = conv.versions || [];
    conv.versions.push({ at: Date.now(), title: conv.title || 'Untitled', messagesCount: conv.messages?.length || 0 });
    localStorage.setItem(`chat:conversations:${id}`, JSON.stringify({ enc: false, data: conv }));
    const index = getIndex();
    const idx = index.findIndex(i => i.id === id);
    if (idx >= 0) index[idx].important = important;
    setIndex(index);
  } catch {}
}

export function pinConversation(id: string, pinned: boolean) {
  try {
    const raw = localStorage.getItem(`chat:conversations:${id}`);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const conv: Conversation = parsed?.enc ? parsed : parsed?.data;
    conv.pinned = pinned;
    localStorage.setItem(`chat:conversations:${id}`, JSON.stringify({ enc: false, data: conv }));
    const index = getIndex();
    const idx = index.findIndex(i => i.id === id);
    if (idx >= 0) index[idx].pinned = pinned;
    setIndex(index);
  } catch {}
}