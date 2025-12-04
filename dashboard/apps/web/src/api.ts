export interface ChartPosition { x: number; y: number; w: number; h: number }
export type RefreshRule = '1min' | '5min' | '15min' | '30min' | '1hour' | 'manual'

export interface ChartConfig {
  fields?: Record<string, string>
  aggregation?: Record<string, string>
  filters?: Record<string, unknown>
  groupBy?: string[]
  sqlQuery?: string
}

export interface Chart {
  id: string
  dashboardId: string
  type: string
  name: string
  config: ChartConfig
  position?: ChartPosition
  createdAt: string
  updatedAt: string
}

export interface Dashboard {
  id: string
  name: string
  description?: string
  refreshRule: RefreshRule
  charts: Chart[]
  createdAt: string
  updatedAt: string
}

// Prefer the local dev server first. If env points to 6090, skip it in dev.
const ENV_BASE = (import.meta.env.VITE_API_BASE || '').trim()
const RAW_CANDIDATES = [
  'http://localhost:3001',
  ...(ENV_BASE && !ENV_BASE.includes('6090') ? [ENV_BASE] : []),
  'http://localhost:3002',
  'http://localhost:3080',
].filter(Boolean)

function toApiBase(raw: string): string {
  const noTrail = raw.replace(/\/+$/, '')
  return noTrail.endsWith('/api') ? noTrail : `${noTrail}/api`
}

let API_BASE = toApiBase(RAW_CANDIDATES[0])

// Proactively resolve the first reachable API base (prefers env, falls back to known localhost ports).
// This helps components that use API_BASE directly without the request() fallback rotation.
export async function ensureApiBase(): Promise<string> {
  const candidates = RAW_CANDIDATES.map(toApiBase)
  for (const base of candidates) {
    try {
      const res = await fetch(`${base}/chat/status`, { method: 'GET' })
      if (res.ok) {
        API_BASE = base
        if (typeof window !== 'undefined') (window as any).API_BASE = base
        return base
      }
    } catch {
      // try next candidate
      continue
    }
  }
  // Keep current API_BASE as last resort and expose to window for consumers expecting it
  if (typeof window !== 'undefined') (window as any).API_BASE = API_BASE
  return API_BASE
}

export { API_BASE }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let lastErr: unknown = undefined
  // Prefer the resolved API base to avoid aborted attempts on the wrong port
  const primaryBase = await ensureApiBase()
  const tried = new Set<string>()
  const candidates = [primaryBase, ...RAW_CANDIDATES.map(toApiBase)].filter((b) => {
    const ok = !tried.has(b); tried.add(b); return ok
  })
  for (const base of candidates) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      API_BASE = base
      return res.json() as Promise<T>
    } catch (err) {
      lastErr = err
      continue
    }
  }
  throw (lastErr instanceof Error ? lastErr : new Error('Network error'))
}

export const api = {
  getDashboards: () => request<Dashboard[]>('/dashboards'),
  createDashboard: (payload: { name: string; description?: string; refreshRule?: RefreshRule }) =>
    request<Dashboard>('/dashboards', { method: 'POST', body: JSON.stringify(payload) }),
  getDashboard: (id: string) => request<Dashboard>(`/dashboards/${id}`),
  updateDashboard: (id: string, payload: { name?: string; description?: string; refreshRule?: RefreshRule }) =>
    request<Dashboard>(`/dashboards/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteDashboard: async (id: string): Promise<void> => {
    const base = await ensureApiBase()
    const res = await fetch(`${base}/dashboards/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || `HTTP ${res.status}`)
    }
    return
  },
  // Chart generation with server fallback rotation
  chartGenerate: (payload: { prompt: string; llmType: string; tables: string[]; full?: boolean }) =>
    request<any>('/chart/generate', { method: 'POST', body: JSON.stringify(payload) }),
  // SQL preview with server fallback rotation
  queryPreview: (sql: string, opts?: { full?: boolean }) =>
    request<any>('/query/preview', { method: 'POST', body: JSON.stringify({ sql, full: opts?.full ?? true }) }),
}
