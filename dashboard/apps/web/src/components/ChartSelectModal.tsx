import React from 'react'
import { Modal } from './Modal'
import { ChartGallery } from './ChartGallery'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSelect?: (id: string) => void
}

export function ChartSelectModal({ isOpen, onClose, onSelect }: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Select Chart Type" width={820}>
      <ChartGallery onSelect={(id) => {
        if (onSelect) {
          onSelect(id)
        } else {
          try {
            window.dispatchEvent(new CustomEvent('open-chart-modal', { detail: { type: id, title: 'Untitled Chart' } }))
          } catch {}
        }
        onClose()
      }} />
    </Modal>
  )
}

export default ChartSelectModal