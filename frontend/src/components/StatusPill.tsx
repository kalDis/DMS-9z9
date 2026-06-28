'use client';

const STATUS_COLORS: Record<string, { c: string; bg: string }> = {
  'New': { c: '#8B5CF6', bg: 'rgba(139,92,246,0.1)' },
  'Waiting': { c: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  'Dispatched': { c: '#00E5FF', bg: 'rgba(0,229,255,0.08)' },
  'In Transit': { c: '#7B2FBE', bg: 'rgba(123,47,190,0.12)' },
  'Out for Delivery': { c: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  'Delivered': { c: '#10B981', bg: 'rgba(16,185,129,0.1)' },
  'Failed': { c: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
  'Returned': { c: '#6B7280', bg: 'rgba(107,114,128,0.1)' },
};

export default function StatusPill({ status }: { status: string }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS['Dispatched'];
  return (
    <span className="rounded px-[10px] py-[2px] text-[11px] font-semibold tracking-[.04em] whitespace-nowrap inline-block"
      style={{ color: s.c, background: s.bg, border: `1px solid ${s.c}30` }}>
      {status}
    </span>
  );
}
