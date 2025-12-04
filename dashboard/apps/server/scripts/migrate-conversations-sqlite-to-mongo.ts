import 'dotenv/config';
import Database from 'better-sqlite3';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

async function main() {
  const sqlitePath = process.env.CONV_DB_SQLITE_PATH || process.argv[2];
  const mongoUrl = process.env.CONV_DB_MONGO_URL || '';
  const mongoDbName = process.env.CONV_DB_MONGO_DB || undefined;
  if (!sqlitePath) {
    console.error('Missing SQLite path. Set CONV_DB_SQLITE_PATH or pass as argv[2].');
    process.exit(1);
  }
  if (!mongoUrl) {
    console.error('Missing Mongo URL. Set CONV_DB_MONGO_URL.');
    process.exit(1);
  }
  const sqlite = new Database(sqlitePath);
  const client = new MongoClient(mongoUrl);
  await client.connect();
  const db = client.db(mongoDbName);
  const users = db.collection('users');
  const sessions = db.collection('sessions');
  const conversations = db.collection('conversations');
  const messages = db.collection('messages');

  // Snapshot backup
  const backupDir = process.env.CONV_DB_BACKUP_DIR || path.join(path.dirname(sqlitePath), 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:]/g, '-');
  const backupPath = path.join(backupDir, `sqlite-export-${ts}.json`);

  try {
    const snap: any = { users: [], sessions: [], conversations: [], messages: [] };
    const uRows = sqlite.prepare('SELECT id, external_id AS externalId, created_at AS createdAt FROM users').all() as any[];
    const sRows = sqlite.prepare('SELECT id, user_id AS userId, server_id AS serverId, created_at AS createdAt, metadata FROM sessions').all() as any[];
    const cRows = sqlite.prepare('SELECT id, user_id AS userId, session_id AS sessionId, title, status, created_at AS createdAt, updated_at AS updatedAt, expires_at AS expiresAt FROM conversations').all() as any[];
    const mRows = sqlite.prepare('SELECT id, conversation_id AS conversationId, role, content, tokens, created_at AS createdAt, client_id AS clientId FROM messages').all() as any[];
    snap.users = uRows; snap.sessions = sRows; snap.conversations = cRows; snap.messages = mRows;
    fs.writeFileSync(backupPath, JSON.stringify(snap, null, 2), 'utf8');
    console.log('Wrote JSON export backup:', backupPath);

    // Upserts with optional transaction
    const useTxn = (process.env.CONV_DB_MONGO_TXN || '').toLowerCase() === 'true';
    const session = client.startSession();
    try {
      if (useTxn) await session.startTransaction();
      for (const u of uRows) {
        await users.updateOne({ id: u.id }, { $set: { id: u.id, externalId: u.externalId || null, createdAt: new Date(u.createdAt || Date.now()) } }, { upsert: true, session });
      }
      for (const s of sRows) {
        await sessions.updateOne({ id: s.id }, { $set: { id: s.id, userId: s.userId, serverId: s.serverId || null, createdAt: new Date(s.createdAt || Date.now()), metadata: s.metadata ? JSON.parse(String(s.metadata)) : null } }, { upsert: true, session });
      }
      for (const c of cRows) {
        await conversations.updateOne({ id: c.id }, { $set: { id: c.id, userId: c.userId || null, sessionId: c.sessionId || null, title: c.title || 'Conversation', status: c.status || 'active', createdAt: new Date(c.createdAt || Date.now()), updatedAt: new Date(c.updatedAt || Date.now()), expiresAt: c.expiresAt ? new Date(c.expiresAt) : null } }, { upsert: true, session });
      }
      if (mRows.length) {
        const ops = mRows.map(m => ({ updateOne: { filter: { id: m.id }, update: { $set: { id: m.id, conversationId: m.conversationId, role: m.role, content: m.content, tokens: m.tokens ?? null, clientId: m.clientId || null, createdAt: new Date(m.createdAt || Date.now()) } }, upsert: true } }));
        // Bulk upsert in chunks to avoid payload limits
        const CHUNK = 1000;
        for (let i = 0; i < ops.length; i += CHUNK) {
          await messages.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false, session });
        }
      }
      if (useTxn) await session.commitTransaction();
      console.log('Migration complete:', { users: uRows.length, sessions: sRows.length, conversations: cRows.length, messages: mRows.length });
    } catch (err) {
      if (useTxn) { try { await session.abortTransaction(); } catch {} }
      console.error('Migration error:', err);
      process.exitCode = 1;
    } finally {
      await session.endSession();
    }
  } finally {
    try { sqlite.close(); } catch {}
    await client.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });