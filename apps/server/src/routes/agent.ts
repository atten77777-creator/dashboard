import { Router } from 'express';

const router = Router();

router.post('/ask', async (_req, res) => {
  res.json({ answer: 'Agent stub: disabled in this environment.' });
});

export default router;