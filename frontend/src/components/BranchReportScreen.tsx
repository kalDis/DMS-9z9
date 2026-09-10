'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import DateRangeFilter from './DateRangeFilter';

interface Row {
  branch: string; total: number; delivered: number; returned: number;
  pending: number; return_rate: number; delivered_rate: number;
}

type SortKey = 'branch' | 'total' | 'delivered' | 'returned' | 'pending' | 'return_rate' | 'delivered_rate';

export default function BranchReportScreen() {
  const { activeBusiness } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ total: 0, delivered: 0, returned: 0, pending: 0, return_rate: 0, delivered_rate: 0 });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('total');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const buildParams = () => {
    const p = new URLSearchParams();
    if (activeBusiness) p.set('business_id', String(activeBusiness.id));
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    return p;
  };

  const load = () => {
    setLoading(true);
    api(`/orders/branch-report?${buildParams()}`).then(d => {
      setRows(d.rows || []);
      setTotals(d.totals || { total: 0, delivered: 0, returned: 0, pending: 0, return_rate: 0, delivered_rate: 0 });
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeBusiness, dateFrom, dateTo]);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('dms_token');
      const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
      const params = buildParams(); params.set('format', 'xlsx');
      const res = await fetch(`${API}/orders/branch-report?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DMS_Branch_Performance_${new Date().toISOString().split('T')[0]}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { alert('Export failed'); }
    setExporting(false);
  };

  const toggleSort = (k: SortKey) => {
    if (sortBy === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(k); setSortDir(k === 'branch' ? 'asc' : 'desc'); }
  };

  const term = search.trim().toLowerCase();
  const shown = (term ? rows.filter(r => (r.branch || '').toLowerCase().includes(term)) : rows)
    .slice()
    .sort((a, b) => {
      const av = a[sortBy], bv = b[sortBy];
      const cmp = typeof av === 'string' ? String(av).localeCompare(String(bv)) : (Number(av) - Number(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });

  // Color the return rate: green ≤5%, amber ≤12%, red above
  const rateColor = (r: number) => r <= 5 ? '#10B981' : r <= 12 ? '#F59E0B' : '#EF4444';

  const GRID = '40px 1fr 90px 90px 90px 90px 110px 100px';
  const cols: { key: SortKey; label: string; right?: boolean }[] = [
    { key: 'branch', label: 'Branch' },
    { key: 'total', label: 'Total', right: true },
    { key: 'delivered', label: 'Delivered', right: true },
    { key: 'returned', label: 'Returned', right: true },
    { key: 'pending', label: 'Pending', right: true },
    { key: 'return_rate', label: 'Return %', right: true },
    { key: 'delivered_rate', label: 'Deliv %', right: true },
  ];

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-[22px] flex-wrap gap-3">
        <div>
          <div className="text-[10px] tracking-[.1em] uppercase" style={{ color: '#4A6080' }}>Reports</div>
          <div className="text-xl font-bold mt-[2px]" style={{ color: '#E8F4FF' }}>Branch Performance</div>
        </div>
        <button onClick={exportXlsx} disabled={exporting || rows.length === 0}
          className="rounded-md px-4 py-[7px] text-xs font-semibold"
          style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', color: rows.length ? '#00E5FF' : '#2A4060' }}>
          {exporting ? 'Exporting...' : '⬇ Export to Excel'}
        </button>
      </div>

      <input className="w-full rounded-lg px-[14px] py-[9px] text-[13px] mb-3 outline-none"
        style={{ background: '#0D1B2A', border: '1px solid #1A2940', color: '#C8D8E8' }}
        placeholder="Search by branch..."
        value={search} onChange={e => setSearch(e.target.value)} />
      <div className="mb-4">
        <DateRangeFilter label="Order Date" onFilter={(f, t) => { setDateFrom(f); setDateTo(t); }} onClear={() => { setDateFrom(''); setDateTo(''); }} />
      </div>

      <div className="rounded-md px-3 py-2 mb-4 text-[12px]"
        style={{ background: 'rgba(0,229,255,.04)', border: '1px solid rgba(0,229,255,.12)', color: '#6A8AA8' }}>
        ⓘ Delivering branch = the Domex branch that did the last-mile scan (out-for-delivery / delivered). Only orders synced from Domex appear here. Return % is of completed orders (delivered + returned).
      </div>

      {/* Summary */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        {[
          { label: 'Branches', val: rows.length, c: '#00E5FF' },
          { label: 'Total Orders', val: totals.total, c: '#8ABBE0' },
          { label: 'Delivered', val: totals.delivered, c: '#10B981' },
          { label: 'Returned', val: totals.returned, c: '#EF4444' },
          { label: 'Pending', val: totals.pending, c: '#F59E0B' },
        ].map(m => (
          <div key={m.label} className="rounded-[10px] p-[14px_16px]" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
            <div className="text-[22px] font-bold" style={{ color: m.c }}>{m.val.toLocaleString()}</div>
            <div className="text-[10px] tracking-[.08em] uppercase mt-1" style={{ color: '#4A6080' }}>{m.label}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        {/* Header */}
        <div className="grid gap-[10px] px-4 py-[7px] text-[10px] tracking-[.08em] uppercase"
          style={{ gridTemplateColumns: GRID, color: '#2A4060' }}>
          <span>#</span>
          {cols.map(c => (
            <span key={c.key} onClick={() => toggleSort(c.key)}
              className={`cursor-pointer select-none hover:text-[#8ABBE0] transition-colors ${c.right ? 'text-right' : ''}`}
              style={{ color: sortBy === c.key ? '#00E5FF' : undefined }}>
              {c.label} {sortBy === c.key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </span>
          ))}
        </div>

        {loading && <div className="text-center py-10 text-[13px]" style={{ color: '#4A6080' }}>Loading…</div>}
        {!loading && shown.length === 0 && (
          <div className="text-center py-12 text-[13px]" style={{ color: '#2A4060' }}>
            No branch data{term ? ' matches your search' : ' yet — sync orders from Domex to populate delivering branches'}
          </div>
        )}

        {!loading && shown.map((r, i) => (
          <div key={r.branch + i} className="grid gap-[10px] px-4 py-[9px] rounded-lg items-center mb-[4px]"
            style={{ gridTemplateColumns: GRID, background: '#0D1B2A', border: '1px solid #1A2940' }}>
            <span className="mono text-[12px]" style={{ color: '#3A5570' }}>{i + 1}</span>
            <span className="text-[13px] font-medium" style={{ color: '#C8D8E8' }}>{r.branch}</span>
            <span className="mono text-[13px] font-bold text-right" style={{ color: '#8ABBE0' }}>{r.total.toLocaleString()}</span>
            <span className="mono text-[13px] text-right" style={{ color: '#10B981' }}>{r.delivered.toLocaleString()}</span>
            <span className="mono text-[13px] text-right" style={{ color: r.returned > 0 ? '#EF4444' : '#3A5570' }}>{r.returned.toLocaleString()}</span>
            <span className="mono text-[13px] text-right" style={{ color: r.pending > 0 ? '#F59E0B' : '#3A5570' }}>{r.pending.toLocaleString()}</span>
            <span className="mono text-[13px] font-bold text-right" style={{ color: rateColor(r.return_rate) }}>{r.return_rate}%</span>
            <span className="mono text-[13px] text-right" style={{ color: '#6A8AA8' }}>{r.delivered_rate}%</span>
          </div>
        ))}

        {/* Totals row */}
        {!loading && shown.length > 0 && (
          <div className="grid gap-[10px] px-4 py-[10px] rounded-lg items-center mt-2"
            style={{ gridTemplateColumns: GRID, background: 'rgba(0,229,255,.05)', border: '1px solid rgba(0,229,255,.2)' }}>
            <span></span>
            <span className="text-[13px] font-bold" style={{ color: '#00E5FF' }}>TOTAL</span>
            <span className="mono text-[13px] font-bold text-right" style={{ color: '#E8F4FF' }}>{totals.total.toLocaleString()}</span>
            <span className="mono text-[13px] font-bold text-right" style={{ color: '#10B981' }}>{totals.delivered.toLocaleString()}</span>
            <span className="mono text-[13px] font-bold text-right" style={{ color: '#EF4444' }}>{totals.returned.toLocaleString()}</span>
            <span className="mono text-[13px] font-bold text-right" style={{ color: '#F59E0B' }}>{totals.pending.toLocaleString()}</span>
            <span className="mono text-[13px] font-bold text-right" style={{ color: rateColor(totals.return_rate) }}>{totals.return_rate}%</span>
            <span className="mono text-[13px] font-bold text-right" style={{ color: '#8ABBE0' }}>{totals.delivered_rate}%</span>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
