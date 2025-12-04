import { Router } from 'express';

const router = Router();

const mockTables = [
  { owner: 'SMARTERP', name: 'DEMO_SALES', rows: 12345 },
  { owner: 'SMARTERP', name: 'DUAL', rows: 1 }
];

const mockColumns: Record<string, Array<{ name: string; type: string; nullable: boolean }>> = {
  DEMO_SALES: [
    { name: 'ID', type: 'NUMBER', nullable: false },
    { name: 'REGION', type: 'VARCHAR2', nullable: false },
    { name: 'SALES', type: 'NUMBER', nullable: false }
  ],
  DUAL: [
    { name: 'DUMMY', type: 'VARCHAR2', nullable: true }
  ]
};

router.get('/tables', (_req, res) => {
  res.json({ tables: mockTables });
});

router.get('/tables/:table/columns', (req, res) => {
  const t = String(req.params.table || '').toUpperCase();
  const cols = mockColumns[t] || [];
  res.json({ table: t, columns: cols });
});

export default router;