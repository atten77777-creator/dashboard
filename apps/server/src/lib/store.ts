type QueryHistoryItem = {
  sql: string;
  elapsedMs: number;
  rowsCount: number;
  error?: string;
  at?: number;
};

type SavedQuery = {
  id: string;
  name: string;
  sql: string;
  description?: string;
  createdAt: number;
};

type SharedQuery = {
  id: string;
  name?: string;
  sql?: string;
  savedId?: string;
  createdAt: number;
};

type Preferences = {
  defaultLimit?: number;
  pageSize?: number;
  theme?: 'light' | 'dark' | 'system';
};

class InMemoryStore {
  private history: QueryHistoryItem[] = [];
  private saved: SavedQuery[] = [];
  private shared: Map<string, SharedQuery> = new Map();
  private prefs: Preferences = { theme: 'system', pageSize: 50, defaultLimit: 100 };

  addQueryHistory(item: Omit<QueryHistoryItem, 'at'>) {
    const entry: QueryHistoryItem = { ...item, at: Date.now() };
    this.history.unshift(entry);
    this.history = this.history.slice(0, 500);
    return entry;
  }

  listQueryHistory(limit = 50) {
    return this.history.slice(0, limit);
  }

  listSavedQueries() {
    return this.saved.slice();
  }

  saveQuery(name: string, sql: string, description?: string) {
    const id = String(Math.random()).slice(2);
    const item: SavedQuery = { id, name, sql, description, createdAt: Date.now() };
    this.saved.push(item);
    return item;
  }

  shareQuery(input: { savedId?: string; name?: string; sql?: string }) {
    const id = String(Math.random()).slice(2);
    let payload: SharedQuery | null = null;
    if (input.savedId) {
      const s = this.saved.find(x => x.id === input.savedId);
      if (!s) return null;
      payload = { id, savedId: s.id, name: s.name, sql: s.sql, createdAt: Date.now() };
    } else {
      if (!input.sql) return null;
      payload = { id, name: input.name, sql: input.sql, createdAt: Date.now() };
    }
    this.shared.set(id, payload);
    return payload;
  }

  getSharedQuery(id: string) {
    return this.shared.get(id) || null;
  }

  getPreferences() {
    return { ...this.prefs };
  }

  updatePreferences(next: Preferences) {
    this.prefs = { ...this.prefs, ...next };
    return this.getPreferences();
  }
}

export const Store = new InMemoryStore();