export type RefreshRule = '1min' | '5min' | '15min' | '30min' | '1hour' | 'manual';

export interface ChartPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChartConfig {
  fields?: Record<string, string>;
  aggregation?: Record<string, string>;
  filters?: Record<string, unknown>;
  groupBy?: string[];
  sqlQuery?: string;
  // Optional static dataset to render instead of fetching live data
  dataOverride?: {
    columns: Array<{ name: string; type?: string }> | string[];
    rows: Array<Record<string, unknown>>;
  };
}

export interface Chart {
  id: string;
  dashboardId: string;
  type: string;
  name: string;
  config: ChartConfig;
  position?: ChartPosition;
  createdAt: string;
  updatedAt: string;
}

export interface Dashboard {
  id: string;
  name: string;
  description?: string;
  refreshRule: RefreshRule;
  charts: Chart[];
  createdAt: string;
  updatedAt: string;
}

export interface QueryColumnMeta {
  name: string;
  type: string;
  nullable?: boolean;
}

export interface QueryResult {
  columns: QueryColumnMeta[];
  data: Array<Record<string, unknown>>;
}

export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AgentGeneration {
  id: string;
  status: GenerationStatus;
  progress: number; // 0-100
  results?: unknown;
  error?: string;
}

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  createdAt: string;
  elapsedMs?: number;
  rowsCount?: number;
  error?: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SharedQuery {
  id: string;
  sql: string;
  name?: string;
  createdAt: string;
}

export interface UserPreferences {
  defaultLimit?: number;
  pageSize?: number;
  theme?: 'light' | 'dark' | 'system';
}