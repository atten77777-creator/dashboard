import { Router } from 'express';

const router = Router();

const sampleDashboards = [
  { id: 'demo', name: 'Demo Dashboard', description: 'Example dashboard', createdAt: new Date().toISOString() }
];

router.get('/', (_req, res) => {
  res.json(sampleDashboards);
});

router.get('/:dashboardId', (req, res) => {
  const d = sampleDashboards.find(x => x.id === req.params.dashboardId);
  if (!d) return res.status(404).json({ error: 'Dashboard not found' });
  res.json(d);
});

export default router;
