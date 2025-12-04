// Web worker for heavy data typing, null handling, normalization, and sampling
// Message API:
// in: { rows, schema?: { [field: string]: 'date'|'number'|'string'|'category' }, sampleSize?: number }
// out: { rows, fieldsMeta }

type SchemaHint = 'date' | 'number' | 'string' | 'category';
type MessageIn = {
  rows: any[];
  schema?: Record<string, SchemaHint>;
  sampleSize?: number;
};

type FieldMeta = {
  name: string;
  type: SchemaHint;
  nulls: number;
};

type MessageOut = {
  rows: any[];
  fieldsMeta: FieldMeta[];
};

function parseDate(v: any) {
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function normalize(rows: any[], schema?: Record<string, SchemaHint>): { rows: any[]; fieldsMeta: FieldMeta[] } {
  if (!Array.isArray(rows) || rows.length === 0) return { rows: [], fieldsMeta: [] };
  const keys = Object.keys(rows[0] ?? {});
  const fieldsMeta: FieldMeta[] = keys.map(k => ({ name: k, type: schema?.[k] ?? 'string', nulls: 0 }));
  const out = rows.map(r => {
    const o: any = {};
    for (const k of keys) {
      const hint = schema?.[k];
      let v = r[k];
      if (v === undefined || v === null) {
        const meta = fieldsMeta.find(f => f.name === k)!;
        meta.nulls++;
        o[k] = null;
        continue;
      }
      switch (hint) {
        case 'date': {
          const d = parseDate(v);
          o[k] = d;
          break;
        }
        case 'number':
          o[k] = typeof v === 'number' ? v : Number(v);
          break;
        case 'category':
          o[k] = String(v);
          break;
        default:
          o[k] = typeof v === 'string' ? v : String(v);
      }
    }
    return o;
  });
  return { rows: out, fieldsMeta };
}

self.onmessage = (ev: MessageEvent<MessageIn>) => {
  const { rows, schema, sampleSize } = ev.data;
  let working = rows ?? [];
  if (typeof sampleSize === 'number' && sampleSize > 0 && working.length > sampleSize) {
    working = working.slice(0, sampleSize);
  }
  const { rows: outRows, fieldsMeta } = normalize(working, schema);
  const message: MessageOut = { rows: outRows, fieldsMeta };
  // @ts-ignore
  self.postMessage(message);
};