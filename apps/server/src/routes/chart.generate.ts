import { Router } from 'express';
import { z } from 'zod';
import { schemaStore } from '../lib/schema-store';
import { executeQuery, getQueryColumns, validateConnection, getTableSchema } from '../lib/db';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = Router();

function extractTaggedSQL(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const regex = /<sql\s+start>([\s\S]*?)<sql\s+end>/gi;
  const queries: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const q = (m[1] || '').trim();
    if (q) queries.push(q);
  }
  return queries;
}

function extractTaggedChart(text: string): any | null {
  if (!text || typeof text !== 'string') return null;
  const regex = /<chart\s+start>([\s\S]*?)<chart\s+end>/i;
  const m = regex.exec(text);
  if (!m) return null;
  const raw = (m[1] || '').trim();
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

function preflightOracleIssues(sql: string): string[] {
  const issues: string[] = [];
  if (/LISTAGG\s*\(\s*DISTINCT\b/i.test(sql)) {
    issues.push('LISTAGG with DISTINCT is unsupported; dedupe via subquery, then apply LISTAGG.');
  }
  const caseCount = (sql.match(/\bCASE\b/gi) || []).length;
  const endCount = (sql.match(/\bEND\b/gi) || []).length;
  if (endCount < caseCount) {
    issues.push('CASE expression missing END. Ensure every CASE has an END.');
  }
  if (/\bSELECT\b/i.test(sql) && !/\bFROM\b/i.test(sql) && !/\bFROM\s+DUAL\b/i.test(sql)) {
    issues.push('SELECT missing FROM clause. Use FROM DUAL for scalar expressions.');
  }
  return issues;
}

function rewriteTopN(sql: string, full: boolean): string {
  let sqlToRun = sql.trim().replace(/;+\s*$/,'');
  if (full) return sqlToRun;
  const mFetch = sqlToRun.match(/FETCH\s+FIRST\s+(\d+)\s+ROWS\s+ONLY/i);
  if (mFetch) {
    const n = mFetch[1];
    const base = sqlToRun.replace(/FETCH\s+FIRST\s+\d+\s+ROWS\s+ONLY\s*$/i, '').trim();
    sqlToRun = `SELECT * FROM (${base}) WHERE ROWNUM <= ${n}`;
  }
  const mLimit = sqlToRun.match(/\bLIMIT\s+(\d+)\s*$/i);
  if (mLimit) {
    const n = mLimit[1];
    const base = sqlToRun.replace(/\bLIMIT\s+\d+\s*$/i, '').trim();
    sqlToRun = `SELECT * FROM (${base}) WHERE ROWNUM <= ${n}`;
  }
  return sqlToRun;
}

// Resolve LLM provider configuration from environment variables per llmType
function getLLMConfigFromEnv(llmType: string): any {
  switch (llmType) {
    case 'openai':
      return {
        connected: !!process.env.OPENAI_API_KEY,
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      };
    case 'gemini':
      return {
        connected: !!process.env.GEMINI_API_KEY,
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      };
    case 'azure':
      return {
        connected: !!process.env.AZURE_OPENAI_API_KEY && !!process.env.AZURE_OPENAI_ENDPOINT && !!process.env.AZURE_OPENAI_DEPLOYMENT,
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
        apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-05-01-preview',
      };
    case 'openai_compatible':
      return {
        connected: !!process.env.OPENAI_COMPATIBLE_API_KEY && !!process.env.OPENAI_COMPATIBLE_BASE_URL,
        apiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
        baseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL,
        model: process.env.OPENAI_COMPATIBLE_MODEL || 'gpt-4o-mini',
      };
    case 'anthropic':
      return {
        connected: !!process.env.ANTHROPIC_API_KEY,
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet',
        version: process.env.ANTHROPIC_VERSION || '2023-06-01',
      };
    case 'ollama':
      return {
        connected: !!process.env.OLLAMA_HOST,
        ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
        model: process.env.OLLAMA_MODEL || 'qwen2.5:0.5b',
      };
    default:
      return { connected: false };
  }
}

// Build schema context text for selected tables using database metadata
async function buildSchemaContext(tableNames: string[]): Promise<string> {
  const lines: string[] = [];
  for (const t of tableNames) {
    lines.push(`TABLE ${t}:`);
    try {
      const cols = await getTableSchema(t);
      for (const c of cols) {
        const name = String((c as any).COLUMN_NAME || (c as any).column_name || '').toUpperCase();
        const type = String((c as any).DATA_TYPE || (c as any).data_type || '');
        const nullable = String((c as any).NULLABLE || (c as any).nullable || '').toUpperCase();
        lines.push(`  ${name}: ${type}${nullable === 'N' ? ' NOT NULL' : ''}`);
      }
    } catch (e) {
      lines.push('  <schema unavailable>');
    }
    lines.push('');
  }
  return lines.join('\n');
}

router.post('/generate', async (req, res) => {
  const body = z.object({
    prompt: z.string().min(1),
    llmType: z.enum(['openai','gemini','azure','openai_compatible','anthropic','ollama']),
    tables: z.array(z.string()).min(1),
    full: z.boolean().optional(),
  });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });

  const { prompt, llmType, tables, full } = parsed.data;
  const llmConfig = getLLMConfigFromEnv(llmType);
  if (!llmConfig) return res.status(400).json({ error: 'LLM not configured' });
  if (!llmConfig.connected) return res.status(400).json({ error: 'LLM configured but not connected', code: 'LLMNotConnected' });

  try {
    // Build schema context
    const selected = tables.map(t => t.toUpperCase());
    await schemaStore.refreshSchema();
    const schemaContext = await buildSchemaContext(selected);

    const guidance = [
      'You are a chart generator assistant for an Oracle database.',
      'Use ONLY the provided schema; do not invent tables or columns.',
      'Return EXACTLY two tagged sections: (1) chart metadata JSON, (2) one primary SQL.',
      'For chart metadata, wrap pure JSON inside tags: <chart start>{"type":"bar","title":"...","fields":{"xField":"COLX","yField":"COLY"}}</chart end>',
      'For SQL, wrap the complete statement inside: <sql start>SELECT ... FROM ...</sql end>',
      'Choose chart type based on column types: numeric y → bar/line/area; categorical x → column/bar; pie only for single series.',
      'Use EXTRACT only on DATE/TIMESTAMP columns to avoid ORA-30076. No markdown inside tags.'
    ].join(' ');
    const systemPrompt = `${guidance}\n\nSchema Version: ${schemaStore.getSchemaVersion()}`;
    const userPrompt = `Schema:\n${schemaContext}\n\nUser request:\n${prompt}`;

    let response = '';
    if (llmType === 'openai') {
      const openai = new OpenAI({ apiKey: llmConfig.apiKey });
      const completion = await openai.chat.completions.create({
        model: llmConfig.model || 'gpt-4o-mini',
        messages: [ { role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt } ],
        max_tokens: 800,
        temperature: 0
      });
      response = completion.choices[0].message.content?.trim() || '';
    } else if (llmType === 'gemini') {
      const genAI = new GoogleGenerativeAI(llmConfig.apiKey);
      const model = genAI.getGenerativeModel({ model: llmConfig.model || 'gemini-2.5-flash' });
      const result = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
      response = result.response.text().trim();
    } else if (llmType === 'azure') {
      const url = `${llmConfig.endpoint}/openai/deployments/${llmConfig.deployment}/chat/completions?api-version=${llmConfig.apiVersion || '2024-05-01-preview'}`;
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': llmConfig.apiKey }, body: JSON.stringify({ messages: [ { role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt } ], temperature: 0, max_tokens: 800 }) });
      if (!resp.ok) return res.status(resp.status).send(await resp.text());
      const data = await resp.json();
      response = data?.choices?.[0]?.message?.content?.trim() || '';
    } else if (llmType === 'openai_compatible') {
      const client = new OpenAI({ apiKey: llmConfig.apiKey, baseURL: llmConfig.baseUrl });
      const completion = await client.chat.completions.create({ model: llmConfig.model, messages: [ { role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt } ], max_tokens: 800, temperature: 0 });
      response = completion.choices[0]?.message?.content?.trim() || '';
    } else if (llmType === 'anthropic') {
      const url = 'https://api.anthropic.com/v1/messages';
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': llmConfig.apiKey, 'anthropic-version': llmConfig.version || '2023-06-01' }, body: JSON.stringify({ model: llmConfig.model, system: systemPrompt, max_tokens: 1024, messages: [ { role: 'user', content: userPrompt } ] }) });
      if (!resp.ok) return res.status(resp.status).send(await resp.text());
      const data = await resp.json();
      response = (Array.isArray(data?.content) && data.content[0]?.text ? String(data.content[0].text).trim() : '').trim();
    } else if (llmType === 'ollama') {
      const url = `${llmConfig.ollamaHost}/api/generate`;
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: `${systemPrompt}\n\n${userPrompt}`, model: llmConfig.model, stream: false }) });
      if (!resp.ok) return res.status(resp.status).send(await resp.text());
      const data = await resp.json();
      response = (data?.response || '').trim();
    }

    const meta = extractTaggedChart(response) || {};
    const queries = extractTaggedSQL(response);
    const primarySql = queries[0] || '';
    if (!primarySql) {
      return res.status(400).json({ error: 'No SQL generated' });
    }

    const preIssues = preflightOracleIssues(primarySql);
    if (preIssues.length) {
      return res.status(400).json({ error: 'OracleUnsafeSQL', details: preIssues });
    }

    const sqlToRun = rewriteTopN(primarySql, !!full);
    const rows = await executeQuery(sqlToRun);
    let columns: Array<{ name: string; type?: string }> = [];
    if (rows.length > 0) {
      columns = Object.keys(rows[0]).map(name => ({ name, type: typeof (rows[0] as any)[name] }));
    } else {
      try {
        const metaCols = await getQueryColumns(sqlToRun);
        columns = metaCols.map(c => ({ name: c.name, type: c.type }));
      } catch {
        columns = [];
      }
    }

    let envInfo: any = null;
    try { envInfo = await validateConnection(); } catch {}

    const chart = {
      type: String(meta?.type || 'column'),
      title: String(meta?.title || String(prompt).slice(0, 80) || 'AI Chart'),
      fields: {
        xField: String(meta?.fields?.xField || (columns[0]?.name || '')),
        yField: meta?.fields?.yField ? String(meta.fields.yField) : undefined,
      },
      config: meta?.config || undefined,
    };

    return res.json({
      sqlQuery: primarySql,
      columns,
      rows,
      chart,
      schemaVersion: schemaStore.getSchemaVersion(),
      env: envInfo || undefined
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to generate chart dataset', details: String(err?.message || err) });
  }
});

export default router;