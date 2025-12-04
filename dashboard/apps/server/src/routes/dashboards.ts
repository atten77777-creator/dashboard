import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Store } from '../lib/store';
import type { RefreshRule } from '../types';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  try {
    const dashboards = Store.listDashboards();
    res.json(dashboards);
  } catch (e) {
    res.status(500).json({ error: 'Database connection issue', details: String(e) });
  }
});

const createDashboardSchema = z.object({
  name: z.string().min(1, 'name is required'),
  description: z.string().optional(),
  refreshRule: z.enum(['1min', '5min', '15min', '30min', '1hour', 'manual']).default('manual'),
});

router.post('/', (req: Request, res: Response) => {
  const parsed = createDashboardSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Missing name', issues: parsed.error.issues });
  try {
    const { name, description, refreshRule } = parsed.data;
    const d = Store.createDashboard(name, description, refreshRule as RefreshRule);
    res.status(201).json(d);
  } catch (e) {
    res.status(500).json({ error: 'Creation failed', details: String(e) });
  }
});

router.get('/:dashboardId', (req: Request<{ dashboardId: string }>, res: Response) => {
  try {
    const d = Store.getDashboard(req.params.dashboardId);
    if (!d) return res.status(404).json({ error: 'Not Found' });
    res.json(d);
  } catch (e) {
    res.status(500).json({ error: 'Database error', details: String(e) });
  }
});

const updateDashboardSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  refreshRule: z.enum(['1min', '5min', '15min', '30min', '1hour', 'manual']).optional(),
});

router.put('/:dashboardId', (req: Request<{ dashboardId: string }>, res: Response) => {
  const parsed = updateDashboardSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Bad Request', issues: parsed.error.issues });
  const d = Store.updateDashboard(req.params.dashboardId, parsed.data);
  if (!d) return res.status(404).json({ error: 'Not Found' });
  res.json(d);
});

router.delete('/:dashboardId', (req: Request<{ dashboardId: string }>, res: Response) => {
  const ok = Store.deleteDashboard(req.params.dashboardId);
  if (!ok) return res.status(404).json({ error: 'Not Found' });
  res.status(204).send();
});

export default router;
