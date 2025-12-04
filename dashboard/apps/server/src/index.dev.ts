import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { initDb, validateConnection } from './lib/db';
import { schemaStore } from './lib/schema-store';

import dashboardsRouter from './routes/dashboards';
import chartsRouter from './routes/charts';
// Use REAL data router in dev to remove mock schema
import dataRouter from './routes/data';
import chatRouter from './routes/chat';
import agentRouter from './routes/agent';
import queryRouter from './routes/query.base';
import { createStateRouter } from './routes/state';
import chatHistoryRouter from './routes/chat-history';
import { initConvDb, startRetentionWorker, isConvDbEnabled, startBackupWorker } from './lib/conv-db';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// Allow any origin in dev to avoid CORS headaches
app.use(cors({ origin: (_origin, cb) => cb(null, true) }));
app.use(express.json({ limit: '1mb' }));

// Basic health (dev mode, but DB enabled)
app.get('/health', (_req, res) => res.json({ ok: true, mode: 'dev', noDb: false }));

// Live DB health endpoint
app.get('/health/db', async (_req, res) => {
  try {
    const info = await validateConnection();
    res.json({ ok: true, info, mode: 'dev' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err), mode: 'dev' });
  }
});

// Mount API routers
app.use('/api/dashboards', dashboardsRouter);
app.use('/api/dashboards/:dashboardId/charts', chartsRouter);
app.use('/api/data', dataRouter);
app.use('/api/chat', chatRouter);
app.use('/api/agent', agentRouter);
app.use('/api/query', queryRouter);
app.use('/api/chat-history', chatHistoryRouter);

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err?.status || 500;
  const msg = err?.message || 'Internal Server Error';
  console.error('API error:', msg, '\nDetails:', err);
  res.status(status).json({ error: msg });
});

// Initialize database before starting server (tolerate failures in dev)
const dbInits = [initDb()];
if (isConvDbEnabled()) dbInits.push(initConvDb());
Promise.allSettled(dbInits).then(async (results) => {
  const dbOk = results[0]?.status === 'fulfilled';
  if (!dbOk) {
    console.warn('Oracle DB initialization failed in dev. Continuing without DB.');
  }
  // Pre-warm schema cache to improve first-request latency
  try {
    if (dbOk) {
      await schemaStore.refreshSchema();
      console.log(`Schema cache warmed with ${schemaStore.getAllTables().length} tables`);
    } else {
      console.log('Skipping schema warmup due to missing DB (dev mode).');
    }
  } catch (e) {
    console.warn('Schema cache warmup failed:', e);
  }

  try {
    if (isConvDbEnabled()) {
      startRetentionWorker();
      startBackupWorker();
    }
  } catch (e) { console.warn('Workers failed to start (dev):', e); }

  // Mount state router after initialization
  app.use('/api/state', createStateRouter(schemaStore));

  function startServer(port: number, attemptsLeft = 10) {
    const server = app.listen(port, () => {
      console.log(`SmartAnalytics (dev) listening on http://localhost:${port}${dbOk ? '' : ' (no DB)'}`);
    });
    server.on('error', (err: any) => {
      if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        const nextPort = port + 1;
        console.warn(`Port ${port} is in use. Retrying on ${nextPort}...`);
        startServer(nextPort, attemptsLeft - 1);
      } else {
        console.error('Failed to bind port:', err);
        process.exit(1);
      }
    });
  }

  startServer(PORT);
});