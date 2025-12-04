export async function initConversationStorage(schemaVersion: string): Promise<void> {
  // Stateless mode: conversation storage disabled.
  console.log('Conversation storage disabled (stateless). Schema version:', schemaVersion);
}