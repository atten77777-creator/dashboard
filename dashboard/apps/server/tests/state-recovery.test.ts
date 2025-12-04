/// <reference types="node" />
import assert from 'assert';
import { initConvDb, ensureUser, ensureSession, createConversation, appendMessage, getMessagesForConversation, getConversationsForUser, getConversation, closeConvDb } from '../src/lib/conv-db';

async function run() {
  if (!process.env.CONV_DB_URL) {
    console.warn('Skipping state-recovery tests: CONV_DB_URL not set');
    return;
  }
  await initConvDb();

  // Create two users and a session
  const user1 = await ensureUser('state-recovery-user-1');
  const user2 = await ensureUser('state-recovery-user-2');
  const session1 = await ensureSession(user1, 'server-1');

  // Create conversation for user1 and append messages
  const convId = await createConversation(user1, session1, 'Recovery Test', 1);
  await appendMessage(convId, 'user', 'Ping');
  await appendMessage(convId, 'assistant', 'Pong');
  await appendMessage(convId, 'user', 'Another');

  // Verify listing shows conversation for user1
  const list1 = await getConversationsForUser(user1);
  assert.ok(Array.isArray(list1) && list1.some(c => c.id === convId), 'User1 should see the conversation');

  // Verify user2 does not see user1's conversation
  const list2 = await getConversationsForUser(user2);
  assert.ok(Array.isArray(list2) && !list2.some(c => c.id === convId), 'User2 should not see User1 conversation');

  // Verify message retrieval returns expected count
  const msgs = await getMessagesForConversation(convId, 100, 0);
  assert.ok(msgs.length >= 3, 'Should retrieve at least 3 messages');

  // Verify ownership via getConversation
  const conv = await getConversation(convId);
  assert.ok(conv.conversation && conv.conversation.userId === user1, 'Conversation owner should be user1');

  await closeConvDb();
  console.log('state-recovery.test: OK');
}

run().catch(err => { console.error('state-recovery.test failed:', err); process.exit(1); });