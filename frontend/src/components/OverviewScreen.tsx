'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusPill from './StatusPill';
import DateRangeFilter from './DateRangeFilter';

interface Order {
  id: number;
  tracking_number: string;
  customer_name: string;
  phone: string;
  product: string;
  branch: string;
  status: string;
  created_at: string;
}

export default function OverviewScreen() {
  const { user, activeBusiness } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (activeBusiness) params.set('business_id', String(activeBusiness.id));
    params.set('limit', '6');
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    api(`/orders?${params}`).then(d => setOrders(d.orders)).catch(() => {});
  }, [activeBusiness, dateFrom, dateTo]);

  const counts = {
    total: orders.length,
    delivered: orders.filter(o => o.status === 'Delivered').length,
    inTransit: orders.filter(o => ['In Transit', 'Out for Delivery'].includes(o.status)).length,
    failed: orders.filter(o => o.status === 'Failed').length,
    issues: 0,
  };
  const pct = counts.total ? Math.round(counts.delivered / counts.total * 100) : 0;

  const metrics = [
    { lbl: 'Total Orders', val: counts.total, sub: "Today's batch", c: '#00E5FF', ic: '◈' },
    { lbl: 'Delivered', val: counts.delivered, sub: `${pct}% rate`, c: '#10B981', ic: '✓' },
    { lbl: 'In Transit', val: counts.inTransit, sub: 'Active', c: '#7B2FBE', ic: '▷' },
    { lbl: 'Issues', val: counts.issues, sub: 'Needs action', c: '#EF4444', ic: '◉' },
    { lbl: 'Failed', val: counts.failed, sub: 'No delivery', c: '#F59E0B', ic: '✕' },
  ];

  const daysSince = (d: string) => {
    const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    return diff === 0 ? 'Today' : `${diff}d`;
  };

  return (
    <div className="animate-fadeIn">
      <div className="mb-[22px]">
        <div className="text-[11px] tracking-[.12em] uppercase mb-1" style={{ color: '#00E5FF' }}>
          Today · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
        <div className="text-[22px] font-bold" style={{ color: '#E8F4FF' }}>
          Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, {user?.name?.split(' ')[0]} 👋
        </div>
      </div>

      <div className="mb-4">
        <DateRangeFilter
          onFilter={(from, to) => { setDateFrom(from); setDateTo(to); }}
          onClear={() => { setDateFrom(''); setDateTo(''); }}
        />
      </div>

      <div className="grid grid-cols-5 gap-[10px] mb-[22px]">
        {metrics.map(m => (
          <div key={m.lbl} className="rounded-[10px] p-[14px_16px] relative overflow-hidden"
            style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
            <div className="absolute top-0 left-0 right-0 h-[2px]"
              style={{ background: `linear-gradient(90deg, transparent, ${m.c}, transparent)` }} />
            <div className="text-lg mb-1 opacity-70">{m.ic}</div>
            <div className="mono text-[28px] font-bold leading-tight" style={{ color: m.c }}>{m.val}</div>
            <div className="text-[10px] tracking-[.08em] uppercase mt-1" style={{ color: '#4A6080' }}>{m.lbl}</div>
            <div className="text-[10px] mt-[2px]" style={{ color: '#2A4060' }}>{m.sub}</div>
          </div>
        ))}
      </div>

      <div className="text-[10px] tracking-[.1em] uppercase mb-[10px]" style={{ color: '#3A5570' }}>Recent Orders</div>

      {/* Table Header */}
      <div className="grid gap-[10px] px-4 py-[7px] text-[10px] tracking-[.08em] uppercase mb-1"
        style={{ gridTemplateColumns: '110px 1fr 120px 110px 80px 130px', color: '#2A4060' }}>
        <span>Tracking</span><span>Customer</span><span>Product</span><span>Branch</span><span>Days</span><span>Status</span>
      </div>

      {orders.length === 0 && (
        <div className="text-center py-12 text-sm" style={{ color: '#2A4060' }}>
          No orders yet. Upload your first batch from the Orders screen.
        </div>
      )}

      {orders.map(o => {
        const days = daysSince(o.created_at);
        const daysNum = days === 'Today' ? 0 : parseInt(days);
        return (
          <div key={o.id} className="grid gap-[10px] px-4 py-3 rounded-lg items-center mb-[5px] cursor-pointer transition-all"
            style={{ gridTemplateColumns: '110px 1fr 120px 110px 80px 130px', background: '#0D1B2A', border: '1px solid #1A2940' }}>
            <span className="mono text-[11px]" style={{ color: '#00E5FF' }}>{o.tracking_number}</span>
            <div>
              <div className="text-[13px]" style={{ color: '#C8D8E8' }}>{o.customer_name}</div>
              <div className="mono text-[13px] font-semibold" style={{ color: '#7B2FBE' }}>{o.phone}</div>
            </div>
            <span className="text-xs" style={{ color: '#4A6080' }}>{o.product}</span>
            <span className="text-xs" style={{ color: '#4A6080' }}>{o.branch}</span>
            <span className="mono text-xs" style={{ color: daysNum >= 3 ? '#EF4444' : '#4A6080' }}>{days}</span>
            <StatusPill status={o.status} />
          </div>
        );
      })}
    </div>
  );
}
