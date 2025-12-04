import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { type Dashboard } from '../api';

interface DashboardPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPick: (dashboardId: string) => void;
  dashboards: Dashboard[];
  initialDashboardId?: string;
}

export function DashboardPickerModal({ isOpen, onClose, onPick, dashboards, initialDashboardId }: DashboardPickerModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      const initial = dashboards.find(d => d.id === initialDashboardId);
      setName(initial ? initial.name : '');
      setError('');
    }
  }, [isOpen, initialDashboardId, dashboards]);

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('Please enter a dashboard name');
      return;
    }
    
    const target = dashboards.find(d => d.name.toLowerCase() === name.trim().toLowerCase());
    if (!target) {
      setError('Dashboard not found');
      return;
    }
    
    onPick(target.id);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Select Dashboard">
      <div className="p-4 space-y-4">
        <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Dashboard Name</label>
            <input 
                className="w-full bg-slate-950 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="Enter dashboard name..."
                value={name}
                onChange={e => { setName(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                autoFocus
            />
            {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
        </div>
        
        {dashboards.length > 0 && (
            <div className="mt-2">
                <p className="text-xs text-white/40 mb-2">Available Dashboards:</p>
                <div className="max-h-32 overflow-y-auto space-y-1 custom-scrollbar">
                    {dashboards.map(d => (
                        <button 
                            key={d.id}
                            className="block w-full text-left px-2 py-1 rounded hover:bg-white/5 text-xs text-white/60 hover:text-white transition-colors"
                            onClick={() => setName(d.name)}
                        >
                            {d.name}
                        </button>
                    ))}
                </div>
            </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
            <button 
                onClick={onClose}
                className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-white/70 text-sm transition-colors"
            >
                Cancel
            </button>
            <button 
                onClick={handleSubmit}
                className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
            >
                Add Chart
            </button>
        </div>
      </div>
    </Modal>
  );
}
