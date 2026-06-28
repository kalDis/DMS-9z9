'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusPill from './StatusPill';

interface Analytics {
  status_breakdown: { status: string; count: number }[];
  delivery_rate: number;
  total_orders: number;
  total_delivered: number;
  issues_by_source: { source: string; count: number }[];
  issues_by_status: { status: string; count: number }[];
  resolutions: { resolution: string; count: number }[];
  by_salesperson: { salesperson: string; total: number; delivered: number; returned: number; failed: number }[];
}

export default function OverviewScreen() {
  const { user, activeBusiness } = useAuth();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  useEffect(() => {
    const params = activeBusiness ? `?business_id=${activeBusiness.id}` : '';
    api(`/export/analytics${params}`).then(setAnalytics).catch(() => {});
  }, [activeBusiness]);

  if (!analytics) return <div className="text-center py-12 text-sm" style={{ color: '#4A6080' }}>Loading...</div>;

  const statusColors: Record<string, string> = {
    'Delivered': '#10B981', 'In Transit': '#7B2FBE', 'Out for Delivery': '#F59E0B',
    'Dispatched': '#00E5FF', 'Failed': '#EF4444', 'Returned': '#6B7280',
    'New': '#8B5CF6', 'Waiting': '#F59E0B',
  };

  const maxTotal = Math.max(...analytics.by_salesperson.map(s => s.total), 1);

  return (
    <div className="animate-fadeIn">
      <div className="mb-[22px]">
        <div className="text-[11px] tracking-[.12em] uppercase mb-1" style={{ color: '#00E5FF' }}>
          Dashboard · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
        <div className="text-[22px] font-bold" style={{ color: '#E8F4FF' }}>
          Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, {user?.name?.split(' ')[0]}
        </div>
      </div>

      {/* Top Metrics */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Orders', val: analytics.total_orders, c: '#00E5FF', ic: '◈' },
          { label: 'Delivered', val: analytics.total_delivered, c: '#10B981', ic: '✓' },
          { label: 'Delivery Rate', val: `${analytics.delivery_rate}%`, c: '#10B981', ic: '◎' },
          { label: 'Active Issues', val: analytics.issues_by_status.filter(s => s.status === 'open' || s.status === 'in_progress').reduce((a, b) => a + Number(b.count), 0), c: '#EF4444', ic: '◉' },
        ].map(m => (
          <div key={m.label} className="rounded-[10px] p-[14px_16px] relative overflow-hidden"
            style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${m.c}, transparent)` }} />
            <div className="text-lg mb-1 opacity-70">{m.ic}</div>
            <div className="mono text-[26px] font-bold leading-tight" style={{ color: m.c }}>{m.val}</div>
            <div className="text-[10px] tracking-[.08em] uppercase mt-1" style={{ color: '#4A6080' }}>{m.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-5 mb-6">
        {/* Order Status Breakdown */}
        <div className="rounded-[10px] p-4" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
          <div className="text-[11px] tracking-[.08em] uppercase mb-4" style={{ color: '#3A5570' }}>Order Status</div>
          <div className="space-y-2">
            {analytics.status_breakdown.map(s => {
              const pct = analytics.total_orders > 0 ? (Number(s.count) / analytics.total_orders * 100) : 0;
              return (
                <div key={s.status}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[12px]" style={{ color: '#C8D8E8' }}>{s.status}</span>
                    <span className="mono text-[12px] font-semibold" style={{ color: statusColors[s.status] || '#4A6080' }}>{s.count}</span>
                  </div>
                  <div className="h-[4px] rounded-full" style={{ background: '#1A2940' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: statusColors[s.status] || '#4A6080' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Issue Stats */}
        <div className="rounded-[10px] p-4" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
          <div className="text-[11px] tracking-[.08em] uppercase mb-4" style={{ color: '#3A5570' }}>Issues</div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            {analytics.issues_by_source.map(s => (
              <div key={s.source} className="rounded-lg p-3 text-center" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                <div className="mono text-lg font-bold" style={{ color: s.source === 'domex' ? '#EF4444' : '#F59E0B' }}>{s.count}</div>
                <div className="text-[10px] uppercase" style={{ color: '#4A6080' }}>{s.source}</div>
              </div>
            ))}
          </div>

          <div className="text-[10px] tracking-[.06em] uppercase mb-2" style={{ color: '#3A5570' }}>By Status</div>
          <div className="space-y-1">
            {analytics.issues_by_status.map(s => (
              <div key={s.status} className="flex justify-between text-[12px]">
                <span style={{ color: '#6A8AA8' }}>{s.status === 'in_progress' ? 'In Progress' : s.status === 'auto_return' ? 'Auto Return' : s.status.charAt(0).toUpperCase() + s.status.slice(1)}</span>
                <span className="mono font-semibold" style={{ color: '#C8D8E8' }}>{s.count}</span>
              </div>
            ))}
          </div>

          {analytics.resolutions.length > 0 && (
            <>
              <div className="text-[10px] tracking-[.06em] uppercase mb-2 mt-4" style={{ color: '#3A5570' }}>Resolutions</div>
              <div className="space-y-1">
                {analytics.resolutions.map(r => (
                  <div key={r.resolution} className="flex justify-between text-[12px]">
                    <span style={{ color: '#6A8AA8' }}>{r.resolution}</span>
                    <span className="mono font-semibold" style={{ color: '#C8D8E8' }}>{r.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Salesperson Performance */}
      {analytics.by_salesperson.length > 0 && (
        <div className="rounded-[10px] p-4" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
          <div className="text-[11px] tracking-[.08em] uppercase mb-4" style={{ color: '#3A5570' }}>Salesperson Performance</div>
          <div className="grid gap-[10px] px-2 py-[5px] text-[10px] tracking-[.08em] uppercase mb-1"
            style={{ gridTemplateColumns: '120px 1fr 70px 70px 70px 70px', color: '#2A4060' }}>
            <span>Name</span><span>Orders</span><span>Total</span><span>Delivered</span><span>Returned</span><span>Failed</span>
          </div>
          {analytics.by_salesperson.map(s => {
            const deliveredPct = s.total > 0 ? (s.delivered / s.total * 100) : 0;
            const returnedPct = s.total > 0 ? (s.returned / s.total * 100) : 0;
            const failedPct = s.total > 0 ? (s.failed / s.total * 100) : 0;
            return (
              <div key={s.salesperson} className="grid gap-[10px] px-2 py-2 rounded-md items-center mb-[3px]"
                style={{ gridTemplateColumns: '120px 1fr 70px 70px 70px 70px' }}>
                <span className="text-[12px] font-medium" style={{ color: '#C8D8E8' }}>{s.salesperson}</span>
                <div className="h-[6px] rounded-full flex overflow-hidden" style={{ background: '#1A2940' }}>
                  <div style={{ width: `${deliveredPct}%`, background: '#10B981' }} />
                  <div style={{ width: `${returnedPct}%`, background: '#6B7280' }} />
                  <div style={{ width: `${failedPct}%`, background: '#EF4444' }} />
                </div>
                <span className="mono text-[12px] text-center" style={{ color: '#C8D8E8' }}>{s.total}</span>
                <span className="mono text-[12px] text-center" style={{ color: '#10B981' }}>{s.delivered}</span>
                <span className="mono text-[12px] text-center" style={{ color: '#6B7280' }}>{s.returned}</span>
                <span className="mono text-[12px] text-center" style={{ color: '#EF4444' }}>{s.failed}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
