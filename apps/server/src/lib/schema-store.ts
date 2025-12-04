import { listTables } from './db';

export type TableInfo = {
  TABLE_NAME: string;
  NUM_ROWS?: number;
  LAST_ANALYZED?: Date;
  COMMENTS?: string;
};

type LLMConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  endpoint?: string;
  deployment?: string;
  apiVersion?: string;
  version?: string;
  ollamaHost?: string;
  connected?: boolean;
};

class SchemaStore {
  private tables: TableInfo[] = [];
  private lastRefreshedAt: number | null = null;
  private selectedTables: string[] = [];

  // Inferred LLM configuration from environment
  private llms: Record<string, LLMConfig> = {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    },
    azure: {
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION,
    },
    openai_compatible: {
      apiKey: process.env.OPENAI_COMPAT_API_KEY,
      model: process.env.OPENAI_COMPAT_MODEL,
      baseUrl: process.env.OPENAI_COMPAT_BASE_URL,
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL,
      version: process.env.ANTHROPIC_VERSION,
    },
    ollama: {
      ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL,
    },
  };

  async refreshSchema(tables?: string[]) {
    try {
      this.tables = await listTables();
      this.lastRefreshedAt = Date.now();
      if (Array.isArray(tables) && tables.length) {
        this.selectedTables = tables.map(t => t.toUpperCase());
      }
    } catch (err) {
      // If listing fails, keep existing cache
      this.lastRefreshedAt = this.lastRefreshedAt || null;
      throw err;
    }
  }

  setSelectedTables(tables: string[]) {
    this.selectedTables = (tables || []).map(t => t.toUpperCase());
  }

  buildSchemaContext(tables: string[]): string {
    const wanted = new Set((tables || []).map(t => t.toUpperCase()));
    const lines = this.getAllTables()
      .filter(t => wanted.size === 0 || wanted.has(String(t.name).toUpperCase()))
      .map(t => `TABLE ${t.name} (${t.rows ?? 'unknown'} rows)${t.comments ? ` -- ${t.comments}` : ''}`);
    return lines.join('\n');
  }

  getCurrentLLMType(): string | null {
    // Prefer explicit env var; fall back to first configured provider with credentials
    const fromEnv = process.env.LLM_TYPE?.trim();
    if (fromEnv) return fromEnv;
    for (const [key, cfg] of Object.entries(this.llms)) {
      const c = this.withConnectedFlag(cfg);
      if (c.connected) return key;
    }
    return null;
  }

  getLLMConfig(type: string): LLMConfig | null {
    const cfg = this.llms[type];
    if (!cfg) return null;
    return this.withConnectedFlag(cfg);
  }

  private withConnectedFlag(cfg: LLMConfig): LLMConfig {
    const connected = !!(
      cfg.apiKey || cfg.baseUrl || cfg.endpoint || cfg.ollamaHost
    );
    return { ...cfg, connected };
  }

  getAllTables() {
    return this.tables.map(t => ({
      name: t.TABLE_NAME,
      rows: t.NUM_ROWS ?? null,
      lastAnalyzed: t.LAST_ANALYZED ?? null,
      comments: t.COMMENTS ?? null
    }));
  }

  getSchemaVersion(): number {
    return this.lastRefreshedAt ?? 0;
  }
}

export const schemaStore = new SchemaStore();