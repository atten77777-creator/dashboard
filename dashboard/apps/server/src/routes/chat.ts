import { Router } from 'express';
import { z } from 'zod';
import { schemaStore } from '../lib/schema-store';
import { executeQuery, executeQueryAll, DatabaseError, validateConnection, getQueryColumns } from '../lib/db';
// Removed conversation storage to keep chat stateless and simplify backend
import { buildColumnMismatchMessage, logQueryError, logSchemaMismatch, logValidationFailure, logAccessViolation } from '../lib/logger';
import { enforceTableSelection } from '../lib/access-control';
import { isSimpleTableSelect, stripLimitClauses, validateDatasetCompleteness, detectFormattingIssues } from '../lib/query-utils';
import { openStream, fetchNext, close as closeStream, listActiveCursors } from '../lib/stream-store';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { startTimer } from '../lib/metrics';
import { ensureUser, ensureSession, ensureConversation, createConversation, appendMessage, isConvDbEnabled } from '../lib/conv-db';
// LLM cache removed: always compute fresh responses

const router = Router();

// Helpers: extract SQL tagged by <sql start> ... <sql end> from LLM output
function extractTaggedSQL(text: string): string[] {
  const out: string[] = [];
  const s = String(text || '');
  const re = /<sql\s*start>([\s\S]*?)<sql\s*end>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const inner = (m[1] || '').trim();
    if (inner) {
      // Strip surrounding code fences if any slipped in
      const cleaned = inner.replace(/^```[\s\S]*?\n|```$/g, '').trim().replace(/;\s*$/, '');
      if (cleaned) out.push(cleaned);
    }
  }
  return out;
}

function extractTablesFromSQL(sql: string): string[] {
  const s = sql || '';
  const names = new Set<string>();
  const re = /\b(?:FROM|JOIN)\b\s+([A-Za-z0-9_\.\"]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const raw = (m[1] || '').replace(/"/g, '');
    const table = raw.split('.')[0];
    if (table) names.add(table);
  }
  return Array.from(names);
}

function extractQualifiedColumns(sql: string): Array<{ table: string; column: string }> {
  const out: Array<{ table: string; column: string }> = [];
  const re = /\b([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    out.push({ table: m[1], column: m[2] });
  }
  return out;
}

// LLM configuration status
router.get('/status', (_req, res) => {
  try {
    const summary = schemaStore.getLLMStatusSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read status' })
  }
});

// Full dataset streaming: open a server cursor and return first page
router.post('/execute-sql-stream', async (req, res) => {
  const body = z.object({ sqlQuery: z.string().min(1), binds: z.union([z.record(z.any()), z.array(z.any())]).optional(), pageSize: z.number().int().positive().max(5000).optional(), full: z.boolean().optional() });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query', issues: parsed.error.issues });
  try {
    const original = parsed.data.sqlQuery.trim().replace(/;+\s*$/, '');
    let sql = original;
    if (parsed.data.full) {
      sql = stripLimitClauses(original);
    } else {
      const mFetch = sql.match(/FETCH\s+FIRST\s+(\d+)\s+ROWS\s+ONLY/i);
      if (mFetch) {
        const n = mFetch[1];
        const base = sql.replace(/FETCH\s+FIRST\s+\d+\s+ROWS\s+ONLY\s*$/i, '').trim();
        sql = `SELECT * FROM (${base}) WHERE ROWNUM <= ${n}`;
      }
      const mLimit = sql.match(/\bLIMIT\s+(\d+)\s*$/i);
      if (mLimit) {
        const n = mLimit[1];
        const base = sql.replace(/\bLIMIT\s+\d+\s*$/i, '').trim();
        sql = `SELECT * FROM (${base}) WHERE ROWNUM <= ${n}`;
      }
    }
    const pageSize = Number(parsed.data.pageSize ?? 1000);
    const { id, columns, rows, hasMore } = await openStream(sql, parsed.data.binds, pageSize);
    res.json({ cursorId: id, columns, rows, hasMore });
  } catch (err: any) {
    const details = err instanceof DatabaseError ? err.details : undefined;
    res.status(400).json({ error: 'Failed to open stream', code: err.code || 'UNKNOWN', details });
  }
});

// Fetch next page from an open server cursor
router.post('/sql-stream-next', async (req, res) => {
  const body = z.object({ cursorId: z.string().min(1) });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
  try {
    const { rows, hasMore } = await fetchNext(parsed.data.cursorId);
    res.json({ rows, hasMore });
  } catch (err: any) {
    const details = err instanceof DatabaseError ? err.details : undefined;
    res.status(400).json({ error: 'Failed to fetch next', code: err.code || 'UNKNOWN', details });
  }
});

// Close a server cursor explicitly
router.post('/sql-stream-close', async (req, res) => {
  const body = z.object({ cursorId: z.string().min(1) });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
  try {
    await closeStream(parsed.data.cursorId);
    res.json({ closed: true });
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to close cursor' });
  }
});

// Stream CSV export of full dataset (no row cap)
router.post('/export-csv', async (req, res) => {
  const body = z.object({ sqlQuery: z.string().min(1), filename: z.string().optional(), pageSize: z.number().int().positive().max(5000).optional() });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid export request', issues: parsed.error.issues });
  try {
    const original = parsed.data.sqlQuery.trim().replace(/;+\s*$/, '');
    const sql = stripLimitClauses(original);
    const pageSize = Number(parsed.data.pageSize ?? 2000);

    // Open result set directly for streaming
    const connection = await (await import('oracledb')).default.getConnection();
    const execRes: any = await connection.execute(sql, [], { outFormat: (await import('oracledb')).default.OUT_FORMAT_OBJECT, resultSet: true, fetchArraySize: pageSize } as any);
    const rs = execRes.resultSet;
    const md: Array<{ name: string; dbTypeName?: string }> = Array.isArray(execRes?.metaData) ? execRes.metaData : [];
    const columns = md.map((c) => String(c?.name || '')).filter(Boolean);

    const filename = (parsed.data.filename || 'query-results.csv').replace(/[^a-z0-9._-]/gi, '_');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const esc = (v: any) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    // Write header
    res.write(columns.join(',') + '\n');
    // Stream rows in chunks
    while (true) {
      const rows: any[] = await rs.getRows(pageSize);
      if (!rows || rows.length === 0) break;
      for (const r of rows) {
        const line = columns.map(c => esc((r as any)[c])).join(',');
        res.write(line + '\n');
      }
      if (rows.length < pageSize) break;
    }
    try { await rs.close(); } catch {}
    try { await connection.close(); } catch {}
    res.end();
  } catch (err: any) {
    logQueryError('CSV export failed', err, { route: 'export-csv' });
    res.status(400).json({ error: 'Export failed', code: err.code || 'UNKNOWN', details: err?.message });
  }
});

// Configure LLM
router.post('/configure-llm', (req, res) => {
  const body = z.object({
    type: z.enum(['openai', 'gemini', 'azure', 'openai_compatible', 'anthropic', 'ollama']),
    apiKey: z.string().min(1).optional(),
    endpoint: z.string().url().optional(),
    deployment: z.string().optional(),
    apiVersion: z.string().optional(),
    baseUrl: z.string().url().optional(),
    model: z.string().optional(),
    ollamaHost: z.string().url().optional()
  });

  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid configuration', issues: parsed.error.issues });
  }

  try {
    const { type, apiKey, endpoint, deployment, apiVersion, baseUrl, model, ollamaHost } = parsed.data;
    const config: Record<string, any> = {};

    if (type === 'openai' || type === 'gemini') {
      if (!apiKey) {
        return res.status(400).json({ error: `${type} requires apiKey` });
      }
      config.apiKey = apiKey;
    } else if (type === 'azure') {
      if (!apiKey || !endpoint || !deployment) {
        return res.status(400).json({ error: 'Azure requires apiKey, endpoint, and deployment' });
      }
      config.apiKey = apiKey;
      config.endpoint = endpoint;
      config.deployment = deployment;
      config.apiVersion = apiVersion || '2024-05-01-preview';
    } else if (type === 'openai_compatible') {
      if (!apiKey || !baseUrl || !model) {
        return res.status(400).json({ error: 'OpenAI-compatible requires apiKey, baseUrl, and model' });
      }
      config.apiKey = apiKey;
      config.baseUrl = baseUrl;
      config.model = model;
    } else if (type === 'anthropic') {
      if (!apiKey || !model) {
        return res.status(400).json({ error: 'Anthropic requires apiKey and model' });
      }
      config.apiKey = apiKey;
      config.model = model;
      config.version = apiVersion || '2023-06-01';
    } else if (type === 'ollama') {
      if (!ollamaHost || !model) {
        return res.status(400).json({ error: 'Ollama requires ollamaHost and model' });
      }
      config.ollamaHost = ollamaHost;
      config.model = model;
    } else {
      return res.status(400).json({ error: 'Unsupported LLM type' });
    }

    schemaStore.setLLMConfig(type, config);
    // Mark as not connected until tested
    schemaStore.setLLMConnected(type, false);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

// Disconnect LLM configuration
router.post('/disconnect-llm', (req, res) => {
  const body = z.object({ type: z.enum(['openai', 'gemini', 'azure', 'openai_compatible', 'anthropic', 'ollama']) });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
  }
  try {
    const removed = schemaStore.removeLLMConfig(parsed.data.type);
    if (!removed) {
      return res.status(404).json({ error: 'LLM configuration not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disconnect LLM' });
  }
});

// Test LLM connectivity with a minimal request
router.post('/test-llm', async (req, res) => {
  const body = z.object({ type: z.enum(['openai', 'gemini', 'azure', 'openai_compatible', 'anthropic', 'ollama']) });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
  }
  const { type } = parsed.data;
  const llmConfig = schemaStore.getLLMConfig(type);
  if (!llmConfig) {
    return res.status(400).json({ error: 'LLM not configured' });
  }
  try {
    const testPrompt = 'Reply with OK';
    if (type === 'openai') {
      const client = new OpenAI({ apiKey: llmConfig.apiKey });
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Health check' },
          { role: 'user', content: testPrompt }
        ],
        temperature: 0
      });
      const text = completion.choices?.[0]?.message?.content?.trim() || '';
      schemaStore.setLLMConnected(type, true);
      return res.json({ ok: true, response: text });
    } else if (type === 'gemini') {
      const genAI = new GoogleGenerativeAI(llmConfig.apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(testPrompt);
      const text = result.response.text().trim();
      schemaStore.setLLMConnected(type, true);
      return res.json({ ok: true, response: text });
    } else if (type === 'azure') {
      const url = `${llmConfig.endpoint}/openai/deployments/${llmConfig.deployment}/chat/completions?api-version=${llmConfig.apiVersion || '2024-05-01-preview'}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': llmConfig.apiKey },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'Health check' },
            { role: 'user', content: testPrompt }
          ],
          temperature: 0
        })
      });
      if (!resp.ok) {
        const msg = await resp.text();
        schemaStore.setLLMConnected(type, false);
        return res.status(resp.status).json({ error: msg || 'Azure OpenAI test failed' });
      }
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content?.trim() || '';
      schemaStore.setLLMConnected(type, true);
      return res.json({ ok: true, response: text });
    } else if (type === 'openai_compatible') {
      const client = new OpenAI({ apiKey: llmConfig.apiKey, baseURL: llmConfig.baseUrl });
      const completion = await client.chat.completions.create({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: 'Health check' },
          { role: 'user', content: testPrompt }
        ],
        temperature: 0
      });
      const text = completion.choices?.[0]?.message?.content?.trim() || '';
      schemaStore.setLLMConnected(type, true);
      return res.json({ ok: true, response: text });
    } else if (type === 'anthropic') {
      const url = 'https://api.anthropic.com/v1/messages';
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': llmConfig.apiKey,
          'anthropic-version': llmConfig.version || '2023-06-01'
        },
        body: JSON.stringify({
          model: llmConfig.model,
          max_tokens: 50,
          messages: [
            { role: 'user', content: testPrompt }
          ]
        })
      });
      if (!resp.ok) {
        const msg = await resp.text();
        schemaStore.setLLMConnected(type, false);
        return res.status(resp.status).json({ error: msg || 'Anthropic test failed' });
      }
      const data = await resp.json();
      const text = (Array.isArray(data?.content) && data.content[0]?.text ? String(data.content[0].text).trim() : '').trim();
      schemaStore.setLLMConnected(type, true);
      return res.json({ ok: true, response: text });
    } else if (type === 'ollama') {
      const url = `${llmConfig.ollamaHost}/api/generate`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: llmConfig.model, prompt: testPrompt, stream: false })
      });
      if (!resp.ok) {
        const msg = await resp.text();
        schemaStore.setLLMConnected(type, false);
        return res.status(resp.status).json({ error: msg || 'Ollama test failed' });
      }
      const data = await resp.json();
      const text = (data?.response || '').trim();
      schemaStore.setLLMConnected(type, true);
      return res.json({ ok: true, response: text });
    }
    return res.status(400).json({ error: 'Unsupported LLM type' });
  } catch (err: any) {
    schemaStore.setLLMConnected(parsed.data.type, false);
    return res.status(500).json({ error: 'LLM connectivity test failed', details: String(err?.message || err) });
  }
});

// Load schema for selected tables
router.post('/schema', async (req, res) => {
  const body = z.object({
    tables: z.array(z.string()).min(1)
  });
  
  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
  }
  
  try {
    // Helper to strip relationships to ensure lean, serializable payload
    const prune = (tables: ReturnType<typeof schemaStore.getSchemaForTables>) =>
      tables.map(t => ({ name: t.name, columns: t.columns }));

    // Disallow full-database selection
    if (!parsed.data.tables.length) {
      logAccessViolation('Schema POST denied: empty table list', {}, { route: '/chat/schema' });
      return res.status(400).json({ error: 'Tables required', code: 'SchemaAccessDenied' });
    }

    // Refresh specified tables and set current selection
    const ok = await schemaStore.refreshSchema(parsed.data.tables);
    schemaStore.setSelectedTables(parsed.data.tables);
    const loaded = schemaStore.getSchemaForTables(parsed.data.tables);
    const requested = new Set(parsed.data.tables);
    const loadedNames = new Set(loaded.map(t => t.name));
    const failedTables = ok ? Array.from(requested).filter(n => !loadedNames.has(n)) : Array.from(requested);
    const tables = prune(loaded);
    res.json({ tables, version: schemaStore.getSchemaVersion(), failedTables });
  } catch (err) {
    console.error('Schema loading error:', err);
    res.status(500).json({ error: 'Failed to load schema', details: String(err) });
  }
});

// Read currently selected schema (GET for client compatibility)
router.get('/schema', async (_req, res) => {
  try {
    const prune = (tables: ReturnType<typeof schemaStore.getSchemaForTables>) =>
      tables.map(t => ({ name: t.name, columns: t.columns }));

    const selected = schemaStore.getSelectedTables();
    let tables: Array<{ name: string; columns: any[] }> = [];
    let failedTables: string[] = [];

    if (!selected.length) {
      // No selection: return empty schema without auto-selecting all
      tables = [];
      failedTables = [];
    } else {
      const loaded = schemaStore.getSchemaForTables(selected);
      const loadedNames = new Set(loaded.map(t => t.name));
      tables = prune(loaded);
      failedTables = Array.from(selected).filter(n => !loadedNames.has(n));
    }

    res.json({ tables, version: schemaStore.getSchemaVersion(), failedTables });
  } catch (err: any) {
    console.error('Schema GET error:', err);
    res.status(500).json({ error: 'Failed to load schema', details: String(err?.message || err) });
  }
});

// Generate SQL from natural language using LLM
router.post('/prompt', async (req, res) => {
  const body = z.object({
    prompt: z.string().min(1),
    llmType: z.enum(['openai', 'gemini', 'azure', 'openai_compatible', 'anthropic', 'ollama']),
    tables: z.array(z.string()).min(1),
    trace: z.boolean().optional(),
    conversationId: z.string().optional(),
    clientMessageId: z.string().optional(),
    persist: z.boolean().optional(),
  });
  
  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
  }
  
  const llmConfig = schemaStore.getLLMConfig(parsed.data.llmType);
  if (!llmConfig) {
    return res.status(400).json({ error: 'LLM not configured' });
  }
  if (!llmConfig.connected) {
    return res.status(400).json({ error: 'LLM configured but not connected', code: 'LLMNotConnected' });
  }
  
  try {
    const totalTimer = startTimer('chat.prompt.total');
    // Enforce strict table selection
    try {
      enforceTableSelection(parsed.data.tables);
    } catch (e: any) {
      logAccessViolation('Prompt denied: invalid table selection', { tables: parsed.data.tables, reason: e?.message }, { route: '/chat/prompt' });
      return res.status(400).json({ error: 'Invalid table selection', code: e?.code || 'SchemaAccessDenied', details: e?.message || 'Invalid selection' });
    }
    // Optional server-side conversation persistence when conv-db is enabled
    let convId: string | null = null;
    let userId: string | null = null;
    let sessionId: string | null = null;
    const externalId = (req.headers['x-user-id'] as string) || (req.headers['x-client-id'] as string) || req.ip || 'anonymous';
    if (isConvDbEnabled() && parsed.data.persist !== false) {
      try {
        userId = await ensureUser(externalId);
        sessionId = await ensureSession(userId, process.env.SERVER_ID || 'smart-analytics', { ua: req.headers['user-agent'] });
        if (parsed.data.conversationId) {
          convId = parsed.data.conversationId;
          await ensureConversation(convId, userId, sessionId, 'Conversation');
        } else {
          convId = await createConversation(userId, sessionId, 'Conversation', Number(process.env.CONV_RETENTION_DAYS || 0));
        }
        // Persist user prompt message
        await appendMessage(convId!, 'user', String(parsed.data.prompt), undefined, parsed.data.clientMessageId || undefined);
      } catch (err) {
        console.warn('Conversation persistence failed (user message):', err);
      }
    }
    // Build schema context from cached selection; fallback if not set
    let schemaContext = '';
    const selected = parsed.data.tables;
    // Avoid unnecessary refresh if schema metadata is already present
    const metasPre = schemaStore.getSchemaForTables(selected);
    if (metasPre.length !== selected.length) {
      await schemaStore.refreshSchema(selected);
    }
    schemaStore.setSelectedTables(selected);
    schemaContext = schemaStore.buildSchemaContext(selected);
    
    let response;
    const guidance = [
      'You are a helpful assistant for an Oracle database.',
      'Follow a schema-first approach using ONLY the provided tables/columns. Do not invent schema.',
      'When you include any SQL in your response, STRICTLY wrap each complete SQL statement with the tags:',
      '  <sql start> ...pure SQL only... <sql end>',
      'Do NOT put any prose, comments, markdown, or extra text between the SQL tags. Each statement must be executable as-is.',
      'Wrap any non-SQL narrative or explanation STRICTLY between <text> and </text> tags, and place this text BEFORE any SQL.',
      'Only use the provided schema; do not invent columns or tables.',
      "Always ensure EXTRACT is used only on TIMESTAMP columns (or convert DATE to TIMESTAMP) to prevent ORA-30076 errors.",
      "Never use ORDER BY or FETCH inside scalar subqueries; wrap them in a subquery/CTE.",
      'Oracle hints: Prefer FETCH FIRST N ROWS ONLY; Oracle 11g+ syntax; ensure CASE has END; GROUP BY non-aggregates.',
      // Chart metadata guidance (always present in system prompt)
      'If you propose a chart, include explicit metadata tags using this exact format:\n<chart>type</chart> (e.g., Bar, line, pie, scatter, column , stackedbar, kpi , hitsogram(always include charts from these charts list ,, if user asks to generate some other chart replace its with best chart from this list) )\n<xaxis>column_name</xaxis>\n<yaxis>column_name</yaxis> (repeat <yaxis> for multiple measures).',
      'Optional tags: <y2axis>, <zaxis>, <coloraxis> when applicable. Use only columns from the provided tables. Do not invent fields and donot give multiple columns for a single axis.',
      "whenever u propose a chart always provide sql query first for the chart and then chart and its axises",
      "always give one time text before the sqls and whenever you are proposing some charts always its "
    ].join(' ');

    const systemPrompt = `${guidance}\n\nSchema Version: ${schemaStore.getSchemaVersion()}`;
    const userPrompt = `Schema:\n${schemaContext}\n\nUser request:\n${parsed.data.prompt}`;

    // Prepare messages uniformly for optional trace
    const requestMessages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
    let modelUsed: string | undefined = undefined;
    const mt = startTimer('chat.prompt.model');
    let content = '';
    let used = '';
    if (parsed.data.llmType === 'openai') {
      const openai = new OpenAI({ apiKey: llmConfig.apiKey });
      const completion = await openai.chat.completions.create({
        model: llmConfig.model || 'gpt-4o-mini',
        messages: requestMessages,
        max_tokens: 800,
        temperature: 0
      });
      content = completion.choices[0].message.content?.trim() || '';
      used = String(llmConfig.model || 'gpt-4o-mini');
    } else if (parsed.data.llmType === 'gemini') {
      const genAI = new GoogleGenerativeAI(llmConfig.apiKey);
      const model = genAI.getGenerativeModel({ model: llmConfig.model || 'gemini-2.5-flash' });
      const promptText = `${systemPrompt}\n\n${userPrompt}`;
      const result = await model.generateContent(promptText);
      content = result.response.text().trim();
      used = String(llmConfig.model || 'gemini-2.5-flash');
    } else if (parsed.data.llmType === 'azure') {
      const url = `${llmConfig.endpoint}/openai/deployments/${llmConfig.deployment}/chat/completions?api-version=${llmConfig.apiVersion || '2024-05-01-preview'}`;
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': llmConfig.apiKey }, body: JSON.stringify({ messages: requestMessages, temperature: 0, max_tokens: 800 }) });
      if (!resp.ok) {
        const msg = await resp.text();
        throw new Error(msg || 'Azure OpenAI request failed');
      }
      const data = await resp.json();
      content = data?.choices?.[0]?.message?.content?.trim() || '';
      used = String(llmConfig.deployment || 'azure-deployment');
    } else if (parsed.data.llmType === 'openai_compatible') {
      const client = new OpenAI({ apiKey: llmConfig.apiKey, baseURL: llmConfig.baseUrl });
      const completion = await client.chat.completions.create({ model: llmConfig.model, messages: requestMessages, max_tokens: 800, temperature: 0 });
      content = completion.choices[0]?.message?.content?.trim() || '';
      used = String(llmConfig.model || 'openai-compatible');
    } else if (parsed.data.llmType === 'anthropic') {
      const url = 'https://api.anthropic.com/v1/messages';
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': llmConfig.apiKey, 'anthropic-version': llmConfig.version || '2023-06-01' }, body: JSON.stringify({ model: llmConfig.model, system: systemPrompt, max_tokens: 1024, messages: [ { role: 'user', content: userPrompt } ] }) });
      if (!resp.ok) {
        const msg = await resp.text();
        throw new Error(msg || 'Anthropic request failed');
      }
      const data = await resp.json();
      content = (Array.isArray(data?.content) && data.content[0]?.text ? String(data.content[0].text).trim() : '').trim();
      used = String(llmConfig.model || 'anthropic');
    } else if (parsed.data.llmType === 'ollama') {
      const url = `${llmConfig.ollamaHost}/api/generate`;
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: `${systemPrompt}\n\n${userPrompt}`, model: llmConfig.model, stream: false }) });
      if (!resp.ok) {
        const msg = await resp.text();
        throw new Error(msg || 'Ollama request failed');
      }
      const data = await resp.json();
      content = (data?.response || '').trim();
      used = String(llmConfig.model || 'ollama');
    }
    mt.end();
    response = content;
    modelUsed = used;
    // Some providers may return a JSON object with keys like { response, explanation }
    // Attempt a safe parse without failing the request
    let parsedJson: { response?: string; explanation?: string } | undefined = undefined;
    if (typeof response === 'string' && response.trim().startsWith('{')) {
      try {
        const obj = JSON.parse(response);
        if (obj && (typeof obj.response === 'string' || typeof obj.explanation === 'string')) {
          parsedJson = obj;
        }
      } catch (_) {
        // Ignore parse errors and fall back to raw string response
      }
    }
    const allQueries = extractTaggedSQL(response);
    const finalSql = allQueries[0] || '';
    const selectedSet = new Set(schemaStore.getSelectedTables());
    const tablesUsed = Array.from(new Set(allQueries.flatMap(q => extractTablesFromSQL(q))));
    const unknownTables = tablesUsed.filter(t => t && !selectedSet.has(t));
    const unknownColumns: Array<{ table: string; column: string }> = [];
    for (const q of allQueries) {
      const qualifiedCols = extractQualifiedColumns(q);
      for (const qc of qualifiedCols) {
        const meta = schemaStore.getSchemaForTables([qc.table])[0];
        const ok = !!meta && !!meta.columns.find(c => c.column_name.toUpperCase() === qc.column.toUpperCase());
        if (!ok) unknownColumns.push(qc);
      }
    }

    // Schema transmission summary
    const usedTables = schemaStore.getSelectedTables();
    const metas = schemaStore.getSchemaForTables(usedTables);
    const columnsCount = metas.reduce((sum, m) => sum + (m.columns?.length || 0), 0);
    const failedTables = Array.from(new Set(
      (parsed.data.tables || [])
        .map(t => String(t).toUpperCase())
        .filter(t => !new Set(metas.map(m => m.name)).has(t))
    ));
    const schemaIncluded = !!(schemaContext && metas.length);

    // Optional tracing payload
    const fullTextForTrace = `${systemPrompt}\n\n${userPrompt}`;
    const tracePayload = parsed.data.trace ? {
      provider: parsed.data.llmType,
      model: modelUsed || (llmConfig.model || undefined),
      request: {
        messages: requestMessages,
        endpoint: llmConfig.endpoint || llmConfig.baseUrl || llmConfig.ollamaHost || undefined
      },
      response: {
        text: response
      },
      rawText: {
        system: systemPrompt,
        user: userPrompt,
        full: fullTextForTrace
      },
      charCounts: {
        system: systemPrompt.length,
        user: userPrompt.length,
        schema: schemaContext.length,
        full: fullTextForTrace.length
      },
      schema: {
        included: schemaIncluded,
        version: schemaStore.getSchemaVersion(),
        usedTables,
        failedTables,
        summary: { tables: metas.length, columns: columnsCount }
      }
    } : undefined;

    // Persist assistant reply
    if (isConvDbEnabled() && convId) {
      try {
        await appendMessage(convId, 'assistant', String(response || ''), undefined, undefined, tracePayload);
      } catch (err) {
        console.warn('Conversation persistence failed (assistant message):', err);
      }
    }

    const dur = totalTimer.end();
    res.json({
      response: (parsedJson?.response || parsedJson?.explanation || response),
      sqlQuery: finalSql,
      sqlQueries: allQueries,
      schemaVersion: schemaStore.getSchemaVersion(),
      schemaIncluded,
      schemaSummary: { tables: metas.length, columns: columnsCount },
      usedTables,
      failedTables,
      validation: {
        tablesUsed,
        unknownTables,
        unknownColumns
      },
      trace: tracePayload,
      latencyMs: Math.round(dur),
      conversationId: convId || undefined,
    });
  } catch (err) {
    console.error('LLM error:', err);
    res.status(500).json({ error: 'Failed to generate SQL', details: String(err) });
  }
});

// Detect Oracle-unsafe SQL patterns before execution to avoid common runtime errors
function preflightOracleIssues(sql: string): string[] {
  const issues: string[] = [];
  // LISTAGG with DISTINCT is not allowed in Oracle
  if (/LISTAGG\s*\(\s*DISTINCT\b/i.test(sql)) {
    issues.push('LISTAGG with DISTINCT is unsupported; dedupe via subquery, then apply LISTAGG.');
  }
  // Ensure CASE expressions are closed with END
  const caseCount = (sql.match(/\bCASE\b/gi) || []).length;
  const endCount = (sql.match(/\bEND\b/gi) || []).length;
  if (endCount < caseCount) {
    issues.push('CASE expression missing END. Ensure every CASE has an END.');
  }
  // Basic check that SELECT has a FROM clause (or FROM DUAL)
  if (/\bSELECT\b/i.test(sql) && !/\bFROM\b/i.test(sql) && !/\bFROM\s+DUAL\b/i.test(sql)) {
    issues.push('SELECT missing FROM clause. Use FROM DUAL for scalar expressions.');
  }
  // COUNT DISTINCT must be written as COUNT(DISTINCT col)
  if (/\bCOUNT\s+DISTINCT\b(?!\s*\()/i.test(sql)) {
    issues.push('Use COUNT(DISTINCT col) with parentheses, not COUNT DISTINCT col.');
  }
  // DATE_TRUNC is not an Oracle function
  if (/\bDATE_TRUNC\s*\(/i.test(sql)) {
    issues.push("DATE_TRUNC is not supported in Oracle; use TRUNC(date_col, 'MM') or similar.");
  }
  // SUBSTRING is MySQL/Postgres; Oracle uses SUBSTR
  if (/\bSUBSTRING\s*\(/i.test(sql)) {
    issues.push('Use SUBSTR(col, start, length) instead of SUBSTRING in Oracle.');
  }
  // GROUP_CONCAT is MySQL; Oracle uses LISTAGG
  if (/\bGROUP_CONCAT\s*\(/i.test(sql)) {
    issues.push("GROUP_CONCAT is not supported; use LISTAGG(col, ',') WITHIN GROUP (ORDER BY ...) in Oracle.");
  }
  // EXTRACT('year' FROM ...) must not quote the field identifier
  if (/\bEXTRACT\s*\(\s*'\w+'\s+FROM\s+/i.test(sql)) {
    issues.push('Use EXTRACT(YEAR FROM date_col) without quotes around YEAR/MONTH/DAY.');
  }
  return issues;
}

// Execute SQL query
router.post('/execute-sql', async (req, res) => {
  const body = z.object({
    sqlQuery: z.string().min(1),
    conversationId: z.string().uuid().optional(),
    full: z.boolean().optional(),
    // Optional bind parameters: allow object or array
    binds: z.union([z.record(z.any()), z.array(z.any())]).optional()
  });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query', issues: parsed.error.issues });
  }
  
  let originalSql = '';
  try {
    console.log('Executing SQL:', parsed.data.sqlQuery.slice(0, 100) + (parsed.data.sqlQuery.length > 100 ? '...' : ''));
    // Normalize SQL; for full retrieval strip LIMIT/FETCH, else rewrite Top-N for Oracle 11g
    originalSql = parsed.data.sqlQuery.trim().replace(/;+\s*$/, '');
    let sqlToRun = originalSql;
    if (parsed.data.full) {
      sqlToRun = stripLimitClauses(originalSql);
    } else {
      const mFetch = sqlToRun.match(/FETCH\s+FIRST\s+(\d+)\s+ROWS\s+ONLY/i);
      if (mFetch) {
        const n = mFetch[1];
        const base = sqlToRun.replace(/FETCH\s+FIRST\s+\d+\s+ROWS\s+ONLY\s*$/i, '').trim();
        sqlToRun = `SELECT * FROM (${base}) WHERE ROWNUM <= ${n}`;
        console.log('Rewrote FETCH FIRST to ROWNUM:', sqlToRun);
      }
      const mLimit = sqlToRun.match(/\bLIMIT\s+(\d+)\s*$/i);
      if (mLimit) {
        const n = mLimit[1];
        const base = sqlToRun.replace(/\bLIMIT\s+\d+\s*$/i, '').trim();
        sqlToRun = `SELECT * FROM (${base}) WHERE ROWNUM <= ${n}`;
        console.log('Rewrote LIMIT to ROWNUM:', sqlToRun);
      }
    }

    // Preflight Oracle-unsafe patterns to prevent common runtime errors
    const preIssues = preflightOracleIssues(sqlToRun);
    if (preIssues.length) {
      return res.status(400).json({
        error: 'OracleUnsafeSQL',
        code: 'ORA-Preflight',
        details: preIssues
      });
    }

    // Validate column names before execution using selected schema
    const tablesUsed = extractTablesFromSQL(sqlToRun);
    const qualifiedCols = extractQualifiedColumns(sqlToRun);
    const byTable: Record<string, string[]> = {};
    for (const qc of qualifiedCols) {
      const t = qc.table.toUpperCase();
      if (!byTable[t]) byTable[t] = [];
      byTable[t].push(qc.column.toUpperCase());
    }
    const schemaVersion = schemaStore.getSchemaVersion();
    for (const t of tablesUsed) {
      const meta = schemaStore.getSchemaForTables([t])[0];
      if (!meta) continue;
      const available = meta.columns.map(c => String(c.column_name).toUpperCase());
      const referenced = (byTable[t.toUpperCase()] || []).filter(Boolean);
      if (referenced.length) {
        const mismatch = buildColumnMismatchMessage(t, referenced, available, schemaVersion);
        if (mismatch.missing.length) {
          logSchemaMismatch(mismatch.message, mismatch, { route: 'execute-sql', sql: sqlToRun });
          return res.status(400).json({
            error: 'Invalid column name',
            code: 'ORA-00904',
            details: mismatch
          });
        }
      }
    }
    const rows = parsed.data.full ? await executeQueryAll(sqlToRun, parsed.data.binds) : await executeQuery(sqlToRun, parsed.data.binds);
    let columns: Array<{ name: string; type?: string }> = [];
    if (rows.length > 0) {
      columns = Object.keys(rows[0]).map(name => ({ name, type: typeof (rows[0] as any)[name] }));
    } else {
      // Fallback to column metadata when no rows returned
      try {
        const metaCols = await getQueryColumns(sqlToRun, parsed.data.binds);
        columns = metaCols.map(c => ({ name: c.name, type: c.type }));
      } catch {
        columns = [];
      }
    }
    // Validation if full retrieval requested
    let validation: any = undefined;
    if (parsed.data.full) {
      const simple = isSimpleTableSelect(originalSql);
      if (simple?.table) {
        try {
          const cntRows = await executeQuery(`SELECT COUNT(*) AS CNT FROM ${simple.table}`);
          const expected = Number((cntRows[0] as any)?.CNT || 0);
          validation = validateDatasetCompleteness(rows, expected);
          if (!validation.complete) {
            logValidationFailure('Full dataset retrieval incomplete', { table: simple.table, validation }, { route: 'execute-sql', sql: originalSql });
          }
        } catch {}
      }
      const fmtIssues = detectFormattingIssues(rows);
      if (fmtIssues.length) {
        validation = { ...(validation || {}), formattingIssues: fmtIssues.length };
      }
    }
    res.json({ columns, rows, validation });
  } catch (err: any) {
    console.error('SQL execution error:', err);
    // Build targeted Oracle hints
    const code = err?.code || 'UNKNOWN';
  const hints: string[] = [];
  if (code === 'ORA-00933') hints.push('Ensure Oracle-specific syntax. Remove trailing semicolons and check parentheses.');
  if (code === 'ORA-00904') hints.push('Verify column names and case. Oracle treats unquoted identifiers as uppercase.');
  if (code === 'ORA-00907') hints.push('Missing right parenthesis: check unmatched parentheses, function syntax (e.g., COUNT(DISTINCT col)), subquery wrapping, and Oracle-specific functions (TRUNC, SUBSTR, LISTAGG).');
  if (code === 'ORA-01861') hints.push("Use TO_CHAR(date_col, 'YYYY-MM-DD HH24') instead of relying on NLS formats.");
  if (code === 'ORA-01830') hints.push("Use complete format masks like 'YYYY-MM-DD HH24:MI:SS' for TO_CHAR/TO_DATE.");
  if (code === 'ORA-01722') hints.push('Avoid numeric comparison with non-numeric literals; cast or correct values.');
  if (/\bLIMIT\b/i.test(parsed.data.sqlQuery) || /FETCH\s+FIRST/i.test(parsed.data.sqlQuery)) hints.push('Oracle 11g does not support LIMIT/FETCH FIRST. Use ROWNUM or wrap SELECT.');

    // Attach DB environment info to aid comparison with Toad
    let envInfo: any = null;
    try {
      envInfo = await validateConnection();
    } catch {}

    const payload = {
      error: err instanceof DatabaseError ? (err.message || 'Query execution failed') : 'Query execution failed',
      code,
      details: err?.details || {},
      sql: originalSql,
      sqlPreview: String(originalSql).slice(0, 200),
      hints,
      env: envInfo || undefined
    };
    const status = err instanceof DatabaseError ? 400 : 500;
    return res.status(status).json(payload);
  }
});

// Analyze dataset via LLM to recommend raw-data visualizations
router.post('/analyze-data', async (req, res) => {
  const body = z.object({
    llmType: z.enum(['openai', 'gemini', 'azure', 'openai_compatible', 'anthropic', 'ollama']),
    conversationId: z.string().uuid().optional(),
    dataset: z.object({
      columns: z.array(z.object({ name: z.string(), type: z.string().optional() })).min(1),
      // rows are optional and ignored for LLM analysis per request
      rows: z.array(z.record(z.any())).optional()
    })
  });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
  }

  const { llmType, conversationId, dataset } = parsed.data;
  const llmConfig = schemaStore.getLLMConfig(llmType);
  if (!llmConfig) return res.status(400).json({ error: 'LLM not configured' });
  if (!llmConfig.connected) return res.status(400).json({ error: 'LLM configured but not connected', code: 'LLMNotConnected' });

  try {
    const totalTimer = startTimer('chat.analyze.total');
    // Build payload with ONLY columns; do not include row values in LLM prompt.
    const payload = {
      columns: dataset.columns.map(c => ({ name: c.name, type: c.type }))
    };

    const system = [
      'You are a data visualization assistant. Analyze the provided table strictly as-is.',
      'Preserve data integrity: do NOT bin or modify values. If aggregation is desired, specify it via config (yAgg/y2Agg) for client-side grouping by xField. Do NOT invent aggregated values or perform binning.',
      'Suggest charts that map raw rows directly (e.g., line over time using a timestamp column and a numeric column; scatter using two numeric columns; bar/column using a categorical column and a per-row numeric measure).',
      'Return ONLY JSON. No prose.'
    ].join(' ');

    const instruction = [
      'Given ONLY the column metadata JSON, output visualization suggestions as an array under key "suggestions".',
      'Each suggestion must be an object: { type, title, fields: { xField, yField?, y2Field? }, config? }.',
      'If proposing aggregation, include config.yAgg and/or config.y2Agg. Allowed values: none, sum, avg, count, min, max. Aggregation is performed client-side grouped by xField.',
      'Allowed types: line, column, bar, stackedBar, scatter, pie, donut, histogram, funnel, gauge, bubble.',
      'Choose fields that exist. Base your choices solely on column names/types; do NOT request or assume row values.',
      'Prefer sensible mappings: temporal xField for line; categorical xField with numeric yField for bar/column/pie; two numerics for scatter/bubble.',
      'Keep titles concise and informative.'
    ].join(' ');

    const user = `DATASET:\n${JSON.stringify(payload)}`;

    const mt2 = startTimer('chat.analyze.model');
    let text = '';
    if (llmType === 'openai') {
      const client = new OpenAI({ apiKey: llmConfig.apiKey });
      const completion = await client.chat.completions.create({ model: llmConfig.model || 'gpt-4o-mini', temperature: 0, messages: [ { role: 'system', content: system }, { role: 'user', content: `${instruction}\n\n${user}` } ] });
      text = completion.choices?.[0]?.message?.content?.trim() || '';
    } else if (llmType === 'gemini') {
      const genAI = new GoogleGenerativeAI(llmConfig.apiKey);
      const model = genAI.getGenerativeModel({ model: llmConfig.model || 'gemini-1.5-flash' });
      const resp = await model.generateContent([{ text: system }, { text: `${instruction}\n\n${user}` }]);
      text = String(resp?.response?.text?.() || '').trim();
    } else if (llmType === 'azure') {
      const resp = await fetch(`${llmConfig.endpoint}/openai/deployments/${llmConfig.deployment}/chat/completions?api-version=${llmConfig.apiVersion || '2024-05-01-preview'}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': llmConfig.apiKey }, body: JSON.stringify({ messages: [ { role: 'system', content: system }, { role: 'user', content: `${instruction}\n\n${user}` } ], temperature: 0 }) });
      if (!resp.ok) {
        const msg = await resp.text();
        throw new Error(msg || 'Azure OpenAI request failed');
      }
      const data = await resp.json();
      text = data?.choices?.[0]?.message?.content?.trim() || '';
    } else if (llmType === 'openai_compatible') {
      const client = new OpenAI({ apiKey: llmConfig.apiKey, baseURL: llmConfig.baseUrl });
      const completion = await client.chat.completions.create({ model: llmConfig.model, temperature: 0, messages: [ { role: 'system', content: system }, { role: 'user', content: `${instruction}\n\n${user}` } ] });
      text = completion.choices?.[0]?.message?.content?.trim() || '';
    } else if (llmType === 'anthropic') {
      const url = 'https://api.anthropic.com/v1/messages';
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': llmConfig.apiKey, 'anthropic-version': llmConfig.version || '2023-06-01' }, body: JSON.stringify({ model: llmConfig.model, max_tokens: 512, system, messages: [ { role: 'user', content: `${instruction}\n\n${user}` } ] }) });
      if (!resp.ok) {
        const msg = await resp.text();
        throw new Error(msg || 'Anthropic request failed');
      }
      const data = await resp.json();
      text = (Array.isArray(data?.content) && data.content[0]?.text ? String(data.content[0].text).trim() : '').trim();
    } else if (llmType === 'ollama') {
      const url = `${llmConfig.ollamaHost}/api/generate`;
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: llmConfig.model, prompt: `${system}\n\n${instruction}\n\n${user}`, stream: false }) });
      if (!resp.ok) {
        const msg = await resp.text();
        throw new Error(msg || 'Ollama request failed');
      }
      const data = await resp.json();
      text = (data?.response || '').trim();
    }
    mt2.end();

    // Try parsing JSON; if fail, attempt to extract fenced JSON
    let suggestions: any[] = [];
    const tryParse = (s: string) => { try { const j = JSON.parse(s); return j?.suggestions || j; } catch { return null; } };
    suggestions = tryParse(text) || tryParse((text.match(/```json[\s\S]*?```/i)?.[0] || '').replace(/```json|```/gi, '')) || [];
    if (!Array.isArray(suggestions)) suggestions = [];

    // Normalize and filter by existing fields
    const colNames = new Set(dataset.columns.map(c => c.name));
    const normalized = suggestions
      .map((s: any) => {
        const cfg = s?.config || {};
        const yAgg = String(cfg?.yAgg || 'none').toLowerCase();
        const y2Agg = String(cfg?.y2Agg || 'none').toLowerCase();
        return {
          type: String(s?.type || 'table'),
          title: String(s?.title || 'Chart').slice(0, 120),
          fields: {
            xField: String(s?.fields?.xField || s?.xField || ''),
            yField: s?.fields?.yField ? String(s.fields.yField) : (s?.yField ? String(s.yField) : undefined),
            y2Field: s?.fields?.y2Field ? String(s.fields.y2Field) : (s?.y2Field ? String(s.y2Field) : undefined)
          },
          config: { ...cfg, yAgg, y2Agg }
        };
      })
      .filter((s: any) => {
        if (!colNames.has(s.fields.xField)) return false;
        if (s.fields.yField && !colNames.has(s.fields.yField)) return false;
        if (s.fields.y2Field && !colNames.has(s.fields.y2Field)) return false;
        // Allow a broader set of chart types; exclude unsupported types
        if (!['line','bar','column','scatter','pie','donut','histogram','radar','treemap','funnel','gauge','bubble'].includes(s.type)) return false;
        return true;
      })
      ;

    const dur = totalTimer.end();
    res.json({ suggestions: normalized, latencyMs: Math.round(dur), llmText: text });
  } catch (err: any) {
    console.error('Analyze data error:', err);
    res.status(500).json({ error: 'Failed to analyze dataset', details: String(err?.message || err) });
  }
});

export default router;


