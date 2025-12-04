import { performance } from 'perf_hooks';

type Sample = number; // milliseconds

const buckets: Record<string, Sample[]> = {};
const counters: Record<string, number> = {};

const MAX_SAMPLES = Number(process.env.METRICS_SAMPLE_SIZE || 512);
const TARGET_LATENCY_MS = Number(process.env.TARGET_LATENCY_MS || 800);
const TARGET_PERCENT = Number(process.env.TARGET_PERCENT || 95);

export function startTimer(name: string) {
  const start = performance.now();
  return {
    end: () => {
      const dur = performance.now() - start;
      record(name, dur);
      return dur;
    }
  };
}

export function record(name: string, ms: number) {
  const arr = buckets[name] || (buckets[name] = []);
  arr.push(ms);
  if (arr.length > MAX_SAMPLES) arr.shift();
}

export function inc(name: string, by: number = 1) {
  counters[name] = (counters[name] || 0) + by;
}

export function getCounters() {
  return { ...counters };
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

export function summarize(name: string) {
  const arr = buckets[name] || [];
  const sorted = arr.slice().sort((a, b) => a - b);
  const count = arr.length;
  const avg = count ? arr.reduce((s, v) => s + v, 0) / count : 0;
  return {
    name,
    count,
    avg,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    underTargetPct: count ? Math.round((sorted.filter(v => v <= TARGET_LATENCY_MS).length / count) * 100) : 0
  };
}

export function getSummary() {
  const names = Object.keys(buckets);
  const latencies = names.map(summarize);
  return {
    target: { ms: TARGET_LATENCY_MS, percent: TARGET_PERCENT },
    latencies,
    counters: getCounters()
  };
}