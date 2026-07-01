'use client';
import { useRef, useState } from 'react';

interface DateRangeFilterProps {
  label?: string;
  onFilter: (from: string, to: string) => void;
  onClear: () => void;
}

function formatDisplay(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function DateButton({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div
      onClick={() => ref.current?.showPicker()}
      className="flex items-center gap-[6px] rounded-md px-3 py-[6px] text-[12px] cursor-pointer relative"
      style={{ background: '#080D1A', border: '1px solid #1A2940', color: value ? '#C8D8E8' : '#2A4060' }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={value ? '#00E5FF' : '#7288A8'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      <span>{value ? formatDisplay(value) : placeholder}</span>
      <input
        ref={ref}
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '1px',
          height: '1px',
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

export default function DateRangeFilter({ label = 'Date Range', onFilter, onClear }: DateRangeFilterProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const handleApply = () => {
    if (from || to) onFilter(from, to);
  };

  const handleClear = () => {
    setFrom('');
    setTo('');
    onClear();
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] tracking-[.08em] uppercase" style={{ color: '#7288A8' }}>{label}</span>
      <DateButton value={from} onChange={setFrom} placeholder="From date" />
      <span className="text-[11px]" style={{ color: '#526888' }}>to</span>
      <DateButton value={to} onChange={setTo} placeholder="To date" />
      <button onClick={handleApply}
        className="rounded-md px-3 py-[6px] text-[11px] font-semibold"
        style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', color: '#00E5FF' }}>
        Apply
      </button>
      {(from || to) && (
        <button onClick={handleClear}
          className="rounded-md px-3 py-[6px] text-[11px] font-semibold"
          style={{ background: 'transparent', border: '1px solid #1A2940', color: '#7288A8' }}>
          Clear
        </button>
      )}
    </div>
  );
}
