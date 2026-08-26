'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import DateRangeFilter from './DateRangeFilter';

interface Plat { spend: number; impressions: number; clicks: number; leads: number; messages: number; }
interface Row {
  item_code: string; product_name: string; price: number;
  orders: number; delivered: number; returned: number; revenue: number;
  ad: Plat; platforms: { tiktok: Plat; meta: Plat };
}

const rs = (n: number) => 'Rs. ' + Math.round(n).toLocaleString();
const num = (n: number) => Math.round(n).toLocaleString();
const div = (a: number, b: number) => (b > 0 ? a / b : 0);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) + '%' : '—');

export default function AdRoiScreen() {
  const { activeBusiness } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<any>({ spend: 0, revenue: 0, delivered: 0, returned: 0, leads: 0, tracked: 0 });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // entry panel
  const [showEntry, setShowEntry] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ product_sku: '', period_start: '', period_end: '', tk: {}, mt: {} });
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!activeBusiness) return;
    setLoading(true);
    const p = new URLSearchParams();
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    api(`/ads/${activeBusiness.id}/report?${p}`).then(d => {
      setRows(d.rows || []); setTotals(d.totals || {});
    }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeBusiness, dateFrom, dateTo]);

  const loadEntryData = () => {
    if (!activeBusiness) return;
    api(`/settings/products/${activeBusiness.id}`).then(d => setProducts(d.products || [])).catch(() => {});
    api(`/ads/${activeBusiness.id}`).then(setEntries).catch(() => {});
  };
  useEffect(() => { if (showEntry) loadEntryData(); /* eslint-disable-next-line */ }, [showEntry, activeBusiness]);

  const saveEntry = async () => {
    if (!activeBusiness || !form.product_sku || !form.period_start || !form.period_end) { alert('Pick a product and a From–To date range'); return; }
    if (form.period_end < form.period_start) { alert('End date is before start date'); return; }
    setSaving(true);
    try {
      let savedAny = false;
      for (const [plat, data] of [['tiktok', form.tk], ['meta', form.mt]] as const) {
        const anything = ['spend', 'impressions', 'clicks', 'leads', 'messages'].some(f => data[f]);
        if (!anything) continue;
        const body: any = { product_sku: form.product_sku, platform: plat, period_start: form.period_start, period_end: form.period_end, ...data };
        let r = await api(`/ads/${activeBusiness.id}`, { method: 'POST', body: JSON.stringify(body) });
        if (r?.duplicate) {
          const ok = confirm(`${plat === 'tiktok' ? 'TikTok' : 'Meta'} data already exists for this product and date range (${form.period_start} → ${form.period_end}).\n\nOverwrite it with these new numbers?`);
          if (!ok) continue;
          r = await api(`/ads/${activeBusiness.id}`, { method: 'POST', body: JSON.stringify({ ...body, force: true }) });
        }
        savedAny = true;
      }
      if (savedAny) {
        setForm({ product_sku: '', period_start: '', period_end: '', tk: {}, mt: {} });
        loadEntryData(); load();
        alert('Ad data saved');
      }
    } catch (err: any) { alert(err.message || 'Failed'); }
    setSaving(false);
  };

  const delEntry = async (id: number) => {
    if (!confirm('Delete this entry?')) return;
    try { await api(`/ads/entry/${id}`, { method: 'DELETE' }); loadEntryData(); load(); } catch (err: any) { alert(err.message); }
  };

  const term = search.trim().toLowerCase();
  const shown = term ? rows.filter(r => r.item_code.toLowerCase().includes(term) || (r.product_name || '').toLowerCase().includes(term)) : rows;

  const fld = (obj: any, key: string, ph: string) => (
    <input type="number" value={obj[key] ?? ''} placeholder={ph}
      onChange={e => setForm((f: any) => ({ ...f, [obj === form.tk ? 'tk' : 'mt']: { ...obj, [key]: e.target.value } }))}
      className="w-full rounded-md px-2 py-[6px] text-[12px] outline-none mono"
      style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }} />
  );

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-[18px] flex-wrap gap-3">
        <div>
          <div className="text-[10px] tracking-[.1em] uppercase" style={{ color: '#4A6080' }}>Reports</div>
          <div className="text-xl font-bold mt-[2px]" style={{ color: '#E8F4FF' }}>Ad ROI</div>
        </div>
        <button onClick={() => setShowEntry(s => !s)}
          className="rounded-md px-4 py-[7px] text-xs font-semibold"
          style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', color: '#00E5FF' }}>
          {showEntry ? '✕ Close' : '＋ Add / Edit Ad Data'}
        </button>
      </div>

      {/* Entry panel */}
      {showEntry && (
        <div className="rounded-lg p-4 mb-5" style={{ background: '#0B1626', border: '1px solid #1E3350' }}>
          <div className="text-[12px] font-semibold mb-1" style={{ color: '#E8F4FF' }}>Add weekly ad data</div>
          <div className="text-[11px] mb-3" style={{ color: '#6A8AA8' }}>Pick a product + week, enter what you spent and got on each platform. Re-saving the same product+week+platform updates it.</div>
          <div className="flex gap-3 mb-3 flex-wrap">
            <div>
              <div className="text-[10px] mb-1" style={{ color: '#4A6080' }}>From</div>
              <input type="date" value={form.period_start} onChange={e => setForm((f: any) => ({ ...f, period_start: e.target.value }))}
                className="rounded-md px-3 py-[7px] text-[12px] outline-none" style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }} />
            </div>
            <div>
              <div className="text-[10px] mb-1" style={{ color: '#4A6080' }}>To</div>
              <input type="date" value={form.period_end} onChange={e => setForm((f: any) => ({ ...f, period_end: e.target.value }))}
                className="rounded-md px-3 py-[7px] text-[12px] outline-none" style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }} />
            </div>
            <div className="flex-1 min-w-[220px]">
              <div className="text-[10px] mb-1" style={{ color: '#4A6080' }}>Product</div>
              <select value={form.product_sku} onChange={e => setForm((f: any) => ({ ...f, product_sku: e.target.value }))}
                className="w-full rounded-md px-3 py-[7px] text-[12px] outline-none" style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}>
                <option value="">Select product…</option>
                {products.filter((p, i, arr) => arr.findIndex((x: any) => x.product_sku === p.product_sku) === i).map((p: any) => (
                  <option key={p.product_sku} value={p.product_sku}>{p.product_sku} — {p.product_name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            {(['tk', 'mt'] as const).map(pk => (
              <div key={pk} className="rounded-md p-3" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
                <div className="text-[11px] font-semibold mb-2" style={{ color: pk === 'tk' ? '#00E5FF' : '#F59E0B' }}>{pk === 'tk' ? 'TikTok' : 'Meta'}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div><div className="text-[9px] mb-[2px]" style={{ color: '#4A6080' }}>Spend (Rs)</div>{fld(form[pk], 'spend', '0')}</div>
                  <div><div className="text-[9px] mb-[2px]" style={{ color: '#4A6080' }}>Impressions</div>{fld(form[pk], 'impressions', '0')}</div>
                  <div><div className="text-[9px] mb-[2px]" style={{ color: '#4A6080' }}>Clicks</div>{fld(form[pk], 'clicks', '0')}</div>
                  <div><div className="text-[9px] mb-[2px]" style={{ color: '#4A6080' }}>Leads</div>{fld(form[pk], 'leads', '0')}</div>
                  <div><div className="text-[9px] mb-[2px]" style={{ color: '#4A6080' }}>Messages</div>{fld(form[pk], 'messages', '0')}</div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={saveEntry} disabled={saving}
            className="rounded-md px-4 py-[7px] text-[12px] font-semibold"
            style={{ background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.4)', color: '#10B981' }}>
            {saving ? 'Saving…' : 'Save Ad Data'}
          </button>

          {entries.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] tracking-[.08em] uppercase mb-2" style={{ color: '#3A5570' }}>Entered weeks ({entries.length})</div>
              <div className="max-h-[220px] overflow-y-auto">
                {entries.map(e => (
                  <div key={e.id} className="flex items-center gap-3 text-[11px] py-[5px]" style={{ borderBottom: '1px solid #12203300' }}>
                    <span className="mono" style={{ color: '#7288A8', minWidth: '150px' }}>{e.period_start} → {e.period_end}</span>
                    <span className="mono" style={{ color: '#00E5FF', minWidth: '70px' }}>{e.product_sku}</span>
                    <span style={{ color: e.platform === 'tiktok' ? '#00E5FF' : '#F59E0B', minWidth: '54px' }}>{e.platform}</span>
                    <span className="mono flex-1" style={{ color: '#8BA3C0' }}>Rs.{num(e.spend)} · {num(e.leads)} leads · {num(e.messages)} msg</span>
                    <button onClick={() => delEntry(e.id)} style={{ color: '#EF4444' }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <input className="w-full rounded-lg px-[14px] py-[9px] text-[13px] mb-3 outline-none"
        style={{ background: '#0D1B2A', border: '1px solid #1A2940', color: '#C8D8E8' }}
        placeholder="Search by product code or name..." value={search} onChange={e => setSearch(e.target.value)} />
      <div className="mb-4"><DateRangeFilter label="Week / Order Date" onFilter={(f, t) => { setDateFrom(f); setDateTo(t); }} onClear={() => { setDateFrom(''); setDateTo(''); }} /></div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Ad Spend', val: rs(totals.spend || 0), c: '#F59E0B' },
          { label: 'Revenue (delivered)', val: rs(totals.revenue || 0), c: '#10B981' },
          { label: 'Overall ROAS', val: div(totals.revenue, totals.spend) ? div(totals.revenue, totals.spend).toFixed(1) + '×' : '—', c: '#00E5FF' },
          { label: 'Avg Cost / Delivered', val: div(totals.spend, totals.delivered) ? rs(div(totals.spend, totals.delivered)) : '—', c: '#8ABBE0' },
        ].map(m => (
          <div key={m.label} className="rounded-[10px] p-[14px_16px]" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
            <div className="text-[19px] font-bold" style={{ color: m.c }}>{m.val}</div>
            <div className="text-[10px] tracking-[.08em] uppercase mt-1" style={{ color: '#4A6080' }}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Table header */}
      <div className="grid gap-[10px] px-4 py-[7px] text-[10px] tracking-[.08em] uppercase"
        style={{ gridTemplateColumns: '100px 1fr 90px 90px 100px 70px', color: '#2A4060' }}>
        <span>Code</span><span>Product</span><span className="text-right">Spend</span><span className="text-right">Delivered</span><span className="text-right">Cost/Del</span><span className="text-right">ROAS</span>
      </div>

      {loading && <div className="text-center py-10 text-[13px]" style={{ color: '#4A6080' }}>Loading…</div>}
      {!loading && shown.length === 0 && <div className="text-center py-12 text-[13px]" style={{ color: '#2A4060' }}>No products{term ? ' match your search' : ''}</div>}

      {!loading && shown.map(r => {
        const roas = div(r.revenue, r.ad.spend);
        const open = expanded === r.item_code;
        return (
          <div key={r.item_code} className="mb-[4px]">
            <div onClick={() => setExpanded(open ? null : r.item_code)}
              className="grid gap-[10px] px-4 py-[9px] rounded-lg items-center cursor-pointer"
              style={{ gridTemplateColumns: '100px 1fr 90px 90px 100px 70px', background: open ? '#0F2236' : '#0D1B2A', border: `1px solid ${open ? 'rgba(0,229,255,.25)' : '#1A2940'}` }}>
              <span className="mono text-[12px]" style={{ color: '#00E5FF' }}>{r.item_code}</span>
              <span className="text-[13px]" style={{ color: '#C8D8E8' }}>{r.product_name || '—'}</span>
              <span className="mono text-[13px] text-right" style={{ color: r.ad.spend ? '#F59E0B' : '#2A4060' }}>{r.ad.spend ? num(r.ad.spend) : '—'}</span>
              <span className="mono text-[13px] text-right" style={{ color: '#10B981' }}>{num(r.delivered)}</span>
              <span className="mono text-[13px] text-right" style={{ color: '#8ABBE0' }}>{r.ad.spend ? rs(div(r.ad.spend, r.delivered)) : '—'}</span>
              <span className="mono text-[13px] font-bold text-right" style={{ color: !r.ad.spend ? '#2A4060' : roas >= 1 ? '#10B981' : '#EF4444' }}>{r.ad.spend ? roas.toFixed(1) + '×' : '—'}</span>
            </div>

            {open && (
              <div className="rounded-b-lg px-5 py-4 animate-fadeIn" style={{ background: '#0F2236', border: '1px solid rgba(0,229,255,.25)', borderTop: 'none' }}>
                {r.ad.spend === 0 && (
                  <div className="text-[12px] mb-3" style={{ color: '#F59E0B' }}>No ad data entered for this product in this period — add it with “＋ Add / Edit Ad Data”.</div>
                )}
                {/* Funnel */}
                <div className="grid grid-cols-4 gap-3 mb-4">
                  {[
                    ['Impressions', num(r.ad.impressions)],
                    ['Clicks', `${num(r.ad.clicks)}  ·  CTR ${pct(r.ad.clicks, r.ad.impressions)}`],
                    ['Leads', `${num(r.ad.leads)}  ·  ${r.ad.leads ? rs(div(r.ad.spend, r.ad.leads)) + '/lead' : ''}`],
                    ['New Messages', `${num(r.ad.messages)}  ·  ${r.ad.messages ? rs(div(r.ad.spend, r.ad.messages)) + '/msg' : ''}`],
                    ['Orders', `${num(r.orders)}  ·  ${r.ad.spend ? rs(div(r.ad.spend, r.orders)) + '/order' : ''}`],
                    ['Delivered', `${num(r.delivered)}  ·  ${pct(r.delivered, r.orders)} of orders`],
                    ['Returned', `${num(r.returned)}  ·  ${pct(r.returned, r.delivered)}`],
                    ['Revenue', rs(r.revenue)],
                  ].map(([l, v]) => (
                    <div key={l as string} className="rounded-md p-[10px]" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
                      <div className="text-[10px] uppercase tracking-[.06em]" style={{ color: '#4A6080' }}>{l}</div>
                      <div className="text-[13px] mono mt-[2px]" style={{ color: '#C8D8E8' }}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* Money line */}
                <div className="flex gap-5 flex-wrap text-[12px] mb-4">
                  <span style={{ color: '#F59E0B' }}>Spend: <b>{rs(r.ad.spend)}</b></span>
                  <span style={{ color: '#10B981' }}>Revenue: <b>{rs(r.revenue)}</b></span>
                  <span style={{ color: '#00E5FF' }}>ROAS: <b>{r.ad.spend ? div(r.revenue, r.ad.spend).toFixed(2) + '×' : '—'}</b></span>
                  <span style={{ color: '#8ABBE0' }}>Cost/Delivered: <b>{r.ad.spend ? rs(div(r.ad.spend, r.delivered)) : '—'}</b></span>
                  <span style={{ color: r.revenue - r.ad.spend >= 0 ? '#10B981' : '#EF4444' }}>Ad profit: <b>{rs(r.revenue - r.ad.spend)}</b></span>
                </div>

                {/* Platform split */}
                <div className="grid grid-cols-6 gap-[8px] px-3 py-[6px] text-[10px] uppercase tracking-[.06em]" style={{ color: '#3A5570' }}>
                  <span>Platform</span><span className="text-right">Spend</span><span className="text-right">Impr.</span><span className="text-right">Clicks</span><span className="text-right">Leads</span><span className="text-right">Cost/Lead</span>
                </div>
                {(['tiktok', 'meta'] as const).map(pk => {
                  const p = r.platforms[pk];
                  return (
                    <div key={pk} className="grid grid-cols-6 gap-[8px] px-3 py-[7px] text-[12px] mono rounded-md mb-[3px]" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
                      <span style={{ color: pk === 'tiktok' ? '#00E5FF' : '#F59E0B' }}>{pk === 'tiktok' ? 'TikTok' : 'Meta'}</span>
                      <span className="text-right" style={{ color: '#C8D8E8' }}>{num(p.spend)}</span>
                      <span className="text-right" style={{ color: '#8BA3C0' }}>{num(p.impressions)}</span>
                      <span className="text-right" style={{ color: '#8BA3C0' }}>{num(p.clicks)}</span>
                      <span className="text-right" style={{ color: '#8BA3C0' }}>{num(p.leads)}</span>
                      <span className="text-right" style={{ color: '#8ABBE0' }}>{p.leads ? rs(div(p.spend, p.leads)) : '—'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
