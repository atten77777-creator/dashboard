import React, { useState, useEffect } from 'react'
import { Modal } from './Modal'
import { useApp } from '../context/AppContext'
import type { RefreshRule } from '../api'

const refreshOptions: RefreshRule[] = ['1min','5min','15min','30min','1hour','manual']

export function AddEditDashboardModal() {
  const { isDashboardModalOpen, closeDashboardModal, editingDashboard, createDashboard, updateDashboard, deleteDashboard } = useApp()
  const [name, setName] = useState(editingDashboard?.name ?? '')
  const [description, setDescription] = useState(editingDashboard?.description ?? '')
  const [refreshRule, setRefreshRule] = useState<RefreshRule>(editingDashboard?.refreshRule ?? 'manual')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (isDashboardModalOpen) {
      setName(editingDashboard?.name ?? '')
      setDescription(editingDashboard?.description ?? '')
      setRefreshRule(editingDashboard?.refreshRule ?? 'manual')
      setError('')
      setConfirmDeleteOpen(false)
    }
  }, [isDashboardModalOpen, editingDashboard])


  const onConfirm = async () => {
    if (!name.trim()) { setError('Dashboard name is required'); return }
    setSubmitting(true)
    setError('')
    try {
      if (editingDashboard) {
        await updateDashboard(editingDashboard.id, { name: name.trim(), description: description.trim() || undefined, refreshRule })
      } else {
        await createDashboard(name.trim(), description.trim() || undefined, refreshRule)
      }
    } catch (e: any) {
      setError(e?.message || (editingDashboard ? 'Failed to update dashboard' : 'Failed to create dashboard'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Modal isOpen={isDashboardModalOpen} onClose={closeDashboardModal} title={editingDashboard ? 'Dashboard Settings' : 'Add Dashboard'}>
        <div className="space-y-4">
        <label className="block">
          <div className="mb-1 text-sm">Name</div>
          <input
            value={name}
            onChange={e=>setName(e.target.value)}
            className={`w-full glass p-2 rounded-md focus:ring-2 focus:ring-indigo-400 ${error ? 'animate-[shake_0.2s_ease-in-out_2]' : ''}`}
            placeholder="Dashboard name"
          />
        </label>
        <label className="block">
          <div className="mb-1 text-sm">Description</div>
          <textarea
            value={description}
            onChange={e=>setDescription(e.target.value)}
            className="w-full glass p-2 rounded-md focus:ring-2 focus:ring-indigo-400"
            placeholder="Optional description"
            rows={3}
          />
        </label>
        <label className="block">
          <div className="mb-1 text-sm">Refresh Rule</div>
          <select
            value={refreshRule}
            onChange={e=>setRefreshRule(e.target.value as RefreshRule)}
            className="w-full glass p-2 rounded-md focus:ring-2 focus:ring-indigo-400"
          >
            {refreshOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </label>
        {error && <div className="text-red-300 text-sm">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          {editingDashboard && (
            <button className="btn bg-red-600 hover:bg-red-700" onClick={() => setConfirmDeleteOpen(true)} disabled={submitting}>Delete</button>
          )}
          <button className="btn" onClick={onConfirm} disabled={submitting}>{submitting ? (editingDashboard ? 'Saving…' : 'Creating…') : (editingDashboard ? 'Save' : 'Create')}</button>
          <button className="btn" onClick={closeDashboardModal} disabled={submitting}>Cancel</button>
        </div>
      </div>
      </Modal>

      {editingDashboard && (
        <Modal isOpen={confirmDeleteOpen} onClose={() => setConfirmDeleteOpen(false)} title="Confirm Delete" width={420}>
          <div className="space-y-4">
            <div className="text-white/80">Delete dashboard "{editingDashboard.name}"? This cannot be undone.</div>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setConfirmDeleteOpen(false)} disabled={deleting}>Cancel</button>
              <button className="btn bg-red-600 hover:bg-red-700" onClick={async () => {
                setDeleting(true)
                try {
                  await deleteDashboard(editingDashboard.id)
                  setConfirmDeleteOpen(false)
                } finally {
                  setDeleting(false)
                }
              }} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
