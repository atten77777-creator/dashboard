import { loadState, saveState } from '../lib/app-state';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

export type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  reply_to_message_id?: string;
};

export type ChatHistory = {
  conversations: Conversation[];
  messages: Message[];
};

const KEY = 'CHAT_HISTORY';
export const chatEvents = new EventEmitter();

export async function loadHistory(): Promise<ChatHistory> {
  return (await loadState<ChatHistory>(KEY)) || { conversations: [], messages: [] };
}

export async function saveHistory(h: ChatHistory): Promise<void> {
  await saveState(KEY, h);
}

export async function listConversations(): Promise<Conversation[]> {
  const h = await loadHistory();
  return h.conversations.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getConversation(id: string): Promise<{ conversation: Conversation | null; messages: Message[] }>{
  const h = await loadHistory();
  const conv = h.conversations.find(c => c.id === id) || null;
  const msgs = h.messages.filter(m => m.conversation_id === id).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { conversation: conv, messages: msgs };
}

export async function createConversation(title = 'Conversation'): Promise<Conversation> {
  const h = await loadHistory();
  const now = new Date().toISOString();
  const conv: Conversation = { id: randomUUID(), title, created_at: now, updated_at: now };
  h.conversations.push(conv);
  await saveHistory(h);
  chatEvents.emit('conversation', { type: 'created', conversation: conv });
  return conv;
}

export async function deleteConversation(id: string): Promise<boolean> {
  const h = await loadHistory();
  const before = h.conversations.length;
  h.conversations = h.conversations.filter(c => c.id !== id);
  h.messages = h.messages.filter(m => m.conversation_id !== id);
  const changed = h.conversations.length !== before;
  if (changed) {
    await saveHistory(h);
    chatEvents.emit('conversation', { type: 'deleted', conversationId: id });
  }
  return changed;
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const h = await loadHistory();
  return h.messages.filter(m => m.conversation_id === conversationId).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function createMessage(input: { conversationId: string; role: Message['role']; content: string; replyToId?: string }): Promise<Message> {
  const h = await loadHistory();
  const now = new Date().toISOString();
  const msg: Message = { id: randomUUID(), conversation_id: input.conversationId, role: input.role, content: input.content, timestamp: now, reply_to_message_id: input.replyToId };
  h.messages.push(msg);
  const conv = h.conversations.find(c => c.id === input.conversationId);
  if (conv) conv.updated_at = now;
  await saveHistory(h);
  chatEvents.emit('message', { type: 'created', message: msg });
  return msg;
}