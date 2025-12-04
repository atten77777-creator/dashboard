import { describe, it, expect, beforeEach } from 'vitest';
import { 
  getActiveConversationId, setActiveConversationId,
  getSessionMessages, setSessionMessages,
  clearSessionMessages, clearAllSession
} from '../conversationSession';

// Ensure clean session storage before each test
beforeEach(() => {
  try {
    clearAllSession();
  } catch {}
});

describe('conversationSession', () => {
  it('tracks active conversation id', () => {
    expect(getActiveConversationId()).toBeNull();
    setActiveConversationId('abc');
    expect(getActiveConversationId()).toBe('abc');
    setActiveConversationId(null);
    expect(getActiveConversationId()).toBeNull();
  });

  it('stores and retrieves messages per conversation', () => {
    const msgs1 = [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }];
    const msgs2 = [{ role: 'user', content: 'Foo' }, { role: 'assistant', content: 'Bar' }];
    setSessionMessages('conv1', msgs1 as any);
    setSessionMessages('conv2', msgs2 as any);
    expect(getSessionMessages('conv1')?.length).toBe(2);
    expect(getSessionMessages('conv2')?.length).toBe(2);
    expect(getSessionMessages('conv1')?.[0].content).toBe('Hello');
    expect(getSessionMessages('conv2')?.[1].content).toBe('Bar');
  });

  it('clears messages for a specific conversation', () => {
    setSessionMessages('convX', [{ role: 'user', content: 'A' }] as any);
    expect(getSessionMessages('convX')?.length).toBe(1);
    clearSessionMessages('convX');
    expect(getSessionMessages('convX')).toBeNull();
  });

  it('handles large message volumes', () => {
    const big = Array.from({ length: 5000 }).map((_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: 'msg ' + i }));
    setSessionMessages('convBig', big as any);
    const loaded = getSessionMessages('convBig');
    expect(loaded?.length).toBe(5000);
    expect(loaded?.[123].content).toBe('msg 123');
  });

  it('rapid switching preserves correct active id', () => {
    setActiveConversationId('one');
    setActiveConversationId('two');
    expect(getActiveConversationId()).toBe('two');
  });
});