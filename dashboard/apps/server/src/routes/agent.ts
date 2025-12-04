import { Router } from 'express';
import { z } from 'zod';
import { Store } from '../lib/store';
import { recommendChartsForTables } from '../lib/viz-recommender';

const router = Router();

router.post('/generate-dashboard', async (req, res) => {
  const body = z.object({
    selectedTables: z.array(z.string()).min(1),
    userPrompt: z.string().min(1),
    llmType: z.string().optional(),
  });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Missing parameters', issues: parsed.error.issues });

  const gen = Store.createGeneration({ status: 'processing', progress: 5 });
  try {
    const { selectedTables, userPrompt, llmType } = parsed.data;
    const results = await recommendChartsForTables(selectedTables, userPrompt, llmType);
    Store.updateGeneration(gen.id, { progress: 100, status: 'completed', results });
    return res.status(202).json({ generationId: gen.id });
  } catch (err: any) {
    Store.updateGeneration(gen.id, { status: 'failed', error: String(err?.message || err) });
    return res.status(500).json({ error: 'Failed to generate dashboard', details: String(err?.message || err) });
  }
});

router.get('/generation-status/:generationId', (req, res) => {
  const g = Store.getGeneration(req.params.generationId);
  if (!g) return res.status(404).json({ error: 'GenerationID not found' });
  res.json({ status: g.status, progress: g.progress, results: g.results, error: g.error });
});

router.post('/confirm-dashboard', (req, res) => {
  const body = z.object({ generationId: z.string(), confirmedCharts: z.array(z.any()).optional() });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Bad Request', issues: parsed.error.issues });
  const g = Store.getGeneration(parsed.data.generationId);
  if (!g || g.status !== 'completed' || !g.results) return res.status(404).json({ error: 'Generation not available' });

  const results: any = g.results as any;
  const name = results.dashboardName ?? 'AI Dashboard';
  const desc = results.dashboardDescription ?? '';
  const d = Store.createDashboard(name, desc, 'manual');

  const charts = (parsed.data.confirmedCharts ?? results.chartDefinitions) as any[];
  charts.forEach(cd => {
    // Normalize config for charts endpoint
    const normalizedConfig: any = {
      table: cd.table,
      xField: cd.xField,
      yField: cd.yField,
      y2Field: cd.y2Field,
      aggregation: cd.aggregation,
      groupBy: cd.groupBy,
      sort: cd.sort,
      limit: cd.limit ?? 1000,
    };
    // Create chart in dashboard
    Store.createChart(d.id, {
      dashboardId: d.id,
      type: cd.chartType,
      name: cd.chartName,
      config: normalizedConfig,
      position: { x: 0, y: 0, w: 6, h: 6 },
    });
  });
  res.status(201).json(d);
});

export default router;
