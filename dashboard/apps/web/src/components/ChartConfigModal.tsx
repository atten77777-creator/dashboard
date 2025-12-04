import React, { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { Button } from './ui/Button'

interface Props {
  isOpen: boolean
  onClose: () => void
  columns: string[]
  defaultX?: string
  defaultY?: string
  defaultType?: 'line' | 'bar' | 'column' | 'scatter' | 'pie'
  onApply: (cfg: { x: string; y: string; type: Props['defaultType'] }) => void
}

export function ChartConfigModal({ isOpen, onClose, columns, defaultX = '', defaultY = '', defaultType = 'line', onApply }: Props) {
  const [x, setX] = useState<string>(defaultX)
  const [y, setY] = useState<string>(defaultY)
  const [type, setType] = useState<Props['defaultType']>(defaultType)

  useEffect(() => {
    if (!isOpen) return
    setX(defaultX)
    setY(defaultY)
    setType(defaultType)
  }, [isOpen, defaultX, defaultY, defaultType])

  const canApply = useMemo(() => !!x && !!y && x !== y, [x, y])

  const onConfirm = () => {
    if (!canApply) return
    onApply({ x, y, type })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Configure Chart" width={520}>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-white/70 mb-1" title="Select X axis from current result columns">X Axis</label>
            <select aria-label="X Axis" value={x} onChange={e => setX(e.target.value)} className="glass w-full rounded-md p-2 text-xs">
              <option value="">Select column</option>
              {columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-white/70 mb-1" title="Select Y axis from current result columns">Y Axis</label>
            <select aria-label="Y Axis" value={y} onChange={e => setY(e.target.value)} className="glass w-full rounded-md p-2 text-xs">
              <option value="">Select column</option>
              {columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-white/70 mb-1" title="Choose chart type">Chart Type</label>
            <select aria-label="Chart Type" value={type} onChange={e => setType(e.target.value as Props['defaultType'])} className="glass w-full rounded-md p-2 text-xs">
              <option value="line">Line</option>
              <option value="column">Column</option>
              <option value="bar">Bar</option>
              <option value="scatter">Scatter</option>
              <option value="pie">Pie</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-xs text-white/60">Tip: Only columns from your current results are available.</div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} title="Cancel">Cancel</Button>
            <Button variant="primary" size="sm" onClick={onConfirm} disabled={!canApply} title={canApply ? 'Apply configuration' : 'Select distinct X and Y columns'}>Apply</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}