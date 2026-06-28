'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import DateRangeFilter from './DateRangeFilter';

interface ExportItem {
  id: number;
  tracking_number: string;
  customer_name: string;
  phone: string;
  product: string;
  salesperson: string;
  branch: string;
  amount: number;
  resolution: string;
  scheduled_date: string;
  status: string;
  source: string;
  attempt: number;
  resolved_at: string;
}

export default function ExportScreen() {
  const { activeBusiness } = useAuth();
  const [items, setItems] = useState<ExportItem[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState(false);

  const fetchItems = () => {
    const params = new URLSearchParams();
    if (activeBusiness) params.set('business_id', String(activeBusiness.id));
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    api(`/export/issues?${params}`).then(setItems).catch(() => {});
  };

  useEffect(() => { fetchItems(); }, [activeBusiness, dateFrom, dateTo]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (activeBusiness) params.set('business_id', String(activeBusiness.id));
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);

      const token = localStorage.getItem('dms_token');
      const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
      const res = await fetch(`${API}/export/download?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DMS_Issue_Export_${new Date().toISOString().split('T')[0]}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed');
    }
    setExporting(false);
  };

  const resColor = (r: string) => {
    if (!r) return '#4A6080';
    const lower = r.toLowerCase();
    if (lower.includes('return') || lower === 'auto_return') return '#6B7280';
    if (lower.includes('reschedule')) return '#00E5FF';
    return '#10B981';
  };

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-[22px]">
        <div>
          <div className="text-[10px] tracking-[.1em] uppercase" style={{ color: '#4A6080' }}>End of Day</div>
          <div className="text-xl font-bold mt-[2px]" style={{ color: '#E8F4FF' }}>Domex Export</div>
        </div>
        <button onClick={handleExport} disabled={exporting || items.length === 0}
          className="rounded-md px-4 py-2 text-xs font-semibold transition-all"
          style={{
            background: items.length ? 'rgba(0,229,255,.08)' : 'transparent',
            border: `1px solid ${items.length ? 'rgba(0,229,255,.3)' : '#1A2940'}`,
            color: items.length ? '#00E5FF' : '#4A6080',
          }}>
          {exporting ? 'Exporting...' : `⬇ Export to Excel (${items.length})`}
        </button>
      </div>

      {/* Summary Card */}
      <div className="rounded-[10px] p-4 mb-5 flex items-center justify-between relative overflow-hidden"
        style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #00E5FF, transparent)' }} />
        <div>
          <div className="text-[14px] font-semibold" style={{ color: '#C8D8E8' }}>Resolved Issues</div>
          <div className="text-xs mt-1" style={{ color: '#4A6080' }}>
            {activeBusiness?.name} · {items.length} records {dateFrom || dateTo ? '(filtered)' : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="mono text-[22px] font-bold" style={{ color: '#00E5FF' }}>{items.length}</div>
          <div className="text-[10px]" style={{ color: '#2A4060' }}>records</div>
        </div>
      </div>

      {/* Date Filter */}
      <div className="mb-4">
        <DateRangeFilter
          label="Resolved Date"
          onFilter={(from, to) => { setDateFrom(from); setDateTo(to); }}
          onClear={() => { setDateFrom(''); setDateTo(''); }}
        />
      </div>

      {/* Table */}
      <div className="grid gap-[10px] px-4 py-[7px] text-[10px] tracking-[.08em] uppercase mb-1"
        style={{ gridTemplateColumns: '110px 1fr 130px 110px 150px 120px', color: '#2A4060' }}>
        <span>Tracking</span><span>Customer</span><span>Phone</span><span>Branch</span><span>Resolution</span><span>Resolved</span>
      </div>

      {items.length === 0 && (
        <div className="text-center py-12 text-[13px]" style={{ color: '#2A4060' }}>
          No resolved issues to export
        </div>
      )}

      {items.map(item => (
        <div key={item.id} className="grid gap-[10px] px-4 py-3 rounded-lg items-center mb-[5px]"
          style={{ gridTemplateColumns: '110px 1fr 130px 110px 150px 120px', background: '#0D1B2A', border: '1px solid #1A2940' }}>
          <span className="mono text-[11px]" style={{ color: '#00E5FF' }}>{item.tracking_number}</span>
          <div>
            <div className="text-[13px]" style={{ color: '#C8D8E8' }}>{item.customer_name}</div>
          </div>
          <span className="mono text-[13px] font-semibold" style={{ color: '#7B2FBE' }}>{item.phone}</span>
          <span className="text-xs" style={{ color: '#6A8AA8' }}>{item.branch}</span>
          <span className="text-xs font-semibold" style={{ color: resColor(item.resolution || item.status) }}>
            {item.status === 'auto_return' ? 'Auto-Return' : item.resolution || 'Resolved'}
            {item.scheduled_date ? ` → ${item.scheduled_date}` : ''}
          </span>
          <span className="mono text-[11px]" style={{ color: '#3A5570' }}>
            {item.resolved_at ? new Date(item.resolved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
          </span>
        </div>
      ))}

      {items.length > 0 && (
        <div className="mt-5 rounded-lg p-3 text-[12px] leading-relaxed"
          style={{ background: 'rgba(0,229,255,.04)', border: '1px solid rgba(0,229,255,.1)', color: '#4A6080' }}>
          ℹ After export, send the file to Domex via email or portal before end of business day.
        </div>
      )}
    </div>
  );
}
