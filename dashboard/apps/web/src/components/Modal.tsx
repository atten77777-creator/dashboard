import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function Modal({ isOpen, onClose, title, children, width = 520, minWidth, minHeight, height }: {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: number
  minWidth?: number
  minHeight?: number
  height?: number
}) {
  const [drag, setDrag] = useState<{ x: number, y: number }>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const startRef = useRef<{ startX: number, startY: number, origX: number, origY: number } | null>(null)

  const onHeaderMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target && target.tagName.toLowerCase() === 'button') return
    startRef.current = { startX: e.clientX, startY: e.clientY, origX: drag.x, origY: drag.y }
    setDragging(true)
  }

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const s = startRef.current
      if (!s) return
      setDrag({ x: s.origX + (e.clientX - s.startX), y: s.origY + (e.clientY - s.startY) })
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (isOpen) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null
  const overlay = (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="glass rounded-xl p-6 shadow-2xl border border-white/10 max-h-[85vh] max-w-[95vw] overflow-hidden flex flex-col" style={{ width, minWidth, height, minHeight, transform: `translate(${drag.x}px, ${drag.y}px)` }}>
          <div className="flex items-center justify-between mb-3 cursor-move select-none" onMouseDown={onHeaderMouseDown}>
            <h3 className="text-lg font-semibold">{title}</h3>
            <button className="btn-icon" onClick={onClose} title="Close" aria-label="Close">×</button>
          </div>
          <div className="overflow-y-auto pr-1">{children}</div>
        </div>
      </div>
    </div>
  )
  return createPortal(overlay, document.body)
}
