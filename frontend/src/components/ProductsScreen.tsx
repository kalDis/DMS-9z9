'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import DateRangeFilter from './DateRangeFilter';

interface Row { item_code: string; product_name: string; orders: number; items: number; }

const STATUSES = ['Delivered', 'Returned', 'Failed', 'All'];

export default function ProductsScreen() {
  const { activeBusiness } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ product_count: 0, total_orders: 0, total_items: 0 });
  const [hasMaster, setHasMaster] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState('Delivered');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const buildParams = () => {
    const p = new URLSearchParams();
    if (activeBusiness) p.set('business_id', String(activeBusiness.id));
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    p.set('status', status);
    return p;
  };

  const load = () => {
    setLoading(true);
    api(`/orders/product-report?${buildParams()}`).then(d => {
      setRows(d.rows || []);
      setTotals({ product_count: d.product_count || 0, total_orders: d.total_orders || 0, total_items: d.total_items || 0 });
      setHasMaster(d.has_master !== false);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeBusiness, dateFrom, dateTo, status]);

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
      a.download = `DMS_Product_Report_${status}_${new Date().toISOString().split('T')[0]}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { alert('Export failed'); }
    setExporting(false);
  };

  const maxItems = Math.max(...rows.map(r => r.items), 1);

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-[22px] flex-wrap gap-3">
        <div>
          <div className="text-[10px] tracking-[.1em] uppercase" style={{ color: '#4A6080' }}>Reports</div>
          <div className="text-xl font-bold mt-[2px]" style={{ color: '#E8F4FF' }}>Products — {status} count</div>
        </div>
        <button onClick={exportXlsx} disabled={exporting || rows.length === 0}
          className="rounded-md px-4 py-[7px] text-xs font-semibold"
          style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', color: rows.length ? '#00E5FF' : '#2A4060' }}>
          {exporting ? 'Exporting...' : '⬇ Export to Excel'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center flex-wrap mb-4">
        <div className="flex gap-[6px] flex-wrap">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className="rounded-full px-3 py-1 text-[11px] whitespace-nowrap"
              style={{
                border: status === s ? '1px solid rgba(0,229,255,.4)' : '1px solid #1A2940',
                color: status === s ? '#00E5FF' : '#7288A8',
                background: status === s ? 'rgba(0,229,255,.08)' : 'transparent',
              }}>{s}</button>
          ))}
        </div>
        <DateRangeFilter label="Delivered Date" onFilter={(f, t) => { setDateFrom(f); setDateTo(t); }} onClear={() => { setDateFrom(''); setDateTo(''); }} />
      </div>

      {!hasMaster && (
        <div className="rounded-md px-3 py-2 mb-4 text-[12px]"
          style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)', color: '#F59E0B' }}>
          ⓘ No product master uploaded for this business — showing raw codes. An admin can upload the product list in Admin → Settings for clean names.
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Products', val: totals.product_count, c: '#00E5FF' },
          { label: `Orders (${status})`, val: totals.total_orders, c: '#10B981' },
          { label: `Items (${status})`, val: totals.total_items, c: '#F59E0B' },
        ].map(m => (
          <div key={m.label} className="rounded-[10px] p-[14px_16px]" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
            <div className="text-[22px] font-bold" style={{ color: m.c }}>{m.val.toLocaleString()}</div>
            <div className="text-[10px] tracking-[.08em] uppercase mt-1" style={{ color: '#4A6080' }}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="grid gap-[10px] px-4 py-[7px] text-[10px] tracking-[.08em] uppercase"
        style={{ gridTemplateColumns: '40px 130px 1fr 90px 90px', color: '#2A4060' }}>
        <span>#</span><span>Product Code</span><span>Product</span><span className="text-right">Orders</span><span className="text-right">Items</span>
      </div>

      {loading && <div className="text-center py-10 text-[13px]" style={{ color: '#4A6080' }}>Loading…</div>}
      {!loading && rows.length === 0 && <div className="text-center py-12 text-[13px]" style={{ color: '#2A4060' }}>No data for this filter</div>}

      {!loading && rows.map((r, i) => (
        <div key={r.item_code + i} className="grid gap-[10px] px-4 py-[9px] rounded-lg items-center mb-[4px] relative"
          style={{ gridTemplateColumns: '40px 130px 1fr 90px 90px', background: '#0D1B2A', border: '1px solid #1A2940' }}>
          <span className="mono text-[12px]" style={{ color: '#3A5570' }}>{i + 1}</span>
          <span className="mono text-[12px]" style={{ color: '#00E5FF' }}>{r.item_code}</span>
          <span className="text-[13px] flex items-center gap-2" style={{ color: '#C8D8E8' }}>
            <span className="inline-block h-[6px] rounded-full" style={{ width: `${Math.max(6, (r.items / maxItems) * 90)}px`, background: 'rgba(0,229,255,.25)' }} />
            {r.product_name || '—'}
          </span>
          <span className="mono text-[13px] text-right" style={{ color: '#8ABBE0' }}>{r.orders.toLocaleString()}</span>
          <span className="mono text-[13px] font-bold text-right" style={{ color: '#F59E0B' }}>{r.items.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
