'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import ProductEditor from './ProductEditor';

// Dedicated Products section — manage the product catalog for the active business:
// manual add / edit / delete (ProductEditor), bulk Excel upload, and export.
// Available to admin + issue_handler (business-scoped server-side).
export default function ProductsManagerScreen() {
  const { activeBusiness } = useAuth();
  const [count, setCount] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState('');
  const [editorKey, setEditorKey] = useState(0); // bump to remount ProductEditor after upload

  const bizId = activeBusiness?.id ?? null;

  const loadCount = () => {
    if (!bizId) { setCount(null); return; }
    api(`/settings/products/${bizId}`).then(d => setCount(d.count ?? (d.products?.length || 0))).catch(() => setCount(null));
  };
  useEffect(() => { loadCount(); /* eslint-disable-next-line */ }, [bizId, editorKey]);

  const uploadProducts = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !bizId) return;
    if (!confirm('Uploading replaces the entire product list for this business. Continue?')) { e.target.value = ''; return; }
    setUploading(true); setMsg('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('dms_token');
      const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
      const res = await fetch(`${API}/settings/products/${bizId}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setMsg(`✓ Uploaded ${data.imported ?? 0} products${data.costs_imported ? `, ${data.costs_imported} costs` : ''}`);
      setEditorKey(k => k + 1);
    } catch (err: any) { setMsg('✕ ' + (err.message || 'Upload failed')); }
    setUploading(false); e.target.value = '';
  };

  const exportProducts = async () => {
    if (!bizId) return;
    setExporting(true);
    try {
      const token = localStorage.getItem('dms_token');
      const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
      const res = await fetch(`${API}/settings/products/${bizId}/export`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DMS_Products_${new Date().toISOString().split('T')[0]}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { setMsg('✕ Export failed'); }
    setExporting(false);
  };

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-[22px] flex-wrap gap-3">
        <div>
          <div className="text-[10px] tracking-[.1em] uppercase" style={{ color: '#4A6080' }}>Catalog</div>
          <div className="text-xl font-bold mt-[2px]" style={{ color: '#E8F4FF' }}>
            Products{activeBusiness ? <span className="text-[13px] font-normal" style={{ color: '#4A6080' }}> · {activeBusiness.name}</span> : ''}
            {count != null && <span className="mono text-[13px] font-normal" style={{ color: '#00E5FF' }}> ({count})</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={exportProducts} disabled={exporting || !bizId || !count}
            className="rounded-md px-4 py-[7px] text-xs font-semibold"
            style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.3)', color: (count && bizId) ? '#10B981' : '#2A4060' }}>
            {exporting ? 'Exporting…' : '⬇ Export to Excel'}
          </button>
          <label className="rounded-md px-4 py-[7px] text-xs font-semibold cursor-pointer"
            style={{ background: 'rgba(123,47,190,.08)', border: '1px solid rgba(123,47,190,.35)', color: '#7B2FBE', opacity: uploading ? 0.6 : 1 }}>
            {uploading ? 'Uploading…' : '⬆ Upload Excel'}
            <input type="file" accept=".xlsx,.xls,.csv" onChange={uploadProducts} className="hidden" disabled={uploading || !bizId} />
          </label>
        </div>
      </div>

      <div className="text-xs mb-3" style={{ color: '#4A6080' }}>
        Add products one at a time below, or bulk-upload an Excel (columns: Product SKU, Product Name, Variant SKU, Price, optional Unit cost). Upload replaces the whole list for this business. Export downloads the current list (also works as a re-upload template).
      </div>
      {msg && <div className="text-[12px] mb-3" style={{ color: msg.startsWith('✓') ? '#10B981' : '#EF4444' }}>{msg}</div>}

      {!activeBusiness ? (
        <div className="text-center py-20 text-[13px]" style={{ color: '#4A6080' }}>Select a business to manage its products.</div>
      ) : (
        <ProductEditor key={editorKey} businessId={bizId} embedded />
      )}
    </div>
  );
}
