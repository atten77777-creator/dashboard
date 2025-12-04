import React from 'react'
import ChartBuilderModal from '../ChartBuilderModal'

interface Props { 
  isOpen: boolean; 
  onClose: () => void; 
  chart?: any; 
  initialTitle?: string;
  initialFields?: { x?: string; y?: string; y2?: string };
  columnsOverride?: string[];
  dataOverride?: { columns: (string | { name: string })[]; rows: any[] };
}

export default function TreemapChartBuilder({ isOpen, onClose, chart, initialTitle, initialFields, columnsOverride, dataOverride }: Props) {
  return (
    <ChartBuilderModal isOpen={isOpen} onClose={onClose} chart={chart} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} lockType="treemap" />
  )
}