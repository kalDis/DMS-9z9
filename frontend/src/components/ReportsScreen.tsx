'use client';
import { useState } from 'react';
import BranchReportScreen from './BranchReportScreen';
import ProductsScreen from './ProductsScreen';
import AdRoiScreen from './AdRoiScreen';

const TABS = [
  { id: 'branch', label: 'Branch Performance', icon: '⌂' },
  { id: 'products', label: 'Products', icon: '▣' },
  { id: 'adroi', label: 'Ad ROI', icon: '◑' },
];

export default function ReportsScreen() {
  const [tab, setTab] = useState('branch');

  return (
    <div className="animate-fadeIn">
      {/* Sub-tab switcher */}
      <div className="flex gap-[6px] mb-6 flex-wrap">
        {TABS.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="rounded-lg px-4 py-2 text-[12px] font-semibold whitespace-nowrap transition-all flex items-center gap-2"
              style={{
                border: active ? '1px solid rgba(0,229,255,.4)' : '1px solid #1A2940',
                color: active ? '#00E5FF' : '#7288A8',
                background: active ? 'rgba(0,229,255,.08)' : 'transparent',
              }}>
              <span className="text-[14px]">{t.icon}</span>{t.label}
            </button>
          );
        })}
      </div>

      {tab === 'branch' && <BranchReportScreen />}
      {tab === 'products' && <ProductsScreen />}
      {tab === 'adroi' && <AdRoiScreen />}
    </div>
  );
}
