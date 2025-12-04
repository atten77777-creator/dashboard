import express from 'express';
import { z } from 'zod';
import { createConversation, getConversation, listMessages } from '../lib/conversations';
import { executeQuery, withTransaction } from '../lib/db';
import { schemaStore } from '../lib/schema-store';
import { logQueryError } from '../lib/logger';

const router = express.Router();

// Create a new conversation
router.post('/', async (req, res) => {
  const body = z.object({
    title: z.string().optional(),
    contextSummary: z.string().optional(),
    userId: z.string().optional(),
    schemaVersion: z.number().optional(),
  });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
  }

  try {
    const schemaVersion = parsed.data.schemaVersion ?? schemaStore.getSchemaVersion();
    const conv = await createConversation({
      title: parsed.data.title,
      userId: parsed.data.userId,
      schemaVersion,
      contextSummary: parsed.data.contextSummary ?? null,
    });
    return res.json({ id: conv.id });
  } catch (err: any) {
    logQueryError('Failed to create conversation', err, { route: 'conversations.post' });
    return res.status(500).json({ error: 'Failed to create conversation', details: String(err?.message || err) });
  }
});

// Upsert conversation metadata (used by cloud sync)
router.put('/:id', async (req, res) => {
  const idParam = z.string().min(1);
  const idResult = idParam.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ error: 'Invalid conversation id' });

  const body = z.object({
    title: z.string().optional(),
    contextSummary: z.string().optional(),
    schemaVersion: z.number().optional(),
    userId: z.string().optional(),
  });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
  }

  const { title, contextSummary, schemaVersion, userId } = parsed.data;
  try {
    await withTransaction(async (conn) => {
      const rows = await conn.execute(
        'SELECT ID FROM CONVERSATIONS WHERE ID = :id',
        { id: idResult.data },
        { autoCommit: false }
      );
      const exists = Array.isArray(rows?.rows) && rows.rows.length > 0;
      if (exists) {
        await conn.execute(
          `UPDATE CONVERSATIONS
           SET TITLE = NVL(:title, TITLE),
               USER_ID = NVL(:userId, USER_ID),
               CONTEXT_SUMMARY = NVL(:contextSummary, CONTEXT_SUMMARY),
               SCHEMA_VERSION = NVL(:schemaVersion, SCHEMA_VERSION),
               UPDATED_AT = SYSDATE
           WHERE ID = :id`,
          { id: idResult.data, title, userId: userId || null, contextSummary: contextSummary ?? null, schemaVersion: schemaVersion ?? null },
          { autoCommit: false }
        );
      } else {
        await conn.execute(
          `INSERT INTO CONVERSATIONS (ID, TITLE, USER_ID, CREATED_AT, UPDATED_AT, SCHEMA_VERSION, CONTEXT_SUMMARY)
           VALUES (:id, :title, :userId, SYSDATE, NULL, :schemaVersion, :contextSummary)`,
          { id: idResult.data, title: title || 'Untitled Conversation', userId: userId || null, schemaVersion: schemaVersion ?? null, contextSummary: contextSummary ?? null },
          { autoCommit: false }
        );
      }
    });
    return res.json({ ok: true });
  } catch (err: any) {
    logQueryError('Failed to upsert conversation', err, { route: 'conversations.put' });
    return res.status(500).json({ error: 'Failed to upsert conversation', details: String(err?.message || err) });
  }
});

// Get conversation by id
router.get('/:id', async (req, res) => {
  const idParam = z.string().min(1);
  const idResult = idParam.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ error: 'Invalid conversation id' });
  try {
    const conv = await getConversation(idResult.data);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    return res.json(conv);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to load conversation', details: String(err?.message || err) });
  }
});

// List messages for a conversation
router.get('/:id/messages', async (req, res) => {
  const idParam = z.string().min(1);
  const idResult = idParam.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ error: 'Invalid conversation id' });
  try {
    const msgs = await listMessages(idResult.data, { limit: 500 });
    return res.json({ messages: msgs });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to list messages', details: String(err?.message || err) });
  }
});

// List conversation summaries
router.get('/', async (_req, res) => {
  try {
    const rows = await executeQuery<any>(
      `SELECT ID, TITLE, CREATED_AT, UPDATED_AT
       FROM CONVERSATIONS
       ORDER BY NVL(UPDATED_AT, CREATED_AT) DESC`
    );
    const items = rows.map((r: any) => ({
      id: r.ID,
      title: r.TITLE,
      createdAt: r.CREATED_AT,
      updatedAt: r.UPDATED_AT,
    }));
    return res.json({ items });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to list conversations', details: String(err?.message || err) });
  }
});

export default router;