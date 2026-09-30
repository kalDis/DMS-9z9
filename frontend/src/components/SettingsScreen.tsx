'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import ResolutionOptionsManager from './ResolutionOptionsManager';
import ProductEditor from './ProductEditor';

// Staff-facing settings — lets issue handlers manage resolution options AND
// products for the businesses they're assigned to (the Admin panel stays admin-only).
export default function SettingsScreen() {
  const { businesses, activeBusiness } = useAuth();
  const [bizId, setBizId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [productKey, setProductKey] = useState(0); // bump to force ProductEditor reload after upload

  useEffect(() => {
    if (!bizId) setBizId(activeBusiness?.id || businesses[0]?.id || null);
    // eslint-disable-next-line
  }, [activeBusiness, businesses]);

  const uploadProducts = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !bizId) return;
    if (!confirm('Uploading replaces the entire product list for this business. Continue?')) { e.target.value = ''; return; }
    setUploading(true);
    setUploadMsg('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('dms_token');
      const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
      const res = await fetch(`${API}/settings/products/${bizId}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setUploadMsg(`✓ Uploaded ${data.imported ?? 0} products${data.costs_imported ? `, ${data.costs_imported} costs` : ''}`);
      setProductKey(k => k + 1);
    } catch (err: any) { setUploadMsg('✕ ' + (err.message || 'Upload failed')); }
    setUploading(false);
    e.target.value = '';
  };

  return (
    <div className="animate-fadeIn">
      <div className="mb-[22px]">
        <div className="text-[10px] tracking-[.1em] uppercase" style={{ color: '#4A6080' }}>Settings</div>
        <div className="text-xl font-bold mt-[2px]" style={{ color: '#E8F4FF' }}>Business Settings</div>
      </div>

      {businesses.length > 1 && (
        <div className="mb-5">
          <div className="text-[11px] mb-2" style={{ color: '#4A6080' }}>Select business:</div>
          <div className="flex gap-2 flex-wrap">
            {businesses.map(b => (
              <button key={b.id} onClick={() => setBizId(b.id)}
                className="rounded-md px-3 py-[6px] text-[12px] font-semibold"
                style={{
                  background: bizId === b.id ? 'rgba(0,229,255,.1)' : 'transparent',
                  border: `1px solid ${bizId === b.id ? 'rgba(0,229,255,.3)' : '#1A2940'}`,
                  color: bizId === b.id ? '#00E5FF' : '#4A6080',
                }}>{b.name}</button>
            ))}
          </div>
        </div>
      )}

      {!businesses.length ? (
        <div className="text-center py-20 text-[13px]" style={{ color: '#4A6080' }}>No businesses assigned to you.</div>
      ) : (
        <>
          {/* Products */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="text-[13px] font-semibold" style={{ color: '#E8F4FF' }}>Products</div>
              <label className="rounded-md px-3 py-[6px] text-xs font-semibold cursor-pointer"
                style={{ background: 'rgba(123,47,190,.08)', border: '1px solid rgba(123,47,190,.35)', color: '#7B2FBE', opacity: uploading ? 0.6 : 1 }}>
                {uploading ? 'Uploading…' : '⬆ Upload Product List (Excel)'}
                <input type="file" accept=".xlsx,.xls,.csv" onChange={uploadProducts} className="hidden" disabled={uploading} />
              </label>
            </div>
            <div className="text-xs mb-2" style={{ color: '#4A6080' }}>
              Add products one at a time below, or bulk-upload an Excel (columns: Product SKU, Product Name, Variant SKU, Price, optional Unit cost). Upload replaces the whole list for this business.
            </div>
            {uploadMsg && <div className="text-[12px] mb-2" style={{ color: uploadMsg.startsWith('✓') ? '#10B981' : '#EF4444' }}>{uploadMsg}</div>}
            <ProductEditor key={productKey} businessId={bizId} />
          </div>

          {/* Resolution options */}
          <div className="text-[13px] font-semibold mb-1" style={{ color: '#E8F4FF' }}>Resolution Options</div>
          <div className="text-xs mb-3" style={{ color: '#4A6080' }}>
            The resolution options shown when you contact a customer. Each business has its own.
          </div>
          <ResolutionOptionsManager businessId={bizId} />
        </>
      )}
    </div>
  );
}
