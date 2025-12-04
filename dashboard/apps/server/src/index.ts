import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDb, closeDb, validateConnection } from './lib/db';
import { schemaStore } from './lib/schema-store';
import { loadState, initAppStateStore } from './lib/app-state';
import { initStore } from './lib/store';
import dashboardsRouter from './routes/dashboards';
import chartsRouter from './routes/charts';
import dataRouter from './routes/data';
import chatRouter from './routes/chat';
import agentRouter from './routes/agent';
import queryRouter from './routes/query.base';
import { createStateRouter } from './routes/state';
import chatHistoryRouter from './routes/chat-history';
import { initConvDb, closeConvDb, startRetentionWorker, isConvDbEnabled, startBackupWorker } from './lib/conv-db';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173';

// Allow dev and preview origins flexibly to avoid CORS issues
app.use(cors({ origin: (origin, cb) => cb(null, true) }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));
// Deep DB health with NLS/session info for diagnosing environment discrepancies
app.get('/health/db', async (_req, res) => {
  try {
    const info = await validateConnection();
    res.json({ ok: true, info });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.use('/api/dashboards', dashboardsRouter);
app.use('/api/dashboards/:dashboardId/charts', chartsRouter);
app.use('/api/data', dataRouter);
app.use('/api/chat', chatRouter);
app.use('/api/agent', agentRouter);
app.use('/api/query', queryRouter);
app.use('/api/state', createStateRouter(schemaStore));
app.use('/api/chat-history', chatHistoryRouter);

// Error handler fallback
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err?.status || 500;
  const msg = err?.message || 'Internal Server Error';
  console.error('API error:', msg, '\nDetails:', err);
  res.status(status).json({ error: msg });
});

// Initialize database before starting server
const dbInits = [initDb()];
if (isConvDbEnabled()) dbInits.push(initConvDb());
Promise.all(dbInits).then(async () => {
  // Initialize store with seeded data (safe now that DB is ready)
  initStore();

  // Pre-warm schema cache to improve first-request latency
  try {
    await schemaStore.refreshSchema();
    console.log(`Schema cache warmed with ${schemaStore.getAllTables().length} tables`);
  } catch (e) {
    console.warn('Schema cache warmup failed:', e);
  }

  // Initialize app-state storage and restore persisted settings
  try {
    await initAppStateStore();
    const sel = await loadState<{ tables: string[] }>('selectedTables');
    if (sel?.tables && sel.tables.length) {
      schemaStore.setSelectedTables(sel.tables);
      console.log(`Restored ${sel.tables.length} selected tables from persistence`);
    }
    const llms = await loadState<any>('llmConfigs');
    if (llms && typeof llms === 'object') {
      for (const [type, cfg] of Object.entries(llms)) {
        if (cfg) schemaStore.setLLMConfig(type, cfg);
      }
      console.log(`Restored LLM configs for types: ${Object.keys(llms).join(', ')}`);
    }
  } catch (e) {
    console.warn('State restoration failed:', e);
  }

  // Start conversation retention worker (if CONV_RETENTION_DAYS > 0)
  try {
    if (isConvDbEnabled()) {
      startRetentionWorker();
      startBackupWorker();
    }
  } catch (e) { console.warn('Workers failed to start:', e); }

  app.listen(PORT, () => {
    console.log(`SmartAnalytics API listening on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Closing database connections...');
  await closeDb();
  await closeConvDb();
  process.exit(0);
});