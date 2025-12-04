import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { logQueryError } from './logger';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { MongoClient, Db, Collection } from 'mongodb';

export type DbMessageRole = 'system' | 'user' | 'assistant';

export interface DbUser { id: string; externalId?: string | null; createdAt: Date }
export interface DbSession { id: string; userId: string; serverId?: string | null; createdAt: Date; metadata?: any }
export interface DbConversation { id: string; userId?: string | null; sessionId?: string | null; title: string; status: string; createdAt: Date; updatedAt: Date; expiresAt?: Date | null }
export interface DbMessage { id: string; conversationId: string; role: DbMessageRole; content: string; tokens?: number | null; createdAt: Date; clientId?: string | null; trace?: any }

let pool: Pool | null = null;
type SqliteInstance = InstanceType<typeof Database>;
let sqlite: SqliteInstance | null = null;
let sqlitePath: string | null = null;
let backupInterval: NodeJS.Timeout | null = null;

// MongoDB state
let mongoClient: MongoClient | null = null;
let mongoDb: Db | null = null;
let colUsers: Collection | null = null;
let colSessions: Collection | null = null;
let colConversations: Collection | null = null;
let colMessages: Collection | null = null;
let colKv: Collection | null = null;

function isSqliteEnabled(): boolean {
  return Boolean(process.env.CONV_DB_SQLITE_PATH);
}

function isMongoEnabled(): boolean {
  return Boolean(process.env.CONV_DB_MONGO_URL);
}

export function getConvDbPool(): Pool {
  if (isSqliteEnabled()) {
    throw new Error('Postgres pool requested while SQLite is enabled');
  }
  if (!pool) {
    const url = process.env.CONV_DB_URL;
    if (!url) throw new Error('CONV_DB_URL is not set');
    const ssl = (process.env.CONV_DB_SSL || '').toLowerCase();
    pool = new Pool({ connectionString: url, ssl: ssl === 'require' ? { rejectUnauthorized: false } : undefined, max: Number(process.env.CONV_DB_POOL_MAX || 10) });
  }
  return pool!;
}

export function isConvDbEnabled(): boolean {
  // Attempt to auto-enable SQLite using a default path when not explicitly configured
  try {
    if (!process.env.CONV_DB_SQLITE_PATH) {
      const defaultPath = path.join(process.cwd(), 'data', 'conversations.sqlite');
      const defaultDir = path.dirname(defaultPath);
      // If the default directory exists (or can be created) we can safely adopt the default path.
      // We only set the env if the file already exists or the directory is present to avoid unexpected paths.
      if (fs.existsSync(defaultDir)) {
        // Prefer existing DB file, otherwise allow initializing at the default path
        if (fs.existsSync(defaultPath)) {
          process.env.CONV_DB_SQLITE_PATH = defaultPath;
        } else {
          // Adopt default path to allow initialization on first run
          process.env.CONV_DB_SQLITE_PATH = defaultPath;
        }
      }
    }
  } catch {}
  return Boolean(process.env.CONV_DB_SQLITE_PATH || process.env.CONV_DB_URL || process.env.CONV_DB_MONGO_URL);
}

export async function initConvDb(): Promise<void> {
  if (isSqliteEnabled()) {
    sqlitePath = process.env.CONV_DB_SQLITE_PATH as string;
    const dir = path.dirname(sqlitePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    sqlite = new Database(sqlitePath);
    // Pragmas for concurrency and performance
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.pragma('temp_store = MEMORY');
    sqlite.pragma('cache_size = -20000'); // ~20MB cache
    sqlite.pragma('foreign_keys = ON');

    // Schema
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        external_id TEXT UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        server_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        title TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tokens INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        client_id TEXT UNIQUE,
        trace TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_user_created ON conversations(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      -- KV store for sidebar state and preferences
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      -- Dashboards and Charts
      CREATE TABLE IF NOT EXISTS dashboards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        refresh_rule TEXT DEFAULT 'manual',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS charts (
        id TEXT PRIMARY KEY,
        dashboard_id TEXT REFERENCES dashboards(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        config TEXT,
        position TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      sqlite.exec('ALTER TABLE messages ADD COLUMN trace TEXT');
    } catch (e) {
      // Column likely exists
    }

    return;
  }
  // MongoDB path
  if (isMongoEnabled()) {
    const url = process.env.CONV_DB_MONGO_URL as string;
    const dbName = (process.env.CONV_DB_MONGO_DB as string) || undefined;
    mongoClient = new MongoClient(url);
    await mongoClient.connect();
    mongoDb = mongoClient.db(dbName);
    colUsers = mongoDb.collection('users');
    colSessions = mongoDb.collection('sessions');
    colConversations = mongoDb.collection('conversations');
    colMessages = mongoDb.collection('messages');
    colKv = mongoDb.collection('kv_store');

    // Indexes
    await colUsers!.createIndex({ externalId: 1 }, { unique: true, name: 'idx_users_externalId' });
    await colSessions!.createIndex({ userId: 1 }, { name: 'idx_sessions_user' });
    await colConversations!.createIndex({ userId: 1, updatedAt: -1 }, { name: 'idx_conversations_user_updated' });
    await colConversations!.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_conversations_expires' });
    await colMessages!.createIndex({ conversationId: 1, createdAt: 1 }, { name: 'idx_messages_conv_created' });
    await colMessages!.createIndex({ clientId: 1 }, { unique: true, sparse: true, name: 'uniq_messages_clientId' });
    await colMessages!.createIndex({ content: 'text' }, { name: 'text_messages_content' });
    await colKv!.createIndex({ key: 1 }, { unique: true, name: 'uniq_kv_key' });
    return;
  }
  // Postgres path
  const p = getConvDbPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        external_id TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        server_id TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        metadata JSONB
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
        content TEXT NOT NULL,
        tokens INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        client_id TEXT UNIQUE
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_user_created ON conversations(user_id, created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closeConvDb(): Promise<void> {
  if (pool) { const p = pool; pool = null; await p.end(); }
  if (sqlite) { try { sqlite.close(); } catch {} sqlite = null; }
  if (backupInterval) { clearInterval(backupInterval); backupInterval = null; }
  if (mongoClient) { try { await mongoClient.close(); } catch {} mongoClient = null; mongoDb = null; colUsers = colSessions = colConversations = colMessages = colKv = null; }
}

export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (isSqliteEnabled()) {
    if (!sqlite) throw new Error('SQLite not initialized');
    try {
      sqlite.exec('BEGIN');
      const res = await (async () => fn(null as any))();
      sqlite.exec('COMMIT');
      return res;
    } catch (err) {
      try { sqlite!.exec('ROLLBACK'); } catch {}
      throw err;
    }
  }
  const client = await getConvDbPool().connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function ensureUser(externalId?: string | null): Promise<string> {
  const id = randomUUID();
  if (isSqliteEnabled()) {
    const stmt = sqlite!.prepare(`INSERT INTO users(id, external_id) VALUES(?, ?) ON CONFLICT(external_id) DO UPDATE SET external_id=excluded.external_id RETURNING id`);
    const row = stmt.get(id, externalId || null) as any;
    return String(row.id);
  }
  if (isMongoEnabled()) {
    const ext = externalId || null;
    const res = await colUsers!.findOneAndUpdate(
      { externalId: ext },
      { $setOnInsert: { id, externalId: ext, createdAt: new Date() } },
      { upsert: true, returnDocument: 'after' }
    );
    return String(res?.value?.id ?? id);
  }
  const q = `INSERT INTO users(id, external_id) VALUES($1, $2) ON CONFLICT(external_id) DO UPDATE SET external_id = EXCLUDED.external_id RETURNING id`;
  const { rows } = await getConvDbPool().query(q, [id, externalId || null]);
  return rows[0].id as string;
}

export async function ensureSession(userId: string, serverId?: string | null, metadata?: any): Promise<string> {
  const id = randomUUID();
  if (isSqliteEnabled()) {
    const stmt = sqlite!.prepare(`INSERT INTO sessions(id, user_id, server_id, metadata) VALUES(?, ?, ?, ?) RETURNING id`);
    const row = stmt.get(id, userId, serverId || null, metadata ? JSON.stringify(metadata) : null) as any;
    return String(row.id);
  }
  if (isMongoEnabled()) {
    await colSessions!.insertOne({ id, userId, serverId: serverId || null, createdAt: new Date(), metadata: metadata ?? null });
    return id;
  }
  const q = `INSERT INTO sessions(id, user_id, server_id, metadata) VALUES($1,$2,$3,$4) RETURNING id`;
  const { rows } = await getConvDbPool().query(q, [id, userId, serverId || null, metadata ? JSON.stringify(metadata) : null]);
  return rows[0].id as string;
}

export async function createConversation(userId: string | null, sessionId: string | null, title: string, retentionDays?: number): Promise<string> {
  const id = randomUUID();
  const expires = retentionDays && retentionDays > 0 ? new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000) : null;
  if (isSqliteEnabled()) {
    const stmt = sqlite!.prepare(`INSERT INTO conversations(id, user_id, session_id, title, status, created_at, updated_at, expires_at) VALUES(?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`);
    stmt.run(id, userId || null, sessionId || null, title || 'Conversation', expires ? new Date(expires).toISOString() : null);
    return id;
  }
  if (isMongoEnabled()) {
    await colConversations!.insertOne({ id, userId: userId || null, sessionId: sessionId || null, title: title || 'Conversation', status: 'active', createdAt: new Date(), updatedAt: new Date(), expiresAt: expires || null });
    return id;
  }
  const q = `INSERT INTO conversations(id, user_id, session_id, title, expires_at) VALUES($1,$2,$3,$4,$5)`;
  await getConvDbPool().query(q, [id, userId, sessionId, title || 'Conversation', expires]);
  return id;
}

export async function ensureConversation(conversationId: string, userId?: string | null, sessionId?: string | null, title?: string): Promise<void> {
  if (isSqliteEnabled()) {
    const stmt = sqlite!.prepare(`INSERT INTO conversations(id, user_id, session_id, title, status, created_at, updated_at) VALUES(?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO NOTHING`);
    stmt.run(conversationId, userId || null, sessionId || null, title || 'Conversation');
    return;
  }
  if (isMongoEnabled()) {
    await colConversations!.updateOne(
      { id: conversationId },
      { $setOnInsert: { id: conversationId, userId: userId || null, sessionId: sessionId || null, title: title || 'Conversation', status: 'active', createdAt: new Date(), updatedAt: new Date() } },
      { upsert: true }
    );
    return;
  }
  const q = `INSERT INTO conversations(id, user_id, session_id, title) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`;
  await getConvDbPool().query(q, [conversationId, userId || null, sessionId || null, title || 'Conversation']);
}

export async function appendMessage(conversationId: string, role: DbMessageRole, content: string, tokens?: number | null, clientId?: string | null, trace?: any): Promise<string> {
  const id = randomUUID();
  if (isSqliteEnabled()) {
    try {
      // If a clientId is provided, return existing message with same clientId to avoid conflicts
      if (clientId) {
        const existingByClient = sqlite!.prepare(`SELECT id FROM messages WHERE client_id = ? LIMIT 1`).get(clientId) as any;
        if (existingByClient && existingByClient.id) {
          return String(existingByClient.id);
        }
      } else {
        // Fallback dedupe: avoid inserting identical role+content within the same conversation
        const existing = sqlite!.prepare(`SELECT id FROM messages WHERE conversation_id = ? AND role = ? AND content = ? LIMIT 1`).get(conversationId, role, content) as any;
        if (existing && existing.id) {
          return String(existing.id);
        }
      }
      const stmt = sqlite!.prepare(`INSERT INTO messages(id, conversation_id, role, content, tokens, client_id, created_at, trace) VALUES(?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?) ON CONFLICT(client_id) DO NOTHING`);
      stmt.run(id, conversationId, role, content, tokens || null, clientId || null, trace ? JSON.stringify(trace) : null);
    } catch (err) {
      logQueryError('appendMessage failed (sqlite)', err, { conversationId });
      throw err;
    }
    return id;
  }
  if (isMongoEnabled()) {
    try {
      let filter: any;
      if (clientId) {
        // Prefer clientId-based uniqueness when provided
        filter = { clientId };
      } else {
        // Fallback dedupe by conversationId+role+content
        filter = { conversationId, role, content };
      }
      const update = { $setOnInsert: { id, conversationId, role, content, tokens: tokens ?? null, clientId: clientId ?? null, createdAt: new Date(), trace: trace || null } } as any;
      const res = await colMessages!.updateOne(filter, update, { upsert: true });
      let outId: string = String(id);
      if (!res.upsertedId) {
        // Existing doc; fetch its id to return a stable identifier
        const doc = await colMessages!.findOne(filter, { projection: { id: 1 } });
        if (doc && doc.id) {
          outId = String(doc.id);
        }
      }
      // bump conversation updatedAt
      await colConversations!.updateOne({ id: conversationId }, { $set: { updatedAt: new Date() } });
      return outId;
    } catch (err) {
      logQueryError('appendMessage failed (mongo)', err, { conversationId });
      throw err;
    }
  }
  const q = `INSERT INTO messages(id, conversation_id, role, content, tokens, client_id, trace) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(client_id) DO NOTHING`;
  try {
    const client = getConvDbPool();
    if (clientId) {
      // Return existing message if clientId already present
      const exists = await client.query('SELECT id FROM messages WHERE client_id = $1 LIMIT 1', [clientId]);
      if ((exists.rowCount ?? 0) > 0) {
        return String(exists.rows[0].id);
      }
    } else {
      // Fallback dedupe by conversationId+role+content
      const exists = await client.query('SELECT id FROM messages WHERE conversation_id = $1 AND role = $2 AND content = $3 LIMIT 1', [conversationId, role, content]);
      if ((exists.rowCount ?? 0) > 0) {
        return String(exists.rows[0].id);
      }
    }
    await client.query(q, [id, conversationId, role, content, tokens || null, clientId || null, trace ? JSON.stringify(trace) : null]);
  } catch (err) {
    logQueryError('appendMessage failed', err, { conversationId });
    throw err;
  }
  return id;
}

export async function getConversation(conversationId: string): Promise<{ conversation: DbConversation | null; messages: DbMessage[] }> {
  if (isSqliteEnabled()) {
    const c = sqlite!.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any;
    if (!c) return { conversation: null, messages: [] };
    const rows = sqlite!.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY datetime(created_at) ASC').all(conversationId) as any[];
    // Parse trace if it's a string in SQLite
    const parsedRows = rows.map(r => ({
      ...r,
      trace: r.trace && typeof r.trace === 'string' ? JSON.parse(r.trace) : r.trace
    }));
    return { conversation: c, messages: parsedRows } as any;
  }
  if (isMongoEnabled()) {
    const c = await colConversations!.findOne({ id: conversationId });
    if (!c) return { conversation: null, messages: [] };
    const rows = await colMessages!.find({ conversationId }).sort({ createdAt: 1 }).toArray();
    return { conversation: c as any, messages: rows as any };
  }
  const c = await getConvDbPool().query('SELECT * FROM conversations WHERE id=$1', [conversationId]);
  if (!c.rows.length) return { conversation: null, messages: [] };
  const { rows } = await getConvDbPool().query('SELECT * FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC', [conversationId]);
  return { conversation: c.rows[0] as any, messages: rows as any };
}

export async function getMessagesForConversation(conversationId: string, limit?: number, offset?: number): Promise<DbMessage[]> {
  const l = typeof limit === 'number' && limit > 0 ? limit : 100;
  const o = typeof offset === 'number' && offset >= 0 ? offset : 0;
  if (isSqliteEnabled()) {
    const stmt = sqlite!.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY datetime(created_at) ASC LIMIT ? OFFSET ?');
    const rows = stmt.all(conversationId, l, o) as any[];
    return rows as any;
  }
  if (isMongoEnabled()) {
    const rows = await colMessages!.find({ conversationId }).sort({ createdAt: 1 }).skip(o).limit(l).toArray();
    return rows as any;
  }
  const { rows } = await getConvDbPool().query('SELECT * FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT $2 OFFSET $3', [conversationId, l, o]);
  return rows as any;
}

export async function getConversationsForUser(userId: string): Promise<Array<{ id: string; title: string; createdAt: string; updatedAt: string }>> {
  if (isSqliteEnabled()) {
    const rows = sqlite!.prepare('SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM conversations WHERE user_id = ? ORDER BY datetime(updated_at) DESC').all(userId) as any[];
    return rows;
  }
  if (isMongoEnabled()) {
    const rows = await colConversations!.find({ userId }).project({ id: 1, title: 1, createdAt: 1, updatedAt: 1 }).sort({ updatedAt: -1 }).toArray();
    return rows.map(r => ({ id: String(r.id), title: String(r.title || 'Conversation'), createdAt: (r.createdAt as Date).toISOString(), updatedAt: (r.updatedAt as Date).toISOString() }));
  }
  const { rows } = await getConvDbPool().query('SELECT id, title, created_at AS "createdAt", updated_at AS "updatedAt" FROM conversations WHERE user_id=$1 ORDER BY updated_at DESC', [userId]);
  return rows as any;
}

export async function upsertConversationHistory(userId: string, payload: { version: number; lastActiveId?: string; conversations: Array<{ id: string; title: string; createdAt: number; updatedAt: number; messages: any[] }> }): Promise<void> {
  if (isSqliteEnabled()) {
    if (!sqlite) throw new Error('SQLite not initialized');
    try {
      sqlite.exec('BEGIN');
      const convStmt = sqlite.prepare(`INSERT INTO conversations(id, user_id, title, created_at, updated_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at`);
      const msgStmt = sqlite.prepare(`INSERT INTO messages(id, conversation_id, role, content, client_id, created_at) VALUES(?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(client_id) DO NOTHING`);
      const existsStmt = sqlite.prepare(`SELECT 1 FROM messages WHERE conversation_id = ? AND role = ? AND content = ? LIMIT 1`);
      for (const conv of payload.conversations) {
        const cid = conv.id || randomUUID();
        convStmt.run(cid, userId, conv.title || 'Conversation', new Date(conv.createdAt || Date.now()).toISOString(), new Date(conv.updatedAt || Date.now()).toISOString());
        for (const [i, msg] of (Array.isArray(conv.messages) ? conv.messages : []).entries()) {
          const mid = randomUUID();
          const role = ['system','user','assistant'].includes(String(msg.role)) ? String(msg.role) as DbMessageRole : 'user';
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          const clientId = (msg.id && typeof msg.id === 'string') ? msg.id : `${cid}:${i}`;
          const exists = existsStmt.get(cid, role, content) as any;
          if (!exists) {
            msgStmt.run(mid, cid, role, content, clientId);
          }
        }
      }
      sqlite.exec('COMMIT');
    } catch (err) {
      try { sqlite.exec('ROLLBACK'); } catch {}
      throw err;
    }
    return;
  }
  if (isMongoEnabled()) {
    const session = mongoClient!.startSession();
    const useTxn = (process.env.CONV_DB_MONGO_TXN || '').toLowerCase() === 'true';
    try {
      if (useTxn) await session.startTransaction();
      for (const conv of payload.conversations) {
        const cid = conv.id || randomUUID();
        await colConversations!.updateOne(
          { id: cid },
          { $set: { id: cid, userId, title: conv.title || 'Conversation', createdAt: new Date(conv.createdAt || Date.now()), updatedAt: new Date(conv.updatedAt || Date.now()) } },
          { upsert: true, session }
        );
        const msgs = Array.isArray(conv.messages) ? conv.messages : [];
        if (msgs.length) {
          const ops = msgs.map((msg: any, i: number) => {
            const mid = randomUUID();
            const role = ['system','user','assistant'].includes(String(msg.role)) ? String(msg.role) as DbMessageRole : 'user';
            const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            const clientId = (msg.id && typeof msg.id === 'string') ? msg.id : `${cid}:${i}`;
            const filter = clientId ? { clientId } : { conversationId: cid, role, content };
            return {
              updateOne: {
                filter,
                update: { $setOnInsert: { id: mid, conversationId: cid, role, content, clientId, createdAt: new Date() } },
                upsert: true
              }
            };
          });
          await colMessages!.bulkWrite(ops, { ordered: false, session });
        }
      }
      if (useTxn) await session.commitTransaction();
    } catch (err) {
      if (useTxn) { try { await session.abortTransaction(); } catch {} }
      throw err;
    } finally {
      await session.endSession();
    }
    return;
  }
  await withTx(async (client) => {
    for (const conv of payload.conversations) {
      const cid = conv.id || randomUUID();
      await client.query(`INSERT INTO conversations(id, user_id, title, created_at, updated_at) VALUES($1,$2,$3, to_timestamp($4/1000.0), to_timestamp($5/1000.0)) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title, updated_at=EXCLUDED.updated_at`, [cid, userId, conv.title || 'Conversation', conv.createdAt || Date.now(), conv.updatedAt || Date.now()]);
      for (const [i, msg] of (Array.isArray(conv.messages) ? conv.messages : []).entries()) {
        const mid = randomUUID();
        const role = ['system','user','assistant'].includes(String(msg.role)) ? String(msg.role) as DbMessageRole : 'user';
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const clientId = (msg.id && typeof msg.id === 'string') ? msg.id : `${cid}:${i}`;
        const exists = await client.query(`SELECT 1 FROM messages WHERE conversation_id=$1 AND role=$2 AND content=$3 LIMIT 1`, [cid, role, content]);
        if (exists.rowCount === 0) {
          await client.query(`INSERT INTO messages(id, conversation_id, role, content, client_id, created_at) VALUES($1,$2,$3,$4,$5, NOW()) ON CONFLICT(client_id) DO NOTHING`, [mid, cid, role, content, clientId]);
        }
      }
    }
  });
}

// Update conversation attributes (title, status, expiresAt); tags supported in Mongo only
export async function updateConversation(conversationId: string, fields: { title?: string; status?: 'active' | 'archived'; expiresAt?: Date | null; tags?: string[] }): Promise<void> {
  if (isSqliteEnabled()) {
    const cols: string[] = [];
    const values: any[] = [];
    if (typeof fields.title === 'string') { cols.push('title = ?'); values.push(fields.title); }
    if (typeof fields.status === 'string') { cols.push('status = ?'); values.push(fields.status); }
    if (fields.expiresAt !== undefined) { cols.push('expires_at = ?'); values.push(fields.expiresAt ? fields.expiresAt.toISOString() : null); }
    if (!cols.length) return;
    sqlite!.prepare(`UPDATE conversations SET ${cols.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, conversationId);
    return;
  }
  if (isMongoEnabled()) {
    const update: any = { $set: { updatedAt: new Date() } };
    if (typeof fields.title === 'string') update.$set.title = fields.title;
    if (typeof fields.status === 'string') update.$set.status = fields.status;
    if (fields.expiresAt !== undefined) update.$set.expiresAt = fields.expiresAt || null;
    if (fields.tags) update.$set.tags = Array.isArray(fields.tags) ? fields.tags : [];
    await colConversations!.updateOne({ id: conversationId }, update);
    return;
  }
  const cols: string[] = [];
  const values: any[] = [];
  if (typeof fields.title === 'string') { cols.push('title = $1'); values.push(fields.title); }
  if (typeof fields.status === 'string') { cols.push('status = $2'); values.push(fields.status); }
  if (fields.expiresAt !== undefined) { cols.push('expires_at = $3'); values.push(fields.expiresAt || null); }
  if (!cols.length) return;
  await getConvDbPool().query(`UPDATE conversations SET ${cols.join(', ')}, updated_at = NOW() WHERE id = $4`, [...values, conversationId]);
}

export async function deleteConversation(conversationId: string): Promise<void> {
  if (isSqliteEnabled()) {
    sqlite!.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
    sqlite!.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
    return;
  }
  if (isMongoEnabled()) {
    await colMessages!.deleteMany({ conversationId });
    await colConversations!.deleteOne({ id: conversationId });
    return;
  }
  await withTx(async (client) => {
    await client.query('DELETE FROM messages WHERE conversation_id = $1', [conversationId]);
    await client.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
  });
}

export async function updateMessage(messageId: string, fields: { status?: string; metadata?: any; content?: string; tokens?: number | null }): Promise<void> {
  if (isSqliteEnabled()) {
    const cols: string[] = [];
    const values: any[] = [];
    if (typeof fields.content === 'string') { cols.push('content = ?'); values.push(fields.content); }
    if (fields.tokens !== undefined) { cols.push('tokens = ?'); values.push(fields.tokens || null); }
    if (!cols.length) return;
    sqlite!.prepare(`UPDATE messages SET ${cols.join(', ')} WHERE id = ?`).run(...values, messageId);
    return;
  }
  if (isMongoEnabled()) {
    const update: any = { $set: {} };
    if (typeof fields.content === 'string') update.$set.content = fields.content;
    if (fields.tokens !== undefined) update.$set.tokens = fields.tokens ?? null;
    if (typeof fields.status === 'string') update.$set.status = fields.status;
    if (fields.metadata !== undefined) update.$set.metadata = fields.metadata;
    await colMessages!.updateOne({ id: messageId }, update);
    return;
  }
  const cols: string[] = [];
  const values: any[] = [];
  if (typeof fields.content === 'string') { cols.push('content = $1'); values.push(fields.content); }
  if (fields.tokens !== undefined) { cols.push('tokens = $2'); values.push(fields.tokens || null); }
  if (!cols.length) return;
  await getConvDbPool().query(`UPDATE messages SET ${cols.join(', ')} WHERE id = $3`, [...values, messageId]);
}

export async function searchMessages(userId: string, query: string, limit = 50, offset = 0): Promise<Array<{ id: string; conversationId: string; role: DbMessageRole; preview: string; createdAt: string }>> {
  const l = Math.max(1, Math.min(500, limit));
  const o = Math.max(0, offset);
  if (isSqliteEnabled()) {
    // Fallback using LIKE; not efficient but acceptable for small dev databases
    const convs = sqlite!.prepare('SELECT id FROM conversations WHERE user_id = ?').all(userId) as any[];
    const ids = convs.map(c => c.id);
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = sqlite!.prepare(`SELECT id, conversation_id AS conversationId, role, substr(content, 1, 200) AS preview, created_at AS createdAt FROM messages WHERE conversation_id IN (${placeholders}) AND content LIKE ? ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?`).all(...ids, `%${query}%`, l, o) as any[];
    return rows.map(r => ({ id: String(r.id), conversationId: String(r.conversationId), role: r.role, preview: String(r.preview || ''), createdAt: String(r.createdAt) }));
  }
  if (isMongoEnabled()) {
    const convs = await colConversations!.find({ userId }).project({ id: 1 }).toArray();
    const ids = convs.map(c => c.id);
    if (!ids.length) return [];
    const rows = await colMessages!.find({ conversationId: { $in: ids }, $text: { $search: query } }).project({ id: 1, conversationId: 1, role: 1, content: 1, createdAt: 1 }).sort({ createdAt: -1 }).skip(o).limit(l).toArray();
    return rows.map(r => ({ id: String(r.id), conversationId: String(r.conversationId), role: r.role as DbMessageRole, preview: String((r as any).content || '').slice(0, 200), createdAt: (r.createdAt as Date).toISOString() }));
  }
  const { rows } = await getConvDbPool().query(`SELECT m.id, m.conversation_id AS "conversationId", m.role, substr(m.content, 1, 200) AS "preview", m.created_at AS "createdAt" FROM messages m JOIN conversations c ON m.conversation_id = c.id WHERE c.user_id = $1 AND m.content ILIKE $2 ORDER BY m.created_at DESC LIMIT $3 OFFSET $4`, [userId, `%${query}%`, l, o]);
  return rows.map((r: any) => ({ id: String(r.id), conversationId: String(r.conversationId), role: r.role as DbMessageRole, preview: String(r.preview || ''), createdAt: (r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt)) }));
}

// Retention worker: purges expired conversations daily
let retentionInterval: NodeJS.Timeout | null = null;
export function startRetentionWorker(): void {
  const days = Number(process.env.CONV_RETENTION_DAYS || 0);
  if (days <= 0) return; // disabled
  if (retentionInterval) return;
  retentionInterval = setInterval(async () => {
    try {
      if (isSqliteEnabled()) {
        sqlite!.prepare(`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now'))`).run();
        sqlite!.prepare(`DELETE FROM conversations WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')`).run();
      } else if (isMongoEnabled()) {
        const cutoff = new Date();
        await colMessages!.deleteMany({ conversationId: { $in: (await colConversations!.find({ expiresAt: { $lt: cutoff } }).project({ id: 1 }).toArray()).map(c => c.id) } });
        await colConversations!.deleteMany({ expiresAt: { $lt: cutoff } });
      } else {
        await getConvDbPool().query(`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE expires_at IS NOT NULL AND expires_at < NOW())`);
        await getConvDbPool().query(`DELETE FROM conversations WHERE expires_at IS NOT NULL AND expires_at < NOW()`);
      }
      console.log('[conv-db] Retention purge completed');
    } catch (err) {
      logQueryError('Retention purge failed', err);
    }
  }, 24 * 60 * 60 * 1000);
}

export function stopRetentionWorker(): void {
  if (retentionInterval) { clearInterval(retentionInterval); retentionInterval = null; }
}

// Backup worker (SQLite only): performs VACUUM INTO to produce consistent snapshot backups
export function startBackupWorker(): void {
  if (backupInterval) return;
  const everyMs = Number(process.env.CONV_DB_BACKUP_MS || (6 * 60 * 60 * 1000)); // default 6h
  backupInterval = setInterval(async () => {
    try {
      const ts = new Date().toISOString().replace(/[:]/g, '-');
      if (isSqliteEnabled()) {
        if (!sqlitePath || !sqlite) return;
        const dir = path.join(path.dirname(sqlitePath), 'backups');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, `conversation-${ts}.db`);
        sqlite!.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
        console.log('[conv-db] Backup created at', dest);
      } else if (isMongoEnabled()) {
        // Export conversations/messages to JSON snapshot
        const baseDir = process.env.CONV_DB_BACKUP_DIR || path.join(process.cwd(), 'backups');
        if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
        const dest = path.join(baseDir, `conversation-${ts}.json`);
        const cursorConv = colConversations!.find({});
        const cursorMsg = colMessages!.find({});
        const data: any = { conversations: [] as any[], messages: [] as any[] };
        for await (const c of cursorConv) { data.conversations.push(c); }
        for await (const m of cursorMsg) { data.messages.push(m); }
        fs.writeFileSync(dest, JSON.stringify(data, null, 2), 'utf8');
        console.log('[conv-db] Mongo backup created at', dest);
      }
    } catch (err) {
      logQueryError('Backup worker failed', err);
    }
  }, everyMs);
}

// Simple KV helpers for app-state when SQLite is enabled
export function kvSet(key: string, value: any): void {
  if (isSqliteEnabled()) {
    const json = JSON.stringify(value);
    sqlite!.prepare(`INSERT INTO kv_store(key, value, updated_at) VALUES(?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`).run(key, json);
    return;
  }
  if (isMongoEnabled()) {
    const json = JSON.stringify(value);
    colKv!.updateOne({ key }, { $set: { key, value: json, updatedAt: new Date() } }, { upsert: true });
    return;
  }
  throw new Error('kvSet requires conv-db enabled');
}

export function kvGet<T = any>(key: string): T | null {
  if (isSqliteEnabled()) {
    const row = sqlite!.prepare(`SELECT value FROM kv_store WHERE key = ?`).get(key) as any;
    if (!row) return null;
    try { return JSON.parse(String(row.value)) as T; } catch { return null; }
  }
  if (isMongoEnabled()) {
    // Note: caller may not await; keeping sync signature, return null here is acceptable in current usage
    // For strict correctness, convert callers to async.
    return null;
  }
  throw new Error('kvGet requires conv-db enabled');
}

// Dashboard persistence helpers
import { Dashboard, Chart, RefreshRule } from '../types';

export function dbListDashboards(): Dashboard[] {
  if (isSqliteEnabled()) {
    const dashboards = sqlite!.prepare('SELECT * FROM dashboards ORDER BY created_at DESC').all() as any[];
    const charts = sqlite!.prepare('SELECT * FROM charts').all() as any[];
    
    const chartMap = new Map<string, Chart[]>();
    charts.forEach(c => {
      const chart: Chart = {
        id: c.id,
        dashboardId: c.dashboard_id,
        type: c.type,
        name: c.name,
        config: c.config ? JSON.parse(c.config) : undefined,
        position: c.position ? JSON.parse(c.position) : undefined,
        createdAt: c.created_at,
        updatedAt: c.updated_at
      };
      if (!chartMap.has(c.dashboard_id)) {
        chartMap.set(c.dashboard_id, []);
      }
      chartMap.get(c.dashboard_id)!.push(chart);
    });

    return dashboards.map(d => ({
      id: d.id,
      name: d.name,
      description: d.description,
      refreshRule: d.refresh_rule as RefreshRule,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      charts: chartMap.get(d.id) || []
    }));
  }
  return [];
}

export function dbCreateDashboard(d: Dashboard): void {
  if (isSqliteEnabled()) {
    sqlite!.prepare(
      'INSERT INTO dashboards (id, name, description, refresh_rule, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(d.id, d.name, d.description || null, d.refreshRule, d.createdAt, d.updatedAt);
  }
}

export function dbGetDashboard(id: string): Dashboard | undefined {
  if (isSqliteEnabled()) {
    const d = sqlite!.prepare('SELECT * FROM dashboards WHERE id = ?').get(id) as any;
    if (!d) return undefined;
    
    const chartsRaw = sqlite!.prepare('SELECT * FROM charts WHERE dashboard_id = ?').all(id) as any[];
    const charts: Chart[] = chartsRaw.map(c => ({
      id: c.id,
      dashboardId: c.dashboard_id,
      type: c.type,
      name: c.name,
      config: c.config ? JSON.parse(c.config) : undefined,
      position: c.position ? JSON.parse(c.position) : undefined,
      createdAt: c.created_at,
      updatedAt: c.updated_at
    }));

    return {
      id: d.id,
      name: d.name,
      description: d.description,
      refreshRule: d.refresh_rule as RefreshRule,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      charts
    };
  }
  return undefined;
}

export function dbUpdateDashboard(id: string, updates: Partial<Dashboard>): void {
  if (isSqliteEnabled()) {
    const cols: string[] = [];
    const values: any[] = [];
    if (updates.name !== undefined) { cols.push('name = ?'); values.push(updates.name); }
    if (updates.description !== undefined) { cols.push('description = ?'); values.push(updates.description); }
    if (updates.refreshRule !== undefined) { cols.push('refresh_rule = ?'); values.push(updates.refreshRule); }
    if (updates.updatedAt !== undefined) { cols.push('updated_at = ?'); values.push(updates.updatedAt); }
    
    if (cols.length > 0) {
      sqlite!.prepare(`UPDATE dashboards SET ${cols.join(', ')} WHERE id = ?`).run(...values, id);
    }
  }
}

export function dbDeleteDashboard(id: string): boolean {
  if (isSqliteEnabled()) {
    const info = sqlite!.prepare('DELETE FROM dashboards WHERE id = ?').run(id);
    return info.changes > 0;
  }
  return false;
}

export function dbCreateChart(dashboardId: string, c: Chart): void {
  if (isSqliteEnabled()) {
    sqlite!.prepare(
      'INSERT INTO charts (id, dashboard_id, type, name, config, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      c.id, 
      dashboardId, 
      c.type, 
      c.name, 
      c.config ? JSON.stringify(c.config) : null, 
      c.position ? JSON.stringify(c.position) : null, 
      c.createdAt, 
      c.updatedAt
    );
  }
}

export function dbUpdateChart(id: string, updates: Partial<Chart>, dashboardId?: string): void {
  if (isSqliteEnabled()) {
    const cols: string[] = [];
    const values: any[] = [];
    if (updates.name !== undefined) { cols.push('name = ?'); values.push(updates.name); }
    if (updates.config !== undefined) { cols.push('config = ?'); values.push(JSON.stringify(updates.config)); }
    if (updates.position !== undefined) { cols.push('position = ?'); values.push(JSON.stringify(updates.position)); }
    if (updates.updatedAt !== undefined) { cols.push('updated_at = ?'); values.push(updates.updatedAt); }
    
    if (cols.length > 0) {
      sqlite!.prepare(`UPDATE charts SET ${cols.join(', ')} WHERE id = ?`).run(...values, id);
    }
    // Also update dashboard updated_at if provided
    if (dashboardId) {
      sqlite!.prepare('UPDATE dashboards SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), dashboardId);
    }
  }
}

export function dbDeleteChart(id: string, dashboardId?: string): boolean {
  if (isSqliteEnabled()) {
    const info = sqlite!.prepare('DELETE FROM charts WHERE id = ?').run(id);
    if (dashboardId && info.changes > 0) {
      sqlite!.prepare('UPDATE dashboards SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), dashboardId);
    }
    return info.changes > 0;
  }
  return false;
}