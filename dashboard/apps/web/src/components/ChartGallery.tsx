import React from 'react'
import { Card } from './ui/Card'

type ChartKind = {
  id: string
  label: string
  desc: string
  preview: React.ReactNode
  supported: boolean
}

const PreviewSpark = ({ color = '#22d3ee' }: { color?: string }) => (
  <svg viewBox="0 0 120 50" className="w-full h-16">
    <polyline fill="none" stroke={color} strokeWidth="2" points="0,40 20,35 40,42 60,28 80,32 100,20 120,18" />
  </svg>
)

const PreviewBars = ({ color = '#60a5fa' }: { color?: string }) => (
  <div className="flex items-end gap-1 h-16">
    {[10, 24, 14, 32, 20, 28].map((h, i) => (
      <div key={i} className="flex-1 bg-white/20 rounded" style={{ height: h }}>
        <div className="rounded" style={{ backgroundColor: color, height: '100%' }} />
      </div>
    ))}
  </div>
)

const CHARTS: ChartKind[] = [
  { id: 'line', label: 'Line Chart', desc: 'Trends over time', preview: <PreviewSpark />, supported: true },
  { id: 'area', label: 'Area Chart', desc: 'Filled trend', preview: <PreviewSpark color="#34d399" />, supported: true },
  { id: 'bar', label: 'Bar Chart', desc: 'Horizontal bars', preview: <PreviewBars />, supported: true },
  { id: 'column', label: 'Column Chart', desc: 'Vertical bars', preview: <PreviewBars color="#f59e0b" />, supported: true },
  { id: 'stackedBar', label: 'Stacked Bar', desc: 'Parts of whole', preview: <PreviewBars color="#a78bfa" />, supported: true },
  { id: 'stackedArea', label: 'Stacked Area', desc: 'Parts of whole', preview: <PreviewSpark color="#f472b6" />, supported: true },
  { id: 'pie', label: 'Pie Chart', desc: 'Composition', preview: <div className="h-16 w-16 rounded-full bg-gradient-to-br from-pink-400 to-yellow-400 mx-auto" />, supported: true },
  { id: 'donut', label: 'Donut Chart', desc: 'Ring composition', preview: <div className="h-16 w-16 rounded-full mx-auto" style={{ boxShadow: 'inset 0 0 0 10px #f472b6, inset 0 0 0 20px #22d3ee' }} /> , supported: true },
  { id: 'scatter', label: 'Scatter Plot', desc: 'Correlation', preview: <div className="h-16 relative">{Array.from({length:12}).map((_,i)=>(<div key={i} className="absolute w-1.5 h-1.5 rounded-full bg-cyan-400" style={{ left: `${i*8}%`, top: `${50 - i * 3}%` }} />))}</div>, supported: true },
  { id: 'heatmap', label: 'Heatmap', desc: 'Density grid', preview: <div className="grid grid-cols-6 gap-0.5 h-16">{Array.from({length:24}).map((_,i)=>(<div key={i} className="rounded" style={{ backgroundColor: `rgba(99,102,241,${0.2 + (i%6)/10})` }} />))}</div>, supported: true },
  { id: 'gauge', label: 'Gauge Chart', desc: 'Single KPI', preview: <div className="h-16 w-28 mx-auto rounded-b-full border-2 border-white/20 relative"><div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-8 bg-cyan-400" /></div>, supported: true },
  { id: 'number', label: 'KPI Number', desc: 'Total value', preview: <div className="text-2xl font-bold text-cyan-300 text-center">42,310</div>, supported: true },
  { id: 'histogram', label: 'Histogram', desc: 'Distribution', preview: <PreviewBars color="#fb7185" />, supported: true },
]

export function ChartGallery({ onSelect }: { onSelect: (id: string) => void }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-semibold">Chart Gallery</div>
          <div className="text-xs text-white/60">Pick a chart to start configuring</div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {CHARTS.map((c) => (
          <button
            key={c.id}
            className={`text-left rounded-xl glass p-3 hover:ring-2 hover:ring-cyan-400 transition ${c.supported ? '' : 'opacity-60 cursor-not-allowed'}`}
            onClick={() => c.supported && onSelect(c.id)}
            title={c.supported ? c.desc : `${c.desc} (coming soon)`}
          >
            <div className="h-20 mb-2">{c.preview}</div>
            <div className="font-medium text-white/90">{c.label}</div>
            <div className="text-xs text-white/60">{c.desc}</div>
          </button>
        ))}
      </div>
    </div>
  )
}