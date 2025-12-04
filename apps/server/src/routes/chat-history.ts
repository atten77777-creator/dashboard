import { Router } from 'express';
import { z } from 'zod';
import { chatEvents, listConversations, getConversation, createConversation, deleteConversation, listMessages, createMessage } from '../lib/chat-history-store';

const router = Router();

// List conversations
router.get('/conversations', async (_req, res) => {
  try {
    const items = await listConversations();
    res.json({ conversations: items });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list conversations', details: String(err?.message || err) });
  }
});

// Create conversation
router.post('/conversations', async (req, res) => {
  const body = z.object({ title: z.string().optional() });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
  try {
    const conv = await createConversation(parsed.data.title || 'Conversation');
    res.json(conv);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create conversation', details: String(err?.message || err) });
  }
});

// Get conversation (with messages)
router.get('/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await getConversation(id);
    if (!result.conversation) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get conversation', details: String(err?.message || err) });
  }
});

// Delete conversation
router.delete('/conversations/:id', async (req, res) => {
  try {
    const ok = await deleteConversation(req.params.id);
    res.json({ ok });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete conversation', details: String(err?.message || err) });
  }
});

// List messages
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const msgs = await listMessages(req.params.id);
    res.json({ messages: msgs });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list messages', details: String(err?.message || err) });
  }
});

// Create message
router.post('/conversations/:id/messages', async (req, res) => {
  const body = z.object({ role: z.enum(['user', 'assistant', 'system']), content: z.string().min(1), reply_to_message_id: z.string().optional() });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
  try {
    const msg = await createMessage({ conversationId: req.params.id, role: parsed.data.role, content: parsed.data.content, replyToId: parsed.data.reply_to_message_id });
    res.json(msg);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create message', details: String(err?.message || err) });
  }
});

// SSE: subscribe to chat history events
router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const conversationId = String(req.query.conversationId || '');
  const send = (event: any) => {
    if (conversationId) {
      const match = event?.message?.conversation_id || event?.conversation?.id || event?.conversationId;
      if (match !== conversationId) return; // filter to requested conversation
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  chatEvents.on('message', send);
  chatEvents.on('conversation', send);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
  req.on('close', () => {
    clearInterval(ping);
    chatEvents.off('message', send);
    chatEvents.off('conversation', send);
  });
});

export default router;