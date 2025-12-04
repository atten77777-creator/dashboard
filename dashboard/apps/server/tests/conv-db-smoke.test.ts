/// <reference types="node" />
import assert from 'assert';
import { initConvDb, ensureUser, ensureSession, createConversation, appendMessage, getConversation, closeConvDb } from '../src/lib/conv-db';

async function run() {
  if (!process.env.CONV_DB_URL) {
    console.warn('Skipping conv-db tests: CONV_DB_URL not set');
    return;
  }
  await initConvDb();
  const userId = await ensureUser('test-user');
  const sessionId = await ensureSession(userId, 'server-1');
  const convId = await createConversation(userId, sessionId, 'Smoke Test', 1);
  await appendMessage(convId, 'user', 'Hello world');
  await appendMessage(convId, 'assistant', 'Hi back');
  const { conversation, messages } = await getConversation(convId);
  assert.ok(conversation && conversation.id === convId);
  assert.ok(messages.length >= 2);
  await closeConvDb();
  console.log('conv-db-smoke.test: OK');
}

run().catch(err => { console.error('conv-db-smoke.test failed:', err); process.exit(1); });