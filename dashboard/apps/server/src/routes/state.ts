import express from 'express';
// Import the singleton instance; define a minimal interface for typing
import { schemaStore as schemaStoreInstance } from '../lib/schema-store';
import { initAppStateStore, saveState, loadState, PersistedConversations } from '../lib/app-state';
import { ensureUser, upsertConversationHistory, getConversationsForUser, isConvDbEnabled, getMessagesForConversation, getConversation, appendMessage, updateConversation, deleteConversation, updateMessage, searchMessages } from '../lib/conv-db';
import { logAccessViolation, logValidationFailure, logQueryError } from '../lib/logger';
import { getSummary as getMetricsSummary } from '../lib/metrics';

type ISchemaStore = {
  getSelectedTables(): string[];
  setSelectedTables(tables: string[]): void;
  getAllTables(): Array<{ name: string }>;
  getConfiguredLLMs(): string[];
  getLLMStatusSummary(): any;
  setLLMConfig(type: string, config: Record<string, any>): void;
  setLLMConnected(type: string, connected: boolean): void;
};

export function createStateRouter(schemaStore: ISchemaStore = schemaStoreInstance) {
  const router = express.Router();

  // Ensure store table exists
  initAppStateStore().catch(() => {});

  // Selected tables
  router.get('/selected-tables', async (_req, res) => {
    try {
      const persisted = await loadState<{ tables: string[] }>('selectedTables');
      const tables = persisted?.tables ?? schemaStore.getSelectedTables();
      res.json({ ok: true, tables });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post('/selected-tables', express.json(), async (req, res) => {
    try {
      const tables: string[] = Array.isArray(req.body?.tables) ? req.body.tables : [];
      // Basic validation: table names exist in schema
      const schemaTables = new Set(schemaStore.getAllTables().map(t => t.name));
      const valid = tables.filter(t => schemaTables.has(t));
      schemaStore.setSelectedTables(valid);
      await saveState('selectedTables', { tables: valid, ts: Date.now() });
      res.json({ ok: true, tables: valid });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // LLM configs
  router.get('/llm-configs', async (_req, res) => {
    try {
      const persisted = await loadState<any>('llmConfigs');
      const current = schemaStore.getConfiguredLLMs();
      const connected = schemaStore.getLLMStatusSummary();
      res.json({ ok: true, configs: persisted ?? current, status: connected });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post('/llm-configs', express.json(), async (req, res) => {
    try {
      const { type, config, connected } = req.body || {};
      if (!type || typeof type !== 'string') {
        return res.status(400).json({ ok: false, error: 'Missing LLM type' });
      }
      // Update schema store
      if (config) schemaStore.setLLMConfig(type, config);
      if (typeof connected === 'boolean') schemaStore.setLLMConnected(type, connected);
      const all = schemaStore.getConfiguredLLMs();
      await saveState('llmConfigs', all);
      res.json({ ok: true, configs: all });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Debug: report conversation DB enablement and relevant env vars
  router.get('/conv-db/enabled', (_req, res) => {
    try {
      res.json({
        ok: true,
        enabled: isConvDbEnabled(),
        env: {
          sqlitePath: process.env.CONV_DB_SQLITE_PATH || null,
          pgUrl: process.env.CONV_DB_URL ? 'set' : null,
          mongoUrl: process.env.CONV_DB_MONGO_URL ? 'set' : null,
        },
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Conversations
  router.get('/conversations', async (req, res) => {
    try {
      if (isConvDbEnabled()) {
        const externalId = (req.headers['x-user-id'] as string) || (req.headers['x-client-id'] as string) || req.ip || 'anonymous';
        const userId = await ensureUser(externalId);
        const list = await getConversationsForUser(userId);
        const payload: PersistedConversations = {
          version: 1,
          conversations: list.map(c => ({ id: c.id, title: c.title, createdAt: new Date(c.createdAt).getTime(), updatedAt: new Date(c.updatedAt).getTime(), messages: [] })),
          lastActiveId: list.length ? list[0].id : undefined,
        };
        res.json({ ok: true, conversations: payload });
      } else {
        const persisted = await loadState<PersistedConversations>('conversations');
        res.json({ ok: true, conversations: persisted || { version: 1, conversations: [] } });
      }
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post('/conversations', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const body = req.body as PersistedConversations;
      if (!body || typeof body !== 'object' || !Array.isArray(body.conversations)) {
        logValidationFailure('Invalid conversation payload', { bodyType: typeof body }, { route: '/state/conversations' });
        return res.status(400).json({ ok: false, error: 'Invalid conversation payload' });
      }
      if (isConvDbEnabled()) {
        const externalId = (req.headers['x-user-id'] as string) || (req.headers['x-client-id'] as string) || req.ip || 'anonymous';
        const userId = await ensureUser(externalId);
        await upsertConversationHistory(userId, { version: 1, lastActiveId: body.lastActiveId, conversations: body.conversations });
      } else {
        // Fallback to Oracle APP_STATE for dev environments without Postgres configured
        // IMPORTANT: sanitize messages to avoid persisting query results or large blobs
        const sanitizeMessages = (msgs: any[]): any[] => {
          if (!Array.isArray(msgs)) return [];
          return msgs.map((m) => {
            const role = ['system','user','assistant'].includes(String((m && m.role) || ''))
              ? String(m.role)
              : 'user';
            const content = typeof m?.content === 'string' ? m.content : (m?.content != null ? JSON.stringify(m.content) : '');
            const id = typeof m?.id === 'string' ? m.id : undefined;
            // Preserve a timestamp for ordering, but DO NOT include result data
            const createdAt = (typeof m?.ts === 'number' && isFinite(m.ts))
              ? m.ts
              : (m?.createdAt ? new Date(m.createdAt).getTime() : undefined);
            return { role, content, id, createdAt };
          });
        };
        const normalized: PersistedConversations = {
          version: 1,
          lastActiveId: body.lastActiveId,
          conversations: body.conversations.map(c => ({
            id: String(c.id || ''),
            title: String(c.title || 'Conversation'),
            createdAt: Number(c.createdAt || Date.now()),
            updatedAt: Number(c.updatedAt || Date.now()),
            // Strip volatile fields (result, multiResults, aiSuggestions, etc.) before persisting
            messages: sanitizeMessages(Array.isArray(c.messages) ? c.messages : []),
          })),
        };
        await saveState('conversations', normalized);
      }
      res.json({ ok: true });
    } catch (e: any) {
      logQueryError('Upsert conversations failed', e, { route: '/state/conversations' });
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Paginated message retrieval for a conversation
  router.get('/conversations/:id/messages', async (req, res) => {
    try {
      if (!isConvDbEnabled()) {
        return res.status(400).json({ ok: false, error: 'Server-side conversations disabled' });
      }
      const id = String(req.params.id || '');
      if (!id) {
        logValidationFailure('Missing conversation id', {}, { route: '/state/conversations/:id/messages' });
        return res.status(400).json({ ok: false, error: 'Missing conversation id' });
      }
      const limitRaw = Number(req.query.limit || 100);
      const offsetRaw = Number(req.query.offset || 0);
      const limit = Math.max(1, Math.min(1000, isFinite(limitRaw) ? limitRaw : 100));
      const offset = Math.max(0, isFinite(offsetRaw) ? offsetRaw : 0);

      const externalId = (req.headers['x-user-id'] as string) || (req.headers['x-client-id'] as string) || req.ip || 'anonymous';
      const userId = await ensureUser(externalId);
      const conv = await getConversation(id);
      if (!conv.conversation) {
        return res.status(404).json({ ok: false, error: 'Conversation not found' });
      }
      const owner = (conv.conversation.userId || conv.conversation.userId === null) ? conv.conversation.userId : null;
      if (owner && owner !== userId) {
        logAccessViolation('Conversation ownership mismatch', { conversationId: id, owner, requester: userId }, { route: '/state/conversations/:id/messages' });
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      const msgs = await getMessagesForConversation(id, limit, offset);
      res.json({ ok: true, messages: msgs });
    } catch (e: any) {
      logQueryError('Fetch conversation messages failed', e, { route: '/state/conversations/:id/messages' });
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Append a message to an existing conversation
  router.post('/conversations/:id/messages', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      if (!isConvDbEnabled()) {
        return res.status(400).json({ ok: false, error: 'Server-side conversations disabled' });
      }
      const id = String(req.params.id || '');
      const { role, content, clientMessageId, tokens } = req.body || {};
      if (!id || typeof content !== 'string' || !['system','user','assistant'].includes(String(role))) {
        return res.status(400).json({ ok: false, error: 'Invalid message payload' });
      }
      const externalId = (req.headers['x-user-id'] as string) || (req.headers['x-client-id'] as string) || req.ip || 'anonymous';
      const userId = await ensureUser(externalId);
      const conv = await getConversation(id);
      if (!conv.conversation) return res.status(404).json({ ok: false, error: 'Conversation not found' });
      const owner = (conv.conversation.userId || conv.conversation.userId === null) ? conv.conversation.userId : null;
      if (owner && owner !== userId) {
        logAccessViolation('Conversation ownership mismatch', { conversationId: id, owner, requester: userId }, { route: '/state/conversations/:id/messages' });
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      const mid = await appendMessage(id, role, content, Number.isFinite(tokens) ? Number(tokens) : undefined, typeof clientMessageId === 'string' ? clientMessageId : undefined);
      res.json({ ok: true, messageId: mid });
    } catch (e: any) {
      logQueryError('Append message failed', e, { route: '/state/conversations/:id/messages' });
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Update conversation attributes (title, status, tags, expiresAt)
  router.patch('/conversations/:id', express.json(), async (req, res) => {
    try {
      if (!isConvDbEnabled()) return res.status(400).json({ ok: false, error: 'Server-side conversations disabled' });
      const id = String(req.params.id || '');
      if (!id) return res.status(400).json({ ok: false, error: 'Missing conversation id' });
      const externalId = (req.headers['x-user-id'] as string) || (req.headers['x-client-id'] as string) || req.ip || 'anonymous';
      const userId = await ensureUser(externalId);
      const conv = await getConversation(id);
      if (!conv.conversation) return res.status(404).json({ ok: false, error: 'Conversation not found' });
      const owner = (conv.conversation.userId || conv.conversation.userId === null) ? conv.conversation.userId : null;
      if (owner && owner !== userId) {
        logAccessViolation('Conversation ownership mismatch', { conversationId: id, owner, requester: userId }, { route: '/state/conversations/:id' });
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      const { title, status, tags, expiresAt } = req.body || {};
      await updateConversation(id, { title: typeof title === 'string' ? title : undefined, status: ['active','archived'].includes(String(status)) ? status : undefined, tags: Array.isArray(tags) ? tags.filter((t: any) => typeof t === 'string') : undefined, expiresAt: (expiresAt ? new Date(expiresAt) : undefined) });
      res.json({ ok: true });
    } catch (e: any) {
      logQueryError('Update conversation failed', e, { route: '/state/conversations/:id' });
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Delete a conversation
  router.delete('/conversations/:id', async (req, res) => {
    try {
      if (!isConvDbEnabled()) return res.status(400).json({ ok: false, error: 'Server-side conversations disabled' });
      const id = String(req.params.id || '');
      if (!id) return res.status(400).json({ ok: false, error: 'Missing conversation id' });
      const externalId = (req.headers['x-user-id'] as string) || (req.headers['x-client-id'] as string) || req.ip || 'anonymous';
      const userId = await ensureUser(externalId);
      const conv = await getConversation(id);
      if (!conv.conversation) return res.status(404).json({ ok: false, error: 'Conversation not found' });
      const owner = (conv.conversation.userId || conv.conversation.userId === null) ? conv.conversation.userId : null;
      if (owner && owner !== userId) {
        logAccessViolation('Conversation ownership mismatch', { conversationId: id, owner, requester: userId }, { route: '/state/conversations/:id' });
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      await deleteConversation(id);
      res.json({ ok: true });
    } catch (e: any) {
      logQueryError('Delete conversation failed', e, { route: '/state/conversations/:id' });
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Update a message within a conversation
  router.patch('/conversations/:id/messages/:mid', express.json(), async (req, res) => {
    try {
      if (!isConvDbEnabled()) return res.status(400).json({ ok: false, error: 'Server-side conversations disabled' });
      const id = String(req.params.id || '');
      const mid = String(req.params.mid || '');
      if (!id || !mid) return res.status(400).json({ ok: false, error: 'Missing ids' });
      const externalId = (req.headers['x-user-id'] as string) || (req.headers['x-client-id'] as string) || req.ip || 'anonymous';
      const userId = await ensureUser(externalId);
      const conv = await getConversation(id);
      if (!conv.conversation) return res.status(404).json({ ok: false, error: 'Conversation not found' });
      const owner = (conv.conversation.userId || conv.conversation.userId === null) ? conv.conversation.userId : null;
      if (owner && owner !== userId) {
        logAccessViolation('Conversation ownership mismatch', { conversationId: id, owner, requester: userId }, { route: '/state/conversations/:id/messages/:mid' });
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      const { status, metadata, content, tokens } = req.body || {};
      await updateMessage(mid, { status: typeof status === 'string' ? status : undefined, metadata, content: typeof content === 'string' ? content : undefined, tokens: (tokens !== undefined ? Number(tokens) : undefined) });
      res.json({ ok: true });
    } catch (e: any) {
      logQueryError('Update message failed', e, { route: '/state/conversations/:id/messages/:mid' });
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Search messages across user's conversations
  router.get('/messages/search', async (req, res) => {
    try {
      if (!isConvDbEnabled()) return res.status(400).json({ ok: false, error: 'Server-side conversations disabled' });
      const q = String(req.query.q || '').trim();
      if (!q) return res.status(400).json({ ok: false, error: 'Missing query' });
      const limitRaw = Number(req.query.limit || 50);
      const offsetRaw = Number(req.query.offset || 0);
      const limit = Math.max(1, Math.min(500, isFinite(limitRaw) ? limitRaw : 50));
      const offset = Math.max(0, isFinite(offsetRaw) ? offsetRaw : 0);
      const externalId = (req.headers['x-user-id'] as string) || (req.headers['x-client-id'] as string) || req.ip || 'anonymous';
      const userId = await ensureUser(externalId);
      const rows = await searchMessages(userId, q, limit, offset);
      res.json({ ok: true, results: rows });
    } catch (e: any) {
      logQueryError('Search messages failed', e, { route: '/state/messages/search' });
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Latency metrics summary
  router.get('/metrics', (_req, res) => {
    try {
      const summary = getMetricsSummary();
      res.json({ ok: true, metrics: summary });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  return router;
}