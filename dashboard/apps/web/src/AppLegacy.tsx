import React, { useEffect, useRef, useState } from 'react';
import { FiBarChart2, FiRefreshCw, FiSettings, FiMaximize, FiMessageSquare, FiDatabase } from 'react-icons/fi'
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/Sidebar';
import { AddEditDashboardModal } from './components/AddEditDashboardModal';
import { ChatSidebar } from './components/ChatSidebar';
import { ChartContainer } from './components/ChartContainer';
import { SQLRunnerModal } from './components/SQLRunnerModal';
import { ChartGallery } from './components/ChartGallery';
import { ChartSelectModal } from './components/ChartSelectModal';
// Removed secondary toolbar; actions moved to compact icon header

function AppShell() {
  const [sidebarWidth, setSidebarWidth] = useState<number>(360);
  const [dragging, setDragging] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(sidebarWidth);
  const { dashboards, activeDashboardId, openDashboardModal, openChat } = useApp();
  const [isSQLOpen, setIsSQLOpen] = useState(false);
  // Remove landing gallery; use a modal for chart selection instead
  const [isSelectOpen, setIsSelectOpen] = useState(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startXRef.current;
      const next = Math.min(Math.max(startWidthRef.current + dx, 200), 480);
      setSidebarWidth(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  const onHandleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setDragging(true);
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
  };

  const onRefreshAllCharts = () => {
    window.dispatchEvent(new CustomEvent('refresh-all-charts'))
  };

  const onFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div className="min-h-screen w-full text-white">
      <div className="flex h-screen">
        <Sidebar width={sidebarWidth} onResizeStart={onHandleMouseDown} />
        {/* Main Content */}
        <main className="flex-1 p-6 overflow-auto">
          {/* Header with icons */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-primary-400 to-secondary-400 bg-clip-text text-transparent">
                {(() => {
                  const active = dashboards.find(d => d.id === activeDashboardId);
                  return active?.name?.trim() || 'Dashboard';
                })()}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn" title="Add Chart" onClick={() => setIsSelectOpen(true)}><FiBarChart2 /></button>
              <button className="btn" title="Run SQL" onClick={() => setIsSQLOpen(true)}><FiDatabase /></button>
              <button className="btn" title="Refresh All Charts" onClick={onRefreshAllCharts}><FiRefreshCw /></button>
              <button className="btn" title="Settings" onClick={() => {
                const active = dashboards.find(d => d.id === activeDashboardId);
                if (active) openDashboardModal(active);
              }}><FiSettings /></button>
              <button className="btn" title="Fullscreen" onClick={onFullscreen}><FiMaximize /></button>
              <button className="btn" title="Chat" onClick={() => openChat()}><FiMessageSquare /></button>
            </div>
          </div>
          {/* Content area */}
          <div className="animate-fade-in space-y-4">
            {/* Removed inline ChartGallery landing view to use selection modal */}
            <ChartContainer />
          </div>
          {/* Modals */}
          <ChartSelectModal isOpen={isSelectOpen} onClose={() => setIsSelectOpen(false)} />
          <ChatSidebar />
          <AddEditDashboardModal />
          <SQLRunnerModal isOpen={isSQLOpen} onClose={() => setIsSQLOpen(false)} />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
