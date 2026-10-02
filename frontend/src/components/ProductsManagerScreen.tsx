'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import ProductEditor from './ProductEditor';
import ProductUploadModal from './ProductUploadModal';

// Dedicated Products section — manage the product catalog for the active business:
// manual add / edit / delete (ProductEditor), bulk Excel upload, and export.
// Available to admin + issue_handler (business-scoped server-side).
export default function ProductsManagerScreen() {
  const { activeBusiness } = useAuth();
  const [count, setCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [editorKey, setEditorKey] = useState(0); // bump to remount ProductEditor after upload

  const bizId = activeBusiness?.id ?? null;

  const loadCount = () => {
    if (!bizId) { setCount(null); return; }
    api(`/settings/products/${bizId}`).then(d => setCount(d.count ?? (d.products?.length || 0))).catch(() => setCount(null));
  };
  useEffect(() => { loadCount(); /* eslint-disable-next-line */ }, [bizId, editorKey]);

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
          <button onClick={() => setShowUpload(true)} disabled={!bizId}
            className="rounded-md px-4 py-[7px] text-xs font-semibold"
            style={{ background: 'rgba(123,47,190,.08)', border: '1px solid rgba(123,47,190,.35)', color: bizId ? '#7B2FBE' : '#2A4060' }}>
            ⬆ Upload Excel
          </button>
        </div>
      </div>

      <div className="text-xs mb-3" style={{ color: '#4A6080' }}>
        Add products one at a time below, or bulk-upload an Excel — you'll <b style={{ color: '#8BA3C0' }}>map your columns</b> to the product fields, so any header layout works. Upload replaces the whole list for this business. Export downloads the current list (also works as a re-upload template).
      </div>
      {msg && <div className="text-[12px] mb-3" style={{ color: msg.startsWith('✓') ? '#10B981' : '#EF4444' }}>{msg}</div>}

      {!activeBusiness ? (
        <div className="text-center py-20 text-[13px]" style={{ color: '#4A6080' }}>Select a business to manage its products.</div>
      ) : (
        <ProductEditor key={editorKey} businessId={bizId} embedded />
      )}

      {showUpload && activeBusiness && (
        <ProductUploadModal
          businessId={activeBusiness.id}
          businessName={activeBusiness.name}
          onClose={() => setShowUpload(false)}
          onComplete={() => { setMsg('✓ Product list uploaded'); setEditorKey(k => k + 1); }}
        />
      )}
    </div>
  );
}
