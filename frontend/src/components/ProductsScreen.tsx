'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import DateRangeFilter from './DateRangeFilter';

interface Row { item_code: string; product_name: string; total: number; delivered: number; returned: number; }

export default function ProductsScreen() {
  const { activeBusiness } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ product_count: 0, total_orders: 0, total_delivered: 0, total_returned: 0 });
  const [hasMaster, setHasMaster] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const buildParams = () => {
    const p = new URLSearchParams();
    if (activeBusiness) p.set('business_id', String(activeBusiness.id));
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    return p;
  };

  const load = () => {
    setLoading(true);
    api(`/orders/product-report?${buildParams()}`).then(d => {
      setRows(d.rows || []);
      setTotals({ product_count: d.product_count || 0, total_orders: d.total_orders || 0, total_delivered: d.total_delivered || 0, total_returned: d.total_returned || 0 });
      setHasMaster(d.has_master !== false);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeBusiness, dateFrom, dateTo]);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('dms_token');
      const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
      const params = buildParams(); params.set('format', 'xlsx');
      const res = await fetch(`${API}/orders/product-report?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DMS_Product_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { alert('Export failed'); }
    setExporting(false);
  };

  const term = search.trim().toLowerCase();
  const shown = term ? rows.filter(r => r.item_code.toLowerCase().includes(term) || (r.product_name || '').toLowerCase().includes(term)) : rows;

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-[22px] flex-wrap gap-3">
        <div>
          <div className="text-[10px] tracking-[.1em] uppercase" style={{ color: '#4A6080' }}>Reports</div>
          <div className="text-xl font-bold mt-[2px]" style={{ color: '#E8F4FF' }}>Products</div>
        </div>
        <button onClick={exportXlsx} disabled={exporting || rows.length === 0}
          className="rounded-md px-4 py-[7px] text-xs font-semibold"
          style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', color: rows.length ? '#00E5FF' : '#2A4060' }}>
          {exporting ? 'Exporting...' : '⬇ Export to Excel'}
        </button>
      </div>

      {/* Search + date filter */}
      <input className="w-full rounded-lg px-[14px] py-[9px] text-[13px] mb-3 outline-none"
        style={{ background: '#0D1B2A', border: '1px solid #1A2940', color: '#C8D8E8' }}
        placeholder="Search by product code or name..."
        value={search} onChange={e => setSearch(e.target.value)} />
      <div className="mb-4">
        <DateRangeFilter label="Order Date" onFilter={(f, t) => { setDateFrom(f); setDateTo(t); }} onClear={() => { setDateFrom(''); setDateTo(''); }} />
      </div>

      {!hasMaster && (
        <div className="rounded-md px-3 py-2 mb-4 text-[12px]"
          style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)', color: '#F59E0B' }}>
          ⓘ No product master uploaded for this business — showing raw codes. An admin can upload the product list in Admin → Settings for clean names.
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Products', val: totals.product_count, c: '#00E5FF' },
          { label: 'Total Orders', val: totals.total_orders, c: '#8ABBE0' },
          { label: 'Delivered', val: totals.total_delivered, c: '#10B981' },
          { label: 'Returned', val: totals.total_returned, c: '#EF4444' },
        ].map(m => (
          <div key={m.label} className="rounded-[10px] p-[14px_16px]" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
            <div className="text-[22px] font-bold" style={{ color: m.c }}>{m.val.toLocaleString()}</div>
            <div className="text-[10px] tracking-[.08em] uppercase mt-1" style={{ color: '#4A6080' }}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="grid gap-[10px] px-4 py-[7px] text-[10px] tracking-[.08em] uppercase"
        style={{ gridTemplateColumns: '40px 110px 1fr 90px 90px 90px', color: '#2A4060' }}>
        <span>#</span><span>Code</span><span>Product</span>
        <span className="text-right">Total</span><span className="text-right">Delivered</span><span className="text-right">Returned</span>
      </div>

      {loading && <div className="text-center py-10 text-[13px]" style={{ color: '#4A6080' }}>Loading…</div>}
      {!loading && shown.length === 0 && <div className="text-center py-12 text-[13px]" style={{ color: '#2A4060' }}>No products{term ? ' match your search' : ' for this filter'}</div>}

      {!loading && shown.map((r, i) => (
        <div key={r.item_code + i} className="grid gap-[10px] px-4 py-[9px] rounded-lg items-center mb-[4px]"
          style={{ gridTemplateColumns: '40px 110px 1fr 90px 90px 90px', background: '#0D1B2A', border: '1px solid #1A2940' }}>
          <span className="mono text-[12px]" style={{ color: '#3A5570' }}>{i + 1}</span>
          <span className="mono text-[12px]" style={{ color: '#00E5FF' }}>{r.item_code}</span>
          <span className="text-[13px]" style={{ color: '#C8D8E8' }}>{r.product_name || '—'}</span>
          <span className="mono text-[13px] font-bold text-right" style={{ color: '#8ABBE0' }}>{r.total.toLocaleString()}</span>
          <span className="mono text-[13px] text-right" style={{ color: '#10B981' }}>{r.delivered.toLocaleString()}</span>
          <span className="mono text-[13px] text-right" style={{ color: r.returned > 0 ? '#EF4444' : '#3A5570' }}>{r.returned.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
