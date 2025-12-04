import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDb, closeDb, validateConnection } from './lib/db';
import { schemaStore } from './lib/schema-store';
import dashboardsRouter from './routes/dashboards';
import chartsRouter from './routes/charts';
import dataRouter from './routes/data';
import chatRouter from './routes/chat';
import agentRouter from './routes/agent';
import queryRouter from './routes/query';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173';
const ALLOW_NO_DB = String(process.env.ALLOW_NO_DB || '').toLowerCase() === 'true';

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

// Error handler fallback
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err?.status || 500;
  const msg = err?.message || 'Internal Server Error';
  console.error('API error:', msg, '\nDetails:', err);
  res.status(status).json({ error: msg });
});

// Initialize database before starting server
initDb().then(async () => {
  // Pre-warm schema cache to improve first-request latency
  try {
    await schemaStore.refreshSchema();
    console.log(`Schema cache warmed with ${schemaStore.getAllTables().length} tables`);
  } catch (e) {
    console.warn('Schema cache warmup failed:', e);
  }

  app.listen(PORT, () => {
    console.log(`SmartAnalytics API listening on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  if (!ALLOW_NO_DB) {
    process.exit(1);
  } else {
    console.warn('ALLOW_NO_DB=true; starting server without database connectivity.');
    app.listen(PORT, () => {
      console.log(`SmartAnalytics API listening on http://localhost:${PORT}`);
      console.log('Running in degraded mode: database-dependent endpoints will return 500 errors until configured.');
    });
  }
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Closing database connections...');
  await closeDb();
  process.exit(0);
});
