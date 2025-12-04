/// <reference types="node" />
import assert from 'assert';
import { initConvDb, ensureUser, ensureSession, createConversation, appendMessage, getConversation, closeConvDb } from '../src/lib/conv-db';

async function run() {
  if (!process.env.CONV_DB_URL) {
    console.warn('Skipping conv-db concurrency test: CONV_DB_URL not set');
    return;
  }
  await initConvDb();
  const userId = await ensureUser('test-user-concurrency');
  const sessionId = await ensureSession(userId, 'server-1');
  const convId = await createConversation(userId, sessionId, 'Concurrency Test', 1);
  const promises = [] as Array<Promise<any>>;
  for (let i = 0; i < 50; i++) {
    promises.push(appendMessage(convId, 'user', `msg-${i}`, null, `client-${i}`));
  }
  await Promise.all(promises);
  const { messages } = await getConversation(convId);
  assert.ok(messages.length >= 50);
  await closeConvDb();
  console.log('conv-db-concurrency.test: OK');
}

run().catch(err => { console.error('conv-db-concurrency.test failed:', err); process.exit(1); });