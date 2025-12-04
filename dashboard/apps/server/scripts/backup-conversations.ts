import 'dotenv/config';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

async function main() {
  const mongoUrl = process.env.CONV_DB_MONGO_URL || '';
  const mongoDbName = process.env.CONV_DB_MONGO_DB || undefined;
  if (!mongoUrl) {
    console.error('Missing Mongo URL. Set CONV_DB_MONGO_URL');
    process.exit(1);
  }
  const client = new MongoClient(mongoUrl);
  await client.connect();
  const db = client.db(mongoDbName);
  const conversations = db.collection('conversations');
  const messages = db.collection('messages');
  const dir = process.env.CONV_DB_BACKUP_DIR || path.join(process.cwd(), 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:]/g, '-');
  const dest = path.join(dir, `conversation-${ts}.json`);
  try {
    const data: any = { conversations: [], messages: [] };
    for await (const c of conversations.find({})) data.conversations.push(c);
    for await (const m of messages.find({})) data.messages.push(m);
    fs.writeFileSync(dest, JSON.stringify(data, null, 2), 'utf8');
    console.log('Backup written:', dest);
  } finally {
    await client.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });