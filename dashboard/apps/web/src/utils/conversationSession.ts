// Session storage utilities for per-conversation state
// Keeps messages isolated per conversation and tracks active conversation id per tab

export type SessionMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  [key: string]: any;
};

const ACTIVE_KEY = 'chat:activeConv';
const PREFIX = 'chat:conv:';

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export function getActiveConversationId(): string | null {
  try { return sessionStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

export function setActiveConversationId(id: string | null) {
  try {
    if (!id) sessionStorage.removeItem(ACTIVE_KEY);
    else sessionStorage.setItem(ACTIVE_KEY, id);
  } catch { /* ignore */ }
}

export function getSessionMessages(id: string): SessionMessage[] | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + id);
    const parsed = safeParse<SessionMessage[]>(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

export function setSessionMessages(id: string, msgs: SessionMessage[]) {
  try {
    sessionStorage.setItem(PREFIX + id, JSON.stringify(msgs || []));
  } catch { /* ignore */ }
}

export function clearSessionMessages(id: string) {
  try { sessionStorage.removeItem(PREFIX + id); } catch { /* ignore */ }
}

export function clearAllSession() {
  try {
    const keys = Object.keys(sessionStorage);
    keys.forEach((k) => { if (k === ACTIVE_KEY || k.startsWith(PREFIX)) sessionStorage.removeItem(k); });
  } catch { /* ignore */ }
}