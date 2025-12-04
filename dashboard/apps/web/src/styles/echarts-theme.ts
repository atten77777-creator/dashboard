import * as echarts from 'echarts'

// Register a polished dark theme for charts
const traeAurora = {
  color: ['#60a5fa', '#34d399', '#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#fb7185'],
  backgroundColor: 'transparent',
  textStyle: {
    color: '#e5e7eb',
    fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif',
  },
  title: {
    textStyle: { color: '#f9fafb', fontWeight: '600' },
    subtextStyle: { color: '#cbd5e1' }
  },
  legend: {
    textStyle: { color: '#e5e7eb' },
    itemWidth: 14,
    itemHeight: 8,
    padding: [6, 6, 6, 6]
  },
  tooltip: {
    backgroundColor: 'rgba(2, 6, 23, 0.9)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    textStyle: { color: '#f1f5f9' },
    axisPointer: {
      type: 'cross',
      label: { backgroundColor: 'rgba(15, 23, 42, 0.9)' }
    }
  },
  grid: {
    containLabel: true,
    left: 40,
    right: 24,
    top: 36,
    bottom: 32
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: '#475569' } },
    axisTick: { show: false },
    axisLabel: { color: '#e5e7eb' },
    splitLine: { show: true, lineStyle: { color: '#334155', type: 'dashed' } }
  },
  valueAxis: {
    axisLine: { lineStyle: { color: '#475569' } },
    axisTick: { show: false },
    axisLabel: { color: '#e5e7eb' },
    splitLine: { show: true, lineStyle: { color: '#334155', type: 'dashed' } }
  },
  line: {
    symbolSize: 6,
    lineStyle: { width: 2 },
    itemStyle: { borderWidth: 0 },
    emphasis: { focus: 'series' }
  },
  bar: {
    itemStyle: { borderRadius: [4, 4, 0, 0] },
    emphasis: { focus: 'series' }
  },
  pie: {
    label: { color: '#e5e7eb' }
  },
  radar: {
    axisName: { color: '#e5e7eb' }
  },
}

if (!(echarts as any).themes?.traeAurora) {
  echarts.registerTheme('traeAurora', traeAurora as any)
}

export {}