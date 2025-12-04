import { Router } from 'express';

// Dev-only data router: avoids Oracle and returns mock schema
const router = Router();

// List user tables (mock)
router.get('/tables', (_req, res) => {
  const tables = [
    { TABLE_NAME: 'DEMO_SALES' },
    { TABLE_NAME: 'DUAL' },
  ];
  res.json({ tables });
});

// Columns for a table (mock)
router.get('/tables/:table/columns', (req, res) => {
  const table = String(req.params.table || '').toUpperCase();
  let columns: Array<{ COLUMN_NAME: string; DATA_TYPE: string }>; 
  if (table === 'DEMO_SALES') {
    columns = [
      { COLUMN_NAME: 'REGION', DATA_TYPE: 'VARCHAR2' },
      { COLUMN_NAME: 'PRODUCT', DATA_TYPE: 'VARCHAR2' },
      { COLUMN_NAME: 'SALES', DATA_TYPE: 'NUMBER' },
      { COLUMN_NAME: 'SALE_DATE', DATA_TYPE: 'DATE' },
    ];
  } else if (table === 'DUAL') {
    columns = [ { COLUMN_NAME: 'DUMMY', DATA_TYPE: 'VARCHAR2' } ];
  } else {
    columns = [ { COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER' } ];
  }
  res.json({ columns });
});

export default router;