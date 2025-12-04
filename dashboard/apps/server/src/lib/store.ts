import { v4 as uuid } from 'uuid';
import type { Dashboard, Chart, RefreshRule, AgentGeneration, QueryHistoryEntry, SavedQuery, UserPreferences, SharedQuery } from '../types';
import { 
  dbListDashboards, dbCreateDashboard, dbGetDashboard, dbUpdateDashboard, dbDeleteDashboard,
  dbCreateChart, dbUpdateChart, dbDeleteChart, isConvDbEnabled 
} from './conv-db';

const dashboards: Dashboard[] = [];
const generations: Record<string, AgentGeneration> = {};
const queryHistory: QueryHistoryEntry[] = [];
const savedQueries: SavedQuery[] = [];
let userPreferences: UserPreferences = { defaultLimit: 100, pageSize: 50, theme: 'system' };
const sharedQueries: Record<string, SharedQuery> = {};

function now() {
  return new Date().toISOString();
}

export const Store = {
  listDashboards(): Dashboard[] {
    if (isConvDbEnabled()) {
      return dbListDashboards();
    }
    return dashboards;
  },
  createDashboard(name: string, description: string | undefined, refreshRule: RefreshRule): Dashboard {
    const d: Dashboard = {
      id: uuid(),
      name,
      description,
      refreshRule,
      charts: [],
      createdAt: now(),
      updatedAt: now(),
    };
    if (isConvDbEnabled()) {
      dbCreateDashboard(d);
    } else {
      dashboards.push(d);
    }
    return d;
  },
  getDashboard(id: string): Dashboard | undefined {
    if (isConvDbEnabled()) {
      return dbGetDashboard(id);
    }
    return dashboards.find(d => d.id === id);
  },
  updateDashboard(id: string, updates: Partial<Pick<Dashboard, 'name' | 'description' | 'refreshRule'>>): Dashboard | undefined {
    if (isConvDbEnabled()) {
      const d = dbGetDashboard(id);
      if (!d) return undefined;
      const up: Partial<Dashboard> = { ...updates, updatedAt: now() };
      dbUpdateDashboard(id, up);
      return { ...d, ...updates, updatedAt: up.updatedAt! };
    }
    const d = dashboards.find(x => x.id === id);
    if (!d) return undefined;
    if (updates.name !== undefined) d.name = updates.name;
    if (updates.description !== undefined) d.description = updates.description;
    if (updates.refreshRule !== undefined) d.refreshRule = updates.refreshRule;
    d.updatedAt = now();
    return d;
  },
  deleteDashboard(id: string): boolean {
    if (isConvDbEnabled()) {
      return dbDeleteDashboard(id);
    }
    const idx = dashboards.findIndex(d => d.id === id);
    if (idx === -1) return false;
    dashboards.splice(idx, 1);
    return true;
  },
  createChart(dashboardId: string, chart: Omit<Chart, 'id' | 'createdAt' | 'updatedAt'>): Chart | undefined {
    const c: Chart = { ...chart, id: uuid(), createdAt: now(), updatedAt: now() } as Chart;
    if (isConvDbEnabled()) {
      const d = dbGetDashboard(dashboardId);
      if (!d) return undefined;
      dbCreateChart(dashboardId, c);
      return c;
    }
    const d = dashboards.find(x => x.id === dashboardId);
    if (!d) return undefined;
    d.charts.push(c);
    d.updatedAt = now();
    return c;
  },
  getChart(dashboardId: string, chartId: string): Chart | undefined {
    if (isConvDbEnabled()) {
      const d = dbGetDashboard(dashboardId);
      return d?.charts.find(c => c.id === chartId);
    }
    const d = dashboards.find(x => x.id === dashboardId);
    return d?.charts.find(c => c.id === chartId);
  },
  updateChart(dashboardId: string, chartId: string, updates: Partial<Pick<Chart, 'name' | 'config' | 'position'>>): Chart | undefined {
    if (isConvDbEnabled()) {
      const d = dbGetDashboard(dashboardId);
      if (!d) return undefined;
      const c = d.charts.find(x => x.id === chartId);
      if (!c) return undefined;
      const up: Partial<Chart> = { ...updates, updatedAt: now() };
      dbUpdateChart(chartId, up, dashboardId);
      return { ...c, ...updates, updatedAt: up.updatedAt! };
    }
    const d = dashboards.find(x => x.id === dashboardId);
    if (!d) return undefined;
    const c = d.charts.find(x => x.id === chartId);
    if (!c) return undefined;
    if (updates.name !== undefined) c.name = updates.name;
    if (updates.config !== undefined) c.config = updates.config;
    if (updates.position !== undefined) c.position = updates.position;
    c.updatedAt = now();
    d.updatedAt = now();
    return c;
  },
  deleteChart(dashboardId: string, chartId: string): boolean {
    if (isConvDbEnabled()) {
      return dbDeleteChart(chartId, dashboardId);
    }
    const d = dashboards.find(x => x.id === dashboardId);
    if (!d) return false;
    const idx = d.charts.findIndex(c => c.id === chartId);
    if (idx === -1) return false;
    d.charts.splice(idx, 1);
    d.updatedAt = now();
    return true;
  },
  // Agent generations
  createGeneration(initial: Partial<AgentGeneration>): AgentGeneration {
    const id = uuid();
    const g: AgentGeneration = {
      id,
      status: initial.status ?? 'pending',
      progress: initial.progress ?? 0,
      results: initial.results,
      error: initial.error,
    };
    generations[id] = g;
    return g;
  },
  getGeneration(id: string): AgentGeneration | undefined {
    return generations[id];
  },
  updateGeneration(id: string, updates: Partial<AgentGeneration>): AgentGeneration | undefined {
    const g = generations[id];
    if (!g) return undefined;
    Object.assign(g, updates);
    return g;
  },
  // Query history
  addQueryHistory(payload: { sql: string; elapsedMs?: number; rowsCount?: number; error?: string }): QueryHistoryEntry {
    const h: QueryHistoryEntry = { id: uuid(), sql: payload.sql, createdAt: now(), elapsedMs: payload.elapsedMs, rowsCount: payload.rowsCount, error: payload.error };
    queryHistory.push(h);
    // Keep last 200
    if (queryHistory.length > 200) queryHistory.shift();
    return h;
  },
  listQueryHistory(limit = 50): QueryHistoryEntry[] {
    const items = queryHistory.slice().reverse();
    return items.slice(0, limit);
  },
  // Saved queries
  saveQuery(name: string, sql: string, description?: string): SavedQuery {
    const q: SavedQuery = { id: uuid(), name, sql, description, createdAt: now(), updatedAt: now() };
    savedQueries.push(q);
    return q;
  },
  listSavedQueries(): SavedQuery[] {
    return savedQueries.slice().sort((a,b) => (b.updatedAt || b.createdAt).localeCompare((a.updatedAt || a.createdAt)));
  },
  // Preferences
  getPreferences(): UserPreferences {
    return { ...userPreferences };
  },
  updatePreferences(p: Partial<UserPreferences>): UserPreferences {
    userPreferences = { ...userPreferences, ...p };
    return { ...userPreferences };
  },
  // Sharing
  shareQuery(input: { savedId?: string; name?: string; sql?: string }): SharedQuery | undefined {
    let name = input.name;
    let sql = input.sql;
    if (input.savedId) {
      const found = savedQueries.find(sq => sq.id === input.savedId);
      if (!found) return undefined;
      name = name ?? found.name;
      sql = sql ?? found.sql;
    }
    if (!sql) return undefined;
    const id = uuid();
    const s: SharedQuery = { id, name, sql, createdAt: now() };
    sharedQueries[id] = s;
    return s;
  },
  getSharedQuery(id: string): SharedQuery | undefined {
    return sharedQueries[id];
  }
};

// Seed sample data
export function initStore() {
  Store.createDashboard('Sample Dashboard', 'Initial demo dashboard', 'manual');
}