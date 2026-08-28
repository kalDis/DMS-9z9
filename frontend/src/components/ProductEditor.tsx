'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface P { id: number; product_sku: string; product_name: string; price: number | null; cost: number | null; }

// Admin editor for the product list — edit Name/Price/Cost (SKU fixed), add, delete.
export default function ProductEditor({ businessId }: { businessId: number | null }) {
  const [items, setItems] = useState<P[]>([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [neu, setNeu] = useState<any>({ product_sku: '', product_name: '', price: '', cost: '' });

  const load = () => {
    if (!businessId) { setItems([]); return; }
    api(`/settings/products/${businessId}`).then(d => setItems(d.products || [])).catch(() => {});
  };
  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, businessId]);

  const setField = (id: number, f: string, v: any) => setItems(list => list.map(p => (p.id === id ? { ...p, [f]: v } : p)));

  const save = async (p: P) => {
    setSavingId(p.id);
    try { await api(`/settings/product/${p.id}`, { method: 'PUT', body: JSON.stringify({ product_name: p.product_name, price: p.price, cost: p.cost }) }); }
    catch (err: any) { alert(err.message || 'Save failed'); }
    setSavingId(null);
  };

  const del = async (p: P) => {
    if (!confirm(`Delete product ${p.product_sku} — ${p.product_name}?`)) return;
    try { await api(`/settings/product/${p.id}`, { method: 'DELETE' }); load(); } catch (err: any) { alert(err.message); }
  };

  const add = async () => {
    if (!businessId || !neu.product_sku.trim() || !neu.product_name.trim()) { alert('SKU and Name are required'); return; }
    setAdding(true);
    try {
      await api(`/settings/product/${businessId}`, { method: 'POST', body: JSON.stringify(neu) });
      setNeu({ product_sku: '', product_name: '', price: '', cost: '' });
      load();
    } catch (err: any) { alert(err.message || 'Add failed'); }
    setAdding(false);
  };

  const term = search.trim().toLowerCase();
  const shown = term ? items.filter(p => p.product_sku.toLowerCase().includes(term) || (p.product_name || '').toLowerCase().includes(term)) : items;
  const inp = { background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' } as const;

  return (
    <div className="rounded-lg p-4 mb-5" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
      <button onClick={() => setOpen(o => !o)} className="text-[12px] font-semibold flex items-center gap-2" style={{ color: '#E8F4FF' }}>
        <span style={{ color: '#7288A8' }}>{open ? '▾' : '▸'}</span> Edit products manually {items.length > 0 && open ? `(${items.length})` : ''}
      </button>

      {open && (
        <div className="mt-3">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product code or name…"
            className="w-full rounded-md px-3 py-[7px] text-[12px] outline-none mb-3" style={inp} />

          {/* Add new */}
          <div className="flex gap-2 items-end mb-3 flex-wrap">
            <div><div className="text-[9px] mb-[2px]" style={{ color: '#4A6080' }}>New SKU</div>
              <input value={neu.product_sku} onChange={e => setNeu({ ...neu, product_sku: e.target.value })} placeholder="TY-100" className="rounded-md px-2 py-[6px] text-[12px] outline-none mono" style={{ ...inp, width: '90px' }} /></div>
            <div className="flex-1 min-w-[140px]"><div className="text-[9px] mb-[2px]" style={{ color: '#4A6080' }}>Name</div>
              <input value={neu.product_name} onChange={e => setNeu({ ...neu, product_name: e.target.value })} placeholder="Product name" className="w-full rounded-md px-2 py-[6px] text-[12px] outline-none" style={inp} /></div>
            <div><div className="text-[9px] mb-[2px]" style={{ color: '#4A6080' }}>Price</div>
              <input type="number" value={neu.price} onChange={e => setNeu({ ...neu, price: e.target.value })} placeholder="0" className="rounded-md px-2 py-[6px] text-[12px] outline-none mono" style={{ ...inp, width: '80px' }} /></div>
            <div><div className="text-[9px] mb-[2px]" style={{ color: '#4A6080' }}>Cost</div>
              <input type="number" value={neu.cost} onChange={e => setNeu({ ...neu, cost: e.target.value })} placeholder="0" className="rounded-md px-2 py-[6px] text-[12px] outline-none mono" style={{ ...inp, width: '80px' }} /></div>
            <button onClick={add} disabled={adding} className="rounded-md px-3 py-[7px] text-[12px] font-semibold" style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', color: '#00E5FF' }}>{adding ? '…' : '＋ Add'}</button>
          </div>

          {/* header */}
          <div className="flex items-center gap-2 px-1 text-[9px] uppercase tracking-[.06em]" style={{ color: '#3A5570' }}>
            <span style={{ width: '90px' }}>Code</span><span style={{ flex: 1, minWidth: '140px' }}>Name</span><span style={{ width: '80px' }}>Price</span><span style={{ width: '80px' }}>Cost</span><span style={{ width: '96px' }}></span>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {shown.map(p => (
              <div key={p.id} className="flex items-center gap-2 px-1 py-[3px]">
                <span className="mono text-[12px]" style={{ width: '90px', color: '#00E5FF' }}>{p.product_sku}</span>
                <input value={p.product_name ?? ''} onChange={e => setField(p.id, 'product_name', e.target.value)} className="rounded-md px-2 py-[6px] text-[12px] outline-none" style={{ ...inp, flex: 1, minWidth: '140px' }} />
                <input type="number" value={p.price ?? ''} onChange={e => setField(p.id, 'price', e.target.value === '' ? null : Number(e.target.value))} className="rounded-md px-2 py-[6px] text-[12px] outline-none mono" style={{ ...inp, width: '80px' }} />
                <input type="number" value={p.cost ?? ''} onChange={e => setField(p.id, 'cost', e.target.value === '' ? null : Number(e.target.value))} className="rounded-md px-2 py-[6px] text-[12px] outline-none mono" style={{ ...inp, width: '80px' }} />
                <button onClick={() => save(p)} disabled={savingId === p.id} className="rounded-md px-2 py-[6px] text-[11px] font-semibold" style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.3)', color: '#10B981' }}>{savingId === p.id ? '…' : 'Save'}</button>
                <button onClick={() => del(p)} className="text-[13px]" style={{ color: '#EF4444', width: '20px' }}>✕</button>
              </div>
            ))}
            {shown.length === 0 && <div className="text-[12px] py-3" style={{ color: '#2A4060' }}>No products{term ? ' match' : ' — upload a list or add one above'}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
