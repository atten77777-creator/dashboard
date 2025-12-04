import { getTableSchema, listTables } from './db';

export interface ColumnMetadata {
  column_name: string;
  data_type: string;
  nullable: string;
  is_primary_key: number;
  is_foreign_key: number;
  referenced_owner?: string;
  referenced_table?: string;
  referenced_column?: string;
}

export interface TableMetadata {
  name: string;
  columns: ColumnMetadata[];
  relationships: {
    foreignKeys: Array<{
      column: string;
      referencedTable: string;
      referencedColumn: string;
    }>;
    referencedBy: Array<{
      table: string;
      column: string;
      referencedColumn: string;
    }>;
  };
}

class SchemaStore {
  private tables: Map<string, TableMetadata> = new Map();
  private selectedTables: Set<string> = new Set();
  private tableHashes: Map<string, string> = new Map();
  private schemaVersion: number = 0;
  // Cache of built schema contexts keyed by schemaVersion + sorted table set
  private contextCache: Map<string, string> = new Map();
  // Allow richer per-LLM configuration objects (e.g., Azure endpoint/deployment)
  // Track connectivity state and last check time per provider
  private llmConfigs: Map<string, { lastUsed: Date; connected: boolean; lastChecked?: Date } & Record<string, any>> = new Map();
  
  async refreshSchema(tableNames?: string[]) {
    try {
      // If no tables specified, get all tables
      if (!tableNames) {
        const tables = await listTables();
        tableNames = tables.map(t => t.TABLE_NAME);
      }
      
      // Load schema for each table
      let changed = false;
      for (const tableName of tableNames) {
        const rawColumns = await getTableSchema(tableName);
        // Normalize Oracle OUT_FORMAT_OBJECT keys (typically uppercase) to our lowercase interface
        const columns: ColumnMetadata[] = rawColumns.map((r: any) => ({
          column_name: r.column_name ?? r.COLUMN_NAME ?? '',
          data_type: r.data_type ?? r.DATA_TYPE ?? '',
          nullable: r.nullable ?? r.NULLABLE ?? '',
          is_primary_key: Number(r.is_primary_key ?? r.IS_PRIMARY_KEY ?? 0),
          is_foreign_key: Number(r.is_foreign_key ?? r.IS_FOREIGN_KEY ?? 0),
          referenced_owner: r.referenced_owner ?? r.REFERENCED_OWNER ?? undefined,
          referenced_table: r.referenced_table ?? r.REFERENCED_TABLE ?? undefined,
          referenced_column: r.referenced_column ?? r.REFERENCED_COLUMN ?? undefined
        }));
        
        type ForeignKeyRel = { column: string; referencedTable: string; referencedColumn: string };
        type ReferencedByRel = { table: string; column: string; referencedColumn: string };

        const foreignKeys: ForeignKeyRel[] = columns
          .filter(c => c.is_foreign_key === 1)
          .map(c => ({
            column: c.column_name,
            referencedTable: c.referenced_table!,
            referencedColumn: c.referenced_column!
          }));

        const relationships: { foreignKeys: ForeignKeyRel[]; referencedBy: ReferencedByRel[] } = {
          foreignKeys,
          referencedBy: []
        };
        
        const metadata: TableMetadata = {
          name: tableName,
          columns,
          relationships
        };
        const prev = this.tables.get(tableName);
        const hash = JSON.stringify(metadata.columns);
        const prevHash = this.tableHashes.get(tableName);
        if (!prev || prevHash !== hash) {
          changed = true;
        }
        this.tables.set(tableName, metadata);
        this.tableHashes.set(tableName, hash);
      }
      
      // Update reverse relationships
      for (const [tableName, metadata] of this.tables) {
        for (const fk of metadata.relationships.foreignKeys) {
          const referencedTable = this.tables.get(fk.referencedTable);
          if (referencedTable) {
            referencedTable.relationships.referencedBy.push({
              table: tableName,
              column: fk.column,
              referencedColumn: fk.referencedColumn
            });
          }
        }
      }
      
      if (changed) {
        this.schemaVersion++;
        // Invalidate cached contexts if schema changed
        this.contextCache.clear();
      }
      return true;
    } catch (err) {
      console.error('Error refreshing schema:', err);
      return false;
    }
  }
  
  getTableMetadata(tableName: string): TableMetadata | undefined {
    return this.tables.get(tableName);
  }
  
  getAllTables(): TableMetadata[] {
    return Array.from(this.tables.values());
  }

  // Selected tables management
  setSelectedTables(tables: string[]) {
    this.selectedTables = new Set(tables);
  }

  getSelectedTables(): string[] {
    return Array.from(this.selectedTables);
  }

  getSchemaForTables(tables?: string[]): TableMetadata[] {
    const names = tables && tables.length ? tables : this.getSelectedTables();
    if (!names.length) return [];
    return names.map(n => this.tables.get(n)).filter(Boolean) as TableMetadata[];
  }

  getSchemaVersion(): number {
    return this.schemaVersion;
  }

  // Build a compact, LLM-friendly schema context while preserving relationships
  buildSchemaContext(tables?: string[]): string {
    const names = (tables && tables.length ? tables : this.getSelectedTables()).map(n => String(n).toUpperCase());
    if (!names.length) return '';
    const key = `${this.schemaVersion}|${names.slice().sort().join(',')}`;
    const cached = this.contextCache.get(key);
    if (cached) return cached;

    const metas = this.getSchemaForTables(names);
    const text = metas.map(s => {
      const cols = s.columns.map(c => {
        const flags = [] as string[];
        if (c.is_primary_key) flags.push('PK');
        if (c.is_foreign_key && c.referenced_table && c.referenced_column) {
          flags.push(`FK->${c.referenced_table}.${c.referenced_column}`);
        }
        return `${c.column_name} (${c.data_type}${flags.length ? ', ' + flags.join(', ') : ''})`;
      }).join(', ');
      const refs = s.relationships.foreignKeys.map(r => `${r.column}->${r.referencedTable}.${r.referencedColumn}`).join(', ');
      const refBy = s.relationships.referencedBy.map(r => `${r.table}.${r.column} -> ${s.name}.${r.referencedColumn}`).join(', ');
      return `Table ${s.name}:
Columns: ${cols}
Relations: ${refs || 'None'}
ReferencedBy: ${refBy || 'None'}`;
    }).join('\n');

    this.contextCache.set(key, text);
    return text;
  }
  
  setLLMConfig(type: string, config: Record<string, any>) {
    this.llmConfigs.set(type, { ...config, lastUsed: new Date(), connected: false, lastChecked: undefined });
  }
  
  getLLMConfig(type: string) {
    return this.llmConfigs.get(type);
  }

  setLLMConnected(type: string, connected: boolean) {
    const cfg = this.llmConfigs.get(type);
    if (cfg) {
      cfg.connected = connected;
      cfg.lastChecked = new Date();
      cfg.lastUsed = new Date();
      this.llmConfigs.set(type, cfg);
    }
  }

  getLLMConnected(type: string): boolean {
    const cfg = this.llmConfigs.get(type);
    return !!cfg?.connected;
  }
  
  removeLLMConfig(type: string) {
    return this.llmConfigs.delete(type);
  }

  // List configured LLM provider types
  getConfiguredLLMs(): string[] {
    return Array.from(this.llmConfigs.keys());
  }

  // Get most recently used LLM provider type
  getCurrentLLMType(): string | null {
    let current: { type: string; lastUsed: Date } | null = null;
    for (const [type, cfg] of this.llmConfigs.entries()) {
      if (!current || cfg.lastUsed > current.lastUsed) {
        current = { type, lastUsed: cfg.lastUsed };
      }
    }
    return current ? current.type : null;
  }

  // Summary useful for status route
  getLLMStatusSummary() {
    const types = this.getConfiguredLLMs();
    const current = this.getCurrentLLMType();
    const connectedByType: Record<string, boolean> = {};
    for (const t of types) {
      connectedByType[t] = this.getLLMConnected(t);
    }
    const connected = current ? this.getLLMConnected(current) : false;
    return { configured: types.length > 0, types, current, connected, connectedByType };
  }
}

export const schemaStore = new SchemaStore();