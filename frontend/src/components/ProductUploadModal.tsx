'use client';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';

interface Props {
  businessId: number;
  businessName?: string;
  onClose: () => void;
  onComplete: () => void;
}

interface SheetInfo { name: string; headers: { col: number; name: string }[]; row_count: number; }
type Step = 'select' | 'sheets' | 'mapping' | 'preview' | 'result';

const FIELDS: { key: string; label: string; required: boolean }[] = [
  { key: 'product_sku', label: 'Product SKU', required: true },
  { key: 'product_name', label: 'Product Name', required: true },
  { key: 'variant_sku', label: 'Variant SKU', required: false },
  { key: 'price', label: 'Price', required: false },
  { key: 'cost', label: 'Cost', required: false },
];
const GUESS: Record<string, string[]> = {
  product_sku: ['product sku', 'product_sku', 'sku', 'code', 'product code', 'item code', 'item_code'],
  product_name: ['product name', 'product_name', 'name', 'product', 'item name', 'description'],
  variant_sku: ['variant sku', 'variant_sku', 'variant', 'variantsku'],
  price: ['price', 'selling price', 'retail price', 'rate', 'amount', 'mrp'],
  cost: ['cost', 'unit cost', 'avg cost', 'average cost', 'buying price', 'cost price'],
};

const ACCENT = '#7B2FBE';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export default function ProductUploadModal({ businessId, businessName, onClose, onComplete }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('select');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fileId, setFileId] = useState('');
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [activeHeaders, setActiveHeaders] = useState<{ col: number; name: string }[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);

  const autoGuess = (headers: { col: number; name: string }[]) => {
    const m: Record<string, string> = {};
    for (const f of FIELDS) {
      const guesses = GUESS[f.key] || [];
      const hit = headers.find(h => guesses.includes(h.name.toLowerCase().trim()));
      if (hit) m[f.key] = hit.name;
    }
    return m;
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name); setError(''); setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('dms_token');
      const res = await fetch(`${API}/upload/headers`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not read file');
      setFileId(data.file_id);
      setSheets(data.sheets);
      if (data.sheets.length === 1) pickSheet(data.sheets[0]);
      else setStep('sheets');
    } catch (err: any) { setError(err.message); }
    setLoading(false);
    e.target.value = '';
  };

  const pickSheet = (s: SheetInfo) => {
    setSelectedSheet(s.name);
    setActiveHeaders(s.headers);
    setMappings(autoGuess(s.headers));
    setStep('mapping');
  };

  const runPreview = async () => {
    if (!mappings.product_sku || !mappings.product_name) { setError('Map Product SKU and Product Name first'); return; }
    setError(''); setLoading(true);
    try {
      const data = await api(`/settings/products/${businessId}/preview-upload`, {
        method: 'POST', body: JSON.stringify({ file_id: fileId, sheet_name: selectedSheet, mappings }),
      });
      setPreview(data);
      setStep('preview');
    } catch (err: any) { setError(err.message || 'Preview failed'); }
    setLoading(false);
  };

  const runImport = async () => {
    setLoading(true); setError('');
    try {
      const data = await api(`/settings/products/${businessId}/import-mapped`, {
        method: 'POST', body: JSON.stringify({ file_id: fileId, sheet_name: selectedSheet, mappings }),
      });
      setResult(data);
      setStep('result');
    } catch (err: any) { setError(err.message || 'Import failed'); }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)' }}>
      <div className="w-full max-w-lg rounded-xl relative overflow-hidden animate-fadeIn max-h-[90vh] flex flex-col"
        style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)` }} />
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid #1A2940' }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: '#E8F4FF' }}>Upload Product List</div>
            <div className="text-[11px] mt-1" style={{ color: '#4A6080' }}>
              {businessName || ''}{fileName ? ` · ${fileName}` : ''}{selectedSheet ? ` · ${selectedSheet}` : ''}
            </div>
          </div>
          <button onClick={onClose} className="text-lg" style={{ color: '#4A6080' }}>✕</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {error && (
            <div className="rounded-lg p-3 mb-4 text-xs font-semibold" style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#EF4444' }}>{error}</div>
          )}

          {step === 'select' && (
            <>
              <div onClick={() => fileRef.current?.click()} className="rounded-lg p-8 text-center cursor-pointer" style={{ border: '2px dashed #1A2940', background: '#080D1A' }}>
                <div className="text-2xl mb-2">▣</div>
                <div className="text-sm mb-1" style={{ color: '#C8D8E8' }}>{loading ? 'Reading file...' : 'Click to choose an Excel / CSV'}</div>
                <div className="text-[11px]" style={{ color: '#2A4060' }}>You'll map the columns on the next step. Import replaces the whole list for this business.</div>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
            </>
          )}

          {step === 'sheets' && (
            <>
              <div className="text-xs mb-3" style={{ color: '#4A6080' }}>This file has {sheets.length} sheets. Pick which to import:</div>
              <div className="space-y-2">
                {sheets.map(s => (
                  <button key={s.name} onClick={() => pickSheet(s)} className="w-full rounded-lg px-4 py-3 text-left" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                    <div className="text-[13px] font-semibold" style={{ color: '#C8D8E8' }}>{s.name}</div>
                    <div className="text-[11px] mt-1" style={{ color: '#2A4060' }}>{s.row_count} rows · {s.headers.length} columns</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 'mapping' && (
            <>
              <div className="rounded-lg p-3 mb-4 text-xs" style={{ background: 'rgba(123,47,190,.06)', border: '1px solid rgba(123,47,190,.15)', color: '#8BA3C0' }}>
                Match your file's columns to the product fields. <b style={{ color: '#C8D8E8' }}>Product SKU</b> and <b style={{ color: '#C8D8E8' }}>Product Name</b> are required.
              </div>
              <div className="space-y-[8px] mb-4">
                {FIELDS.map(f => (
                  <div key={f.key} className="flex items-center gap-3">
                    <div className="w-[120px] shrink-0 text-xs text-right" style={{ color: f.required ? '#E8F4FF' : '#4A6080' }}>
                      {f.label}{f.required ? <span style={{ color: '#EF4444' }}> *</span> : ''}
                    </div>
                    <div className="text-[11px]" style={{ color: '#2A4060' }}>→</div>
                    <select value={mappings[f.key] || ''} onChange={e => setMappings({ ...mappings, [f.key]: e.target.value })}
                      className="flex-1 rounded-md px-3 py-[7px] text-[12px] outline-none"
                      style={{ background: '#080D1A', border: `1px solid ${mappings[f.key] ? `${ACCENT}66` : '#1A2940'}`, color: mappings[f.key] ? '#C8D8E8' : '#2A4060' }}>
                      <option value="">— Skip —</option>
                      {activeHeaders.map(h => <option key={h.col} value={h.name}>{h.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                {sheets.length > 1 && (
                  <button onClick={() => setStep('sheets')} className="rounded-md px-4 py-2 text-xs font-semibold" style={{ background: 'transparent', border: '1px solid #1A2940', color: '#4A6080' }}>Back</button>
                )}
                <button onClick={runPreview} disabled={loading || !mappings.product_sku || !mappings.product_name}
                  className="flex-1 rounded-md py-2 text-xs font-semibold"
                  style={{ background: `${ACCENT}22`, border: `1px solid ${ACCENT}66`, color: (mappings.product_sku && mappings.product_name) ? '#C8A6E8' : '#4A6080' }}>
                  {loading ? 'Reading...' : 'Preview'}
                </button>
              </div>
            </>
          )}

          {step === 'preview' && preview && (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-lg p-3 text-center" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                  <div className="mono text-lg font-bold" style={{ color: '#10B981' }}>{preview.valid}</div>
                  <div className="text-[10px] uppercase" style={{ color: '#4A6080' }}>Products</div>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                  <div className="mono text-lg font-bold" style={{ color: '#00E5FF' }}>{preview.with_price}</div>
                  <div className="text-[10px] uppercase" style={{ color: '#4A6080' }}>With Price</div>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                  <div className="mono text-lg font-bold" style={{ color: '#F59E0B' }}>{preview.with_cost}</div>
                  <div className="text-[10px] uppercase" style={{ color: '#4A6080' }}>With Cost</div>
                </div>
              </div>

              {preview.skipped > 0 && (
                <div className="rounded-md p-2 mb-3 text-[11px]" style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)', color: '#F59E0B' }}>
                  ⚠ {preview.skipped} row(s) will be skipped (missing SKU or Name).
                </div>
              )}

              {preview.sample?.length > 0 && (
                <div className="rounded-lg overflow-hidden mb-3" style={{ border: '1px solid #1A2940' }}>
                  <div className="grid gap-2 px-3 py-[6px] text-[9px] uppercase tracking-[.06em]" style={{ gridTemplateColumns: '80px 1fr 60px 60px', color: '#3A5570', background: '#080D1A' }}>
                    <span>SKU</span><span>Name</span><span className="text-right">Price</span><span className="text-right">Cost</span>
                  </div>
                  {preview.sample.map((r: any, i: number) => (
                    <div key={i} className="grid gap-2 px-3 py-[5px] text-[11px]" style={{ gridTemplateColumns: '80px 1fr 60px 60px', borderTop: '1px solid #122033' }}>
                      <span className="mono" style={{ color: '#00E5FF' }}>{r.sku}</span>
                      <span style={{ color: '#C8D8E8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                      <span className="mono text-right" style={{ color: '#8BA3C0' }}>{r.price ?? '—'}</span>
                      <span className="mono text-right" style={{ color: '#8BA3C0' }}>{r.cost ?? '—'}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-md p-2 mb-4 text-[11px]" style={{ background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)', color: '#EF4444' }}>
                This replaces the entire product list for <b>{businessName}</b> with these {preview.valid} products.
              </div>

              <div className="flex gap-2">
                <button onClick={() => setStep('mapping')} className="rounded-md px-4 py-2 text-xs font-semibold" style={{ background: 'transparent', border: '1px solid #1A2940', color: '#4A6080' }}>Back to mapping</button>
                <button onClick={runImport} disabled={loading || !preview.valid} className="flex-1 rounded-md py-2 text-xs font-semibold" style={{ background: `${ACCENT}22`, border: `1px solid ${ACCENT}66`, color: preview.valid ? '#C8A6E8' : '#4A6080' }}>
                  {loading ? 'Importing...' : `Import ${preview.valid} products`}
                </button>
              </div>
            </>
          )}

          {step === 'result' && result && (
            <div className="text-center py-4">
              <div className="text-3xl mb-3">✓</div>
              <div className="text-lg font-bold mb-4" style={{ color: '#10B981' }}>Products Uploaded</div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-lg p-3" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                  <div className="mono text-xl font-bold" style={{ color: '#10B981' }}>{result.imported}</div>
                  <div className="text-[10px] uppercase mt-1" style={{ color: '#4A6080' }}>Products</div>
                </div>
                <div className="rounded-lg p-3" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                  <div className="mono text-xl font-bold" style={{ color: '#F59E0B' }}>{result.costs_imported}</div>
                  <div className="text-[10px] uppercase mt-1" style={{ color: '#4A6080' }}>Costs</div>
                </div>
              </div>
              <button onClick={() => { onComplete(); onClose(); }} className="w-full rounded-md py-2 text-xs font-semibold" style={{ background: `${ACCENT}22`, border: `1px solid ${ACCENT}66`, color: '#C8A6E8' }}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
