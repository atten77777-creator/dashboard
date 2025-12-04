import { Router, Request, Response } from 'express';

const router = Router({ mergeParams: true });

const sampleCharts = [
  { id: 'c1', type: 'bar', title: 'Sales by Region' },
  { id: 'c2', type: 'line', title: 'Revenue Over Time' }
];

router.get('/', (_req: Request<{ dashboardId: string }>, res: Response) => {
  res.json(sampleCharts);
});

router.get('/:chartId', (req: Request<{ dashboardId: string; chartId: string }>, res: Response) => {
  const c = sampleCharts.find(x => x.id === req.params.chartId);
  if (!c) return res.status(404).json({ error: 'Chart not found' });
  res.json(c);
});

export default router;
