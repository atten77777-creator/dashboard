import React, { useState } from 'react'
import { Modal } from './Modal'

interface Props {
  isOpen: boolean
  sql: string
  chartTitle?: string
  onClose: () => void
  onSave: (newSQL: string) => Promise<void>
}

export default function SQLEditModal({ isOpen, sql, chartTitle, onClose, onSave }: Props) {
  const [text, setText] = useState<string>(sql || '')
  const [saving, setSaving] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = (text || '').trim().length > 5

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true); setError(null)
    try {
      await onSave(text)
    } catch (e: any) {
      setError(e?.message || 'Failed to update SQL')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Edit SQL${chartTitle ? ` — ${chartTitle}` : ''}`} width={860}>
      <div className="flex flex-col gap-2">
        <div className="text-white/70 text-xs">
          Edit the SQL query for this chart. You can change clauses like <code>WHERE</code>, <code>ORDER BY</code>, and <code>GROUP BY</code>, then save to re-run and refresh the dashboard.
        </div>
        <textarea
          className="glass rounded-md w-full font-mono text-xs p-2 min-h-[260px]"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={"SELECT x AS x, SUM(y) AS y\nFROM your_table\nWHERE ...\nGROUP BY x\nORDER BY y DESC\nFETCH FIRST 100 ROWS ONLY"}
        />
        {error && <div className="text-red-400 text-xs">{error}</div>}
        <div className="flex items-center justify-end gap-2 mt-1">
          <button className="btn btn-ghost text-xs" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary text-xs" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Saving…' : 'Save & Refresh'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
