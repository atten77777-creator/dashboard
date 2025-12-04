import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api, ensureApiBase, type Dashboard, type RefreshRule } from '../api'

interface AppState {
  dashboards: Dashboard[]
  activeDashboardId?: string
  isDashboardModalOpen: boolean
  editingDashboard?: Dashboard
  isChatOpen: boolean
  // actions
  loadDashboards: () => Promise<void>
  openDashboardModal: (d?: Dashboard) => void
  closeDashboardModal: () => void
  selectDashboard: (id: string) => void
  createDashboard: (name: string, description?: string, refreshRule?: RefreshRule) => Promise<void>
  updateDashboard: (id: string, payload: { name?: string; description?: string; refreshRule?: RefreshRule }) => Promise<void>
  deleteDashboard: (id: string) => Promise<void>
  openChat: () => void
  closeChat: () => void
}

const Ctx = createContext<AppState | undefined>(undefined)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [dashboards, setDashboards] = useState<Dashboard[]>([])
  const [activeDashboardId, setActiveDashboardId] = useState<string | undefined>(undefined)
  const [isDashboardModalOpen, setIsDashboardModalOpen] = useState(false)
  const [editingDashboard, setEditingDashboard] = useState<Dashboard | undefined>(undefined)
  const [isChatOpen, setIsChatOpen] = useState(false)

  const loadDashboards = async () => {
    const data = await api.getDashboards()
    setDashboards(data)
    if (!activeDashboardId && data.length) setActiveDashboardId(data[0].id)
  }

  useEffect(() => {
    // Resolve API base first to avoid aborted requests against the wrong port
    void (async () => {
      try {
        await ensureApiBase()
      } catch {}
      await loadDashboards()
    })()
  }, [])

  const openDashboardModal = (d?: Dashboard) => { setEditingDashboard(d); setIsDashboardModalOpen(true) }
  const closeDashboardModal = () => { setEditingDashboard(undefined); setIsDashboardModalOpen(false) }
  const selectDashboard = (id: string) => setActiveDashboardId(id)
  const openChat = () => setIsChatOpen(true)
  const closeChat = () => setIsChatOpen(false)

  const createDashboard = async (name: string, description?: string, refreshRule: RefreshRule = 'manual') => {
    const newD = await api.createDashboard({ name, description, refreshRule })
    setDashboards(prev => [newD, ...prev])
    setActiveDashboardId(newD.id)
    closeDashboardModal()
  }

  const updateDashboard = async (id: string, payload: { name?: string; description?: string; refreshRule?: RefreshRule }) => {
    const updated = await api.updateDashboard(id, payload)
    setDashboards(prev => prev.map(d => d.id === id ? updated : d))
    closeDashboardModal()
  }

  const deleteDashboard = async (id: string) => {
    await api.deleteDashboard(id)
    setDashboards(prev => prev.filter(d => d.id !== id))
    setActiveDashboardId(prev => (prev === id ? (dashboards.filter(d => d.id !== id)[0]?.id) : prev))
    closeDashboardModal()
  }

  const value = useMemo<AppState>(() => ({
    dashboards,
    activeDashboardId,
    isDashboardModalOpen,
    editingDashboard,
    isChatOpen,
    loadDashboards,
    openDashboardModal,
    closeDashboardModal,
    selectDashboard,
    createDashboard,
    updateDashboard,
    deleteDashboard,
    openChat,
    closeChat,
  }), [dashboards, activeDashboardId, isDashboardModalOpen, editingDashboard, isChatOpen])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
