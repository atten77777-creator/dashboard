import { randomUUID } from 'crypto';

type Role = 'system' | 'user' | 'assistant';

export type ConversationMessage = {
  role: Role;
  content: string;
  ts?: number;
};

export type Conversation = {
  id: string;
  title: string;
  userId?: string;
  summary?: string;
  messages: ConversationMessage[];
};

// In-memory store for development and stateless mode
const conversations = new Map<string, Conversation>();

export async function initConversationStorage(_schemaVersion?: string): Promise<void> {
  // No-op in dev/stateless mode; kept for API compatibility
}

export async function createConversation(opts: {
  title?: string;
  userId?: string;
  schemaVersion?: string | number;
  contextSummary?: string | null;
}): Promise<Conversation> {
  const id = randomUUID();
  const conv: Conversation = {
    id,
    title: opts.title || 'Chat',
    userId: opts.userId,
    summary: (opts.contextSummary ?? undefined) ? String(opts.contextSummary) : '',
    messages: [],
  };
  conversations.set(id, conv);
  return conv;
}

export async function appendMessage(conversationId: string, msg: ConversationMessage): Promise<void> {
  const existing = conversations.get(conversationId);
  if (!existing) {
    conversations.set(conversationId, {
      id: conversationId,
      title: 'Chat',
      messages: [],
    });
  }
  const conv = conversations.get(conversationId)!;
  conv.messages.push({ ...msg, ts: Date.now() });
}

export async function getConversationContext(
  conversationId: string,
  opts?: { maxMessages?: number }
): Promise<{ messages: ConversationMessage[]; summary?: string }> {
  const conv = conversations.get(conversationId);
  if (!conv) return { messages: [], summary: '' };
  const max = Math.max(1, Math.min(200, (opts?.maxMessages ?? 50)));
  const tail = conv.messages.slice(-max);
  return { messages: tail, summary: conv.summary };
}

export async function getConversation(conversationId: string): Promise<Conversation | null> {
  return conversations.get(conversationId) ?? null;
}

export async function listMessages(conversationId: string, opts?: { limit?: number }): Promise<ConversationMessage[]> {
  const conv = conversations.get(conversationId);
  if (!conv) return [];
  const limit = Math.max(1, Math.min(1000, (opts?.limit ?? 100)));
  return conv.messages.slice(-limit);
}