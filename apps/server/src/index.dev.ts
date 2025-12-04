import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import chatHistoryRouter from './routes/chat-history';

import dashboardsRouter from './routes/dashboards';
import chartsRouter from './routes/charts';
import dataRouter from './routes/data';
import chatRouter from './routes/chat';
import agentRouter from './routes/agent';
import queryRouter from './routes/query';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
// Lazy-import chart generation router to avoid patching import block
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chartGenRouter = require('./routes/chart.generate').default;

// Dev-only helper: detect whether conversation DB is enabled via env vars
function isConvDbEnabled(): boolean {
  return !!(process.env.CONV_DB_SQLITE_PATH || process.env.CONV_DB_URL || process.env.CONV_DB_MONGO_URL);
}

// Allow any origin in dev to avoid CORS headaches
app.use(cors({ origin: (_origin, cb) => cb(null, true) }));
app.use(express.json({ limit: '1mb' }));

// Basic health
app.get('/health', (_req, res) => res.json({ ok: true, mode: 'dev', noDb: true }));

// Dev DB health endpoint that clearly indicates degraded mode
app.get('/health/db', async (_req, res) => {
  res.status(200).json({ ok: false, error: 'Database disabled in dev entrypoint (index.dev.ts)' });
});

// Mount API routers; handlers may return errors if they require DB
app.use('/api/dashboards', dashboardsRouter);
app.use('/api/dashboards/:dashboardId/charts', chartsRouter);
app.use('/api/data', dataRouter);
app.use('/api/chat', chatRouter);
app.use('/api/chat-history', chatHistoryRouter);
app.use('/api/agent', agentRouter);
app.use('/api/query', queryRouter);
// Debug endpoint for conversation storage enablement
app.get('/health/conv', (_req, res) => {
  res.json({
    enabled: isConvDbEnabled(),
    sqlite: !!process.env.CONV_DB_SQLITE_PATH,
    mongo: !!process.env.CONV_DB_MONGO_URL,
    pg: !!process.env.CONV_DB_URL
  });
});
app.use('/api/chart', chartGenRouter);

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err?.status || 500;
  const msg = err?.message || 'Internal Server Error';
  console.error('API error:', msg, '\nDetails:', err);
  res.status(status).json({ error: msg });
});

app.listen(PORT, () => {
  console.log(`SmartAnalytics (dev) listening on http://localhost:${PORT}`);
});