'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import DateRangeFilter from './DateRangeFilter';

interface Plat { spend: number; impressions: number; clicks: number; leads: number; messages: number; }
interface Row {
  item_code: string; product_name: string; price: number; cost: number;
  orders: number; delivered: number; returned: number; revenue: number;
  cogs: number; true_profit: number;
  ad: Plat; platforms: { tiktok: Plat; meta: Plat };
}

const rs = (n: number) => 'Rs. ' + Math.round(n).toLocaleString();
const num = (n: number) => Math.round(n).toLocaleString();
const div = (a: number, b: number) => (b > 0 ? a / b : 0);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) + '%' : '—');

export default function AdRoiScreen() {
  const { activeBusiness } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<any>({ spend: 0, revenue: 0, cogs: 0, true_profit: 0, delivered: 0, returned: 0, leads: 0, tracked: 0 });
  const [hasCosts, setHasCosts] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // entry panel — row-by-row grid
  const [showEntry, setShowEntry] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [topFrom, setTopFrom] = useState('');
  const [topTo, setTopTo] = useState('');
  const [usePlat, setUsePlat] = useState<{ tiktok: boolean; meta: boolean }>({ tiktok: true, meta: false });
  const emptyRow = () => ({ key: Math.random().toString(36).slice(2), product_sku: '', product_label: '', from: '', to: '', exp: false, tiktok: {} as any, meta: {} as any });
  const [entryRows, setEntryRows] = useState<any[]>([emptyRow()]);
  const [showEntries, setShowEntries] = useState(false);

  const load = () => {
    if (!activeBusiness) return;
    setLoading(true);
    const p = new URLSearchParams();
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    api(`/ads/${activeBusiness.id}/report?${p}`).then(d => {
      setRows(d.rows || []); setTotals(d.totals || {}); setHasCosts(d.has_costs !== false);
    }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeBusiness, dateFrom, dateTo]);

  const loadEntryData = () => {
    if (!activeBusiness) return;
    api(`/settings/products/${activeBusiness.id}`).then(d => setProducts(d.products || [])).catch(() => {});
    api(`/ads/${activeBusiness.id}`).then(setEntries).catch(() => {});
  };
  useEffect(() => { if (showEntry) loadEntryData(); /* eslint-disable-next-line */ }, [showEntry, activeBusiness]);

  const activePlats = () => (['tiktok', 'meta'] as const).filter(p => usePlat[p]);
  const setCell = (rk: string, plat: 'tiktok' | 'meta', field: string, val: string) =>
    setEntryRows(rs => rs.map(r => (r.key === rk ? { ...r, [plat]: { ...r[plat], [field]: val } } : r)));
  const setRowField = (rk: string, field: string, val: any) =>
    setEntryRows(rs => rs.map(r => (r.key === rk ? { ...r, [field]: val } : r)));
  const addRow = () => setEntryRows(rs => [...rs, emptyRow()]);
  const removeRow = (rk: string) => setEntryRows(rs => (rs.length > 1 ? rs.filter(r => r.key !== rk) : rs));

  // Resolve typed text (code or name, or "SKU — Name") to a product SKU
  const resolveSku = (text: string) => {
    const t = text.trim().toLowerCase();
    if (!t) return '';
    const p = products.find((x: any) => `${x.product_sku} — ${x.product_name}`.toLowerCase() === t)
      || products.find((x: any) => x.product_sku.toLowerCase() === t)
      || products.find((x: any) => (x.product_name || '').toLowerCase() === t);
    return p ? p.product_sku : '';
  };
  const setProduct = (rk: string, text: string) =>
    setEntryRows(rs => rs.map(r => (r.key === rk ? { ...r, product_label: text, product_sku: resolveSku(text) } : r)));
  const dedupProducts = products.filter((p, i, arr) => arr.findIndex((x: any) => x.product_sku === p.product_sku) === i);

  const saveAll = async () => {
    if (!activeBusiness) return;
    const plats = activePlats();
    if (!plats.length) { alert('Select at least one platform'); return; }
    const items: any[] = [];
    for (const r of entryRows) {
      if (!r.product_sku) {
        if ((r.product_label || '').trim()) { alert(`"${r.product_label}" is not a product in your list — pick one from the suggestions.`); return; }
        continue;
      }
      const ps = r.from || topFrom, pe = r.to || topTo;
      if (!ps || !pe) { alert('Set a From–To date range (top, or per row for a specific row)'); return; }
      if (pe < ps) { alert('A row has its End date before its Start date'); return; }
      for (const plat of plats) {
        const d = r[plat] || {};
        if (!['spend', 'leads', 'messages', 'impressions', 'clicks'].some(f => d[f])) continue;
        items.push({ product_sku: r.product_sku, platform: plat, period_start: ps, period_end: pe, spend: d.spend, leads: d.leads, messages: d.messages, impressions: d.impressions, clicks: d.clicks });
      }
    }
    if (!items.length) { alert('Nothing to save — add a product and some numbers'); return; }
    setSaving(true);
    try {
      const dups: any[] = [];
      for (const it of items) { const res = await api(`/ads/${activeBusiness.id}`, { method: 'POST', body: JSON.stringify(it) }); if (res?.duplicate) dups.push(it); }
      if (dups.length) {
        if (confirm(`${dups.length} entr${dups.length === 1 ? 'y' : 'ies'} already exist for the same product · platform · date range. Overwrite with the new numbers?`)) {
          for (const it of dups) await api(`/ads/${activeBusiness.id}`, { method: 'POST', body: JSON.stringify({ ...it, force: true }) });
        }
      }
      setEntryRows([emptyRow()]);
      loadEntryData(); load();
      alert(`Saved ${items.length} entr${items.length === 1 ? 'y' : 'ies'}`);
    } catch (err: any) { alert(err.message || 'Failed'); }
    setSaving(false);
  };

  // small number input for the grid
  const cell = (rk: string, plat: 'tiktok' | 'meta', field: string, ph: string, width = '72px') => {
    const r = entryRows.find(x => x.key === rk);
    return (
      <input type="number" value={r?.[plat]?.[field] ?? ''} placeholder={ph}
        onChange={e => setCell(rk, plat, field, e.target.value)}
        className="rounded-md px-2 py-[6px] text-[12px] outline-none mono"
        style={{ width, background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }} />
    );
  };

  const delEntry = async (id: number) => {
    if (!confirm('Delete this entry?')) return;
    try { await api(`/ads/entry/${id}`, { method: 'DELETE' }); loadEntryData(); load(); } catch (err: any) { alert(err.message); }
  };

  const term = search.trim().toLowerCase();
  const filtered = term ? rows.filter(r => r.item_code.toLowerCase().includes(term) || (r.product_name || '').toLowerCase().includes(term)) : rows;

  const sortVal = (r: Row): number | string => {
    switch (sortKey) {
      case 'code': return r.item_code.toLowerCase();
      case 'product': return (r.product_name || '').toLowerCase();
      case 'spend': return r.ad.spend;
      case 'delivered': return r.delivered;
      case 'roas': return r.ad.spend ? r.revenue / r.ad.spend : -1;
      case 'profit': return r.ad.spend ? (hasCosts ? r.true_profit : r.revenue - r.ad.spend) : -Infinity;
      default: return 0;
    }
  };
  const shown = [...filtered].sort((a, b) => {
    const va = sortVal(a), vb = sortVal(b);
    const c = typeof va === 'string' ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
    return sortDir === 'asc' ? c : -c;
  });
  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'code' || key === 'product' ? 'asc' : 'desc'); }
  };
  const arrow = (key: string) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

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
          <div className="text-[12px] font-semibold mb-1" style={{ color: '#E8F4FF' }}>Add ad data</div>
          <div className="text-[11px] mb-3" style={{ color: '#6A8AA8' }}>Set the date range + platform, then add a row per product. Click a row (▸) to add impressions/clicks or a different date for that row.</div>

          {/* Top controls: date range + platform */}
          <div className="flex gap-3 mb-3 flex-wrap items-end">
            <div>
              <div className="text-[10px] mb-1" style={{ color: '#4A6080' }}>From</div>
              <input type="date" value={topFrom} onChange={e => setTopFrom(e.target.value)}
                className="rounded-md px-3 py-[7px] text-[12px] outline-none" style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }} />
            </div>
            <div>
              <div className="text-[10px] mb-1" style={{ color: '#4A6080' }}>To</div>
              <input type="date" value={topTo} onChange={e => setTopTo(e.target.value)}
                className="rounded-md px-3 py-[7px] text-[12px] outline-none" style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }} />
            </div>
            <div>
              <div className="text-[10px] mb-1" style={{ color: '#4A6080' }}>Platform</div>
              <div className="flex gap-[6px]">
                {(['tiktok', 'meta'] as const).map(pl => (
                  <button key={pl} onClick={() => setUsePlat(u => ({ ...u, [pl]: !u[pl] }))}
                    className="rounded-md px-3 py-[6px] text-[12px] font-semibold flex items-center gap-1"
                    style={{
                      background: usePlat[pl] ? (pl === 'tiktok' ? 'rgba(0,229,255,.1)' : 'rgba(245,158,11,.1)') : 'transparent',
                      border: `1px solid ${usePlat[pl] ? (pl === 'tiktok' ? 'rgba(0,229,255,.4)' : 'rgba(245,158,11,.4)') : '#1A2940'}`,
                      color: usePlat[pl] ? (pl === 'tiktok' ? '#00E5FF' : '#F59E0B') : '#4A6080',
                    }}>
                    {usePlat[pl] ? '✓' : '＋'} {pl === 'tiktok' ? 'TikTok' : 'Meta'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <datalist id="ad-product-list">
            {dedupProducts.map((p: any) => (<option key={p.product_sku} value={`${p.product_sku} — ${p.product_name}`} />))}
          </datalist>

          {/* Rows */}
          <div className="overflow-x-auto">
            <div style={{ minWidth: usePlat.tiktok && usePlat.meta ? '760px' : '460px' }}>
              {/* header */}
              <div className="flex items-center gap-2 px-1 py-1 text-[9px] uppercase tracking-[.06em]" style={{ color: '#3A5570' }}>
                <span style={{ width: '24px' }}></span>
                <span style={{ flex: 1, minWidth: '160px' }}>Product</span>
                {activePlats().map(pl => (
                  <span key={pl} className="flex gap-2" style={{ color: pl === 'tiktok' ? '#00E5FF' : '#F59E0B' }}>
                    <span style={{ width: '72px' }}>{pl === 'tiktok' ? 'TT' : 'Meta'} Amount</span>
                    <span style={{ width: '72px' }}>Leads</span>
                    <span style={{ width: '72px' }}>Msg</span>
                  </span>
                ))}
                <span style={{ width: '24px' }}></span>
              </div>

              {entryRows.map(r => (
                <div key={r.key}>
                  <div className="flex items-center gap-2 px-1 py-[3px]">
                    <button onClick={() => setRowField(r.key, 'exp', !r.exp)} style={{ width: '24px', color: r.exp ? '#00E5FF' : '#4A6080' }}>{r.exp ? '▾' : '▸'}</button>
                    <input list="ad-product-list" value={r.product_label} onChange={e => setProduct(r.key, e.target.value)}
                      placeholder="Search product code or name…"
                      className="rounded-md px-2 py-[6px] text-[12px] outline-none"
                      style={{ flex: 1, minWidth: '160px', background: '#080D1A', border: `1px solid ${r.product_label && !r.product_sku ? 'rgba(239,68,68,.4)' : '#1A2940'}`, color: '#C8D8E8' }} />
                    {activePlats().map(pl => (
                      <span key={pl} className="flex gap-2">
                        {cell(r.key, pl, 'spend', 'Amount')}
                        {cell(r.key, pl, 'leads', 'Leads')}
                        {cell(r.key, pl, 'messages', 'Msg')}
                      </span>
                    ))}
                    <button onClick={() => removeRow(r.key)} style={{ width: '24px', color: '#EF4444' }}>✕</button>
                  </div>
                  {r.exp && (
                    <div className="ml-[26px] mb-2 mt-1 rounded-md p-3" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
                      <div className="flex gap-4 flex-wrap items-end">
                        {activePlats().map(pl => (
                          <div key={pl}>
                            <div className="text-[10px] mb-1" style={{ color: pl === 'tiktok' ? '#00E5FF' : '#F59E0B' }}>{pl === 'tiktok' ? 'TikTok' : 'Meta'} extra</div>
                            <div className="flex gap-2">
                              <div><div className="text-[9px] mb-[2px]" style={{ color: '#4A6080' }}>Impressions</div>{cell(r.key, pl, 'impressions', '0', '90px')}</div>
                              <div><div className="text-[9px] mb-[2px]" style={{ color: '#4A6080' }}>Clicks</div>{cell(r.key, pl, 'clicks', '0', '80px')}</div>
                            </div>
                          </div>
                        ))}
                        <div>
                          <div className="text-[10px] mb-1" style={{ color: '#4A6080' }}>This row's dates (optional — overrides top)</div>
                          <div className="flex gap-2">
                            <input type="date" value={r.from} onChange={e => setRowField(r.key, 'from', e.target.value)} className="rounded-md px-2 py-[6px] text-[12px] outline-none" style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }} />
                            <input type="date" value={r.to} onChange={e => setRowField(r.key, 'to', e.target.value)} className="rounded-md px-2 py-[6px] text-[12px] outline-none" style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 mt-3">
            <button onClick={addRow} className="rounded-md px-4 py-[7px] text-[12px] font-semibold" style={{ background: 'transparent', border: '1px solid #1A2940', color: '#8ABBE0' }}>＋ Add row</button>
            <button onClick={saveAll} disabled={saving} className="rounded-md px-4 py-[7px] text-[12px] font-semibold" style={{ background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.4)', color: '#10B981' }}>
              {saving ? 'Saving…' : 'Save All'}
            </button>
          </div>

          {entries.length > 0 && (
            <div className="mt-4">
              <button onClick={() => setShowEntries(s => !s)}
                className="text-[10px] tracking-[.08em] uppercase mb-2 flex items-center gap-1"
                style={{ color: '#7288A8' }}>
                <span>{showEntries ? '▾' : '▸'}</span> Entered ad data ({entries.length})
              </button>
              {showEntries && (
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
              )}
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
          { label: hasCosts ? 'True Profit' : 'Avg Cost / Delivered', val: hasCosts ? rs(totals.true_profit || 0) : (div(totals.spend, totals.delivered) ? rs(div(totals.spend, totals.delivered)) : '—'), c: (totals.true_profit || 0) >= 0 ? '#10B981' : '#EF4444' },
        ].map(m => (
          <div key={m.label} className="rounded-[10px] p-[14px_16px]" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
            <div className="text-[19px] font-bold" style={{ color: m.c }}>{m.val}</div>
            <div className="text-[10px] tracking-[.08em] uppercase mt-1" style={{ color: '#4A6080' }}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Table header */}
      <div className="grid gap-[10px] px-4 py-[7px] text-[10px] tracking-[.08em] uppercase"
        style={{ gridTemplateColumns: '90px 1fr 90px 80px 60px 110px', color: '#2A4060' }}>
        {([['code', 'Code', ''], ['product', 'Product', ''], ['spend', 'Spend', 'text-right'], ['delivered', 'Deliv.', 'text-right'], ['roas', 'ROAS', 'text-right'], ['profit', hasCosts ? 'True Profit' : 'Ad Profit', 'text-right']] as const).map(([k, label, align]) => (
          <span key={k} onClick={() => toggleSort(k)} className={`${align} cursor-pointer select-none hover:text-[#8ABBE0]`} style={{ color: sortKey === k ? '#00E5FF' : undefined }}>{label}{arrow(k)}</span>
        ))}
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
              style={{ gridTemplateColumns: '90px 1fr 90px 80px 60px 110px', background: open ? '#0F2236' : '#0D1B2A', border: `1px solid ${open ? 'rgba(0,229,255,.25)' : '#1A2940'}` }}>
              <span className="mono text-[12px]" style={{ color: '#00E5FF' }}>{r.item_code}</span>
              <span className="text-[13px]" style={{ color: '#C8D8E8' }}>{r.product_name || '—'}</span>
              <span className="mono text-[13px] text-right" style={{ color: r.ad.spend ? '#F59E0B' : '#2A4060' }}>{r.ad.spend ? num(r.ad.spend) : '—'}</span>
              <span className="mono text-[13px] text-right" style={{ color: '#10B981' }}>{num(r.delivered)}</span>
              <span className="mono text-[13px] font-bold text-right" style={{ color: !r.ad.spend ? '#2A4060' : roas >= 1 ? '#10B981' : '#EF4444' }}>{r.ad.spend ? roas.toFixed(1) + '×' : '—'}</span>
              <span className="mono text-[13px] font-bold text-right" style={{ color: !r.ad.spend ? '#2A4060' : (hasCosts ? r.true_profit : r.revenue - r.ad.spend) >= 0 ? '#10B981' : '#EF4444' }}>{r.ad.spend ? rs(hasCosts ? r.true_profit : r.revenue - r.ad.spend) : '—'}</span>
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
                  <span style={{ color: '#10B981' }}>Revenue: <b>{rs(r.revenue)}</b></span>
                  <span style={{ color: '#F59E0B' }}>Ad spend: <b>{rs(r.ad.spend)}</b></span>
                  {r.cost > 0 && <span style={{ color: '#7288A8' }}>Cost/unit: <b>{rs(r.cost)}</b> · COGS: <b>{rs(r.cogs)}</b></span>}
                  <span style={{ color: '#00E5FF' }}>ROAS: <b>{r.ad.spend ? div(r.revenue, r.ad.spend).toFixed(2) + '×' : '—'}</b></span>
                  {r.cost > 0
                    ? <span style={{ color: r.true_profit >= 0 ? '#10B981' : '#EF4444' }}>True profit: <b>{rs(r.true_profit)}</b> · margin {pct(r.true_profit, r.revenue)}</span>
                    : <span style={{ color: r.revenue - r.ad.spend >= 0 ? '#10B981' : '#EF4444' }}>Ad profit: <b>{rs(r.revenue - r.ad.spend)}</b> <span style={{ color: '#4A6080' }}>(no cost uploaded)</span></span>}
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
