import type { ChartDefinition, ChartType } from './viz-recommender'
import { getTableSchema } from './db'
import { schemaStore } from './schema-store'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'

function normalizeType(t: string): ChartType | null {
  const s = String(t || '').toLowerCase().trim()
  if ((['column','bar','line','pie','scatter','histogram','number','table'] as string[]).includes(s)) return s as ChartType
  if (s === 'donut' || s === 'doughnut') return 'pie'
  if (s === 'area') return 'line'
  return null
}

function extractTag(segment: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>[\\s\\S]*?<\/${tag}>`, 'i')
  const m = segment.match(re)
  if (!m) return undefined
  const v = m[0].replace(new RegExp(`^<${tag}>|<\/${tag}>$`, 'ig'), '').trim()
  return v || undefined
}

function parseTaggedCharts(text: string, columnsByTable: Record<string, Set<string>>, allowedTables: string[]): ChartDefinition[] {
  const out: ChartDefinition[] = []
  const s = String(text || '')
  const chartStarts = [...s.matchAll(/<chart>[\s\S]*?<\/chart>/ig)].map(m => m.index || 0)
  if (!chartStarts.length) return out
  const segments: string[] = []
  for (let i = 0; i < chartStarts.length; i++) {
    const start = chartStarts[i]
    const end = i + 1 < chartStarts.length ? chartStarts[i + 1] : s.length
    segments.push(s.slice(start, end))
  }
  const upperTables = new Set(allowedTables.map(t => t.toUpperCase()))
  for (const seg of segments) {
    const tRaw = extractTag(seg, 'chart')
    const x = extractTag(seg, 'xaxis')
    const y = extractTag(seg, 'yaxis')
    const y2 = extractTag(seg, 'y2axis')
    let tbl = extractTag(seg, 'table')
    const type = normalizeType(String(tRaw || ''))
    if (!type || !x) continue
    let useTable: string | undefined = tbl && tbl.trim() ? tbl.trim().toUpperCase() : undefined
    if (useTable && !upperTables.has(useTable)) useTable = undefined
    if (!useTable) {
      // Try to infer table by matching columns
      for (const t of allowedTables) {
        const names = columnsByTable[t.toUpperCase()]
        if (!names) continue
        const xOk = names.has(String(x).toUpperCase())
        const yOk = y ? names.has(String(y).toUpperCase()) : true
        const y2Ok = y2 ? names.has(String(y2).toUpperCase()) : true
        if (xOk && yOk && y2Ok) { useTable = t.toUpperCase(); break }
      }
    }
    if (!useTable) continue
    const names = columnsByTable[useTable] || new Set<string>()
    const xOk = names.has(String(x).toUpperCase())
    const yOk = y ? names.has(String(y).toUpperCase()) : true
    const y2Ok = y2 ? names.has(String(y2).toUpperCase()) : true
    if (!xOk || !yOk || !y2Ok) continue

    const chartName = (() => {
      if (type === 'line' && y) return `${useTable}: ${y} over ${x}`
      if ((type === 'column' || type === 'bar') && y) return `${useTable}: ${x} vs ${y}`
      if (type === 'scatter' && y) return `${useTable}: ${x} vs ${y}`
      if (type === 'pie' && y) return `${useTable}: Composition of ${y} by ${x}`
      if (type === 'histogram') return `${useTable}: Distribution of ${x}`
      return `${useTable}: ${type} ${x}${y ? ' & ' + y : ''}`
    })()

    out.push({
      chartType: type,
      chartName,
      justification: 'LLM recommended',
      table: useTable,
      xField: x,
      yField: y,
      y2Field: y2,
      aggregation: y || y2 ? { y: y ? 'SUM' : undefined, y2: y2 ? 'SUM' : undefined } : undefined,
      groupBy: [x],
      sort: type === 'line' ? { by: 'key', direction: 'asc' } : { by: 'value', direction: 'desc' },
      limit: 1000,
    })
  }
  return out
}

export async function llmRecommendChartsForTables(tables: string[], goal?: string, llmType?: string): Promise<ChartDefinition[]> {
  const upper = tables.map(t => t.toUpperCase())
  try { await schemaStore.refreshSchema(upper) } catch {}
  schemaStore.setSelectedTables(upper)
  const schemaContext = schemaStore.buildSchemaContext(upper)

  const columnsByTable: Record<string, Set<string>> = {}
  for (const t of upper) {
    try {
      const cols = await getTableSchema(t)
      const names = new Set<string>()
      for (const c of cols as any[]) names.add(String((c as any).column_name || (c as any).COLUMN_NAME).toUpperCase())
      columnsByTable[t] = names
    } catch {
      columnsByTable[t] = new Set<string>()
    }
  }

  const type = llmType || schemaStore.getCurrentLLMType()
  if (!type) return []
  const cfg = schemaStore.getLLMConfig(type)
  if (!cfg || !cfg.connected) return []

  const guidance = [
    'You are a BI visualization assistant. Use ONLY provided schema tables and columns.',
    'Propose multiple charts for maximum analytical coverage.',
    'STRICTLY output chart metadata using tags per chart:',
    '<chart>type</chart> (line, bar, column, pie, scatter, histogram, number)',
    '<table>TABLE_NAME</table>',
    '<xaxis>COLUMN_NAME</xaxis>',
    '<yaxis>COLUMN_NAME</yaxis> (optional; include when applicable)',
    'Optional: <y2axis>, <zaxis>, <coloraxis>. Use only existing columns. No SQL. No prose.'
  ].join(' ')

  const user = `Schema:\n${schemaContext}\n\nAnalytics goal: ${goal || 'General analysis'}\nReturn up to 10 charts using ONLY the tag format, no explanations.`

  let content = ''
  if (type === 'openai') {
    const client = new OpenAI({ apiKey: cfg.apiKey })
    const completion = await client.chat.completions.create({ model: cfg.model || 'gpt-4o-mini', temperature: 0, messages: [ { role: 'system', content: guidance }, { role: 'user', content: user } ] })
    content = completion.choices?.[0]?.message?.content?.trim() || ''
  } else if (type === 'gemini') {
    if (!cfg.apiKey) return []
    const apiKey = cfg.apiKey!
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: cfg.model || 'gemini-2.5-flash' })
    const result = await model.generateContent([{ text: guidance }, { text: user }])
    content = String(result?.response?.text?.() || '').trim()
  } else if (type === 'azure') {
    if (!cfg.endpoint || !cfg.deployment || !cfg.apiKey) return []
    const url = `${cfg.endpoint}/openai/deployments/${cfg.deployment}/chat/completions?api-version=${cfg.apiVersion || '2024-05-01-preview'}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'api-key': cfg.apiKey }
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ messages: [ { role: 'system', content: guidance }, { role: 'user', content: user } ], temperature: 0 }) })
    if (!resp.ok) throw new Error(await resp.text())
    const data = await resp.json()
    content = data?.choices?.[0]?.message?.content?.trim() || ''
  } else if (type === 'openai_compatible') {
    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl })
    const completion = await client.chat.completions.create({ model: cfg.model || 'gpt-4o-mini', temperature: 0, messages: [ { role: 'system', content: guidance }, { role: 'user', content: user } ] })
    content = completion.choices?.[0]?.message?.content?.trim() || ''
  } else if (type === 'anthropic') {
    const url = 'https://api.anthropic.com/v1/messages'
    if (!cfg.apiKey) return []
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': cfg.version || '2023-06-01' }
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ model: cfg.model || 'claude-3-haiku', max_tokens: 1024, system: guidance, messages: [ { role: 'user', content: user } ] }) })
    if (!resp.ok) throw new Error(await resp.text())
    const data = await resp.json()
    content = (Array.isArray(data?.content) && data.content[0]?.text ? String(data.content[0].text).trim() : '').trim()
  } else if (type === 'ollama') {
    const url = `${cfg.ollamaHost}/api/generate`
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: cfg.model, prompt: `${guidance}\n\n${user}`, stream: false }) })
    if (!resp.ok) throw new Error(await resp.text())
    const data = await resp.json()
    content = (data?.response || '').trim()
  }

  const defs = parseTaggedCharts(content, columnsByTable, upper)
  return defs
}