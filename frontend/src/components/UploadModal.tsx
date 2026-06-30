'use client';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

interface DmsField { key: string; label: string; required: boolean; }
interface SheetInfo { name: string; headers: { col: number; name: string }[]; row_count: number; }

type UploadType = 'orders' | 'delivery';
type Step = 'select' | 'courier' | 'sheets' | 'mapping' | 'preview' | 'result';

interface UploadModalProps {
  type: UploadType;
  onClose: () => void;
  onComplete: () => void;
}

export default function UploadModal({ type, onClose, onComplete }: UploadModalProps) {
  const { activeBusiness } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('select');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [fileId, setFileId] = useState('');
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [activeHeaders, setActiveHeaders] = useState<{ col: number; name: string }[]>([]);
  const [fields, setFields] = useState<DmsField[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [savedMapping, setSavedMapping] = useState<Record<string, string> | null>(null);

  // Courier
  const [selectedCourier, setSelectedCourier] = useState('');

  // Delivery-specific
  const [deliveryStatus, setDeliveryStatus] = useState('Dispatched');
  const [createUnmatched, setCreateUnmatched] = useState(true);

  // Preview
  const [previewData, setPreviewData] = useState<any>(null);

  // Result
  const [result, setResult] = useState<any>(null);

  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

  useEffect(() => {
    if (activeBusiness) {
      api(`/upload/mapping/${activeBusiness.id}/${type}`).then(data => {
        if (data.mappings) setSavedMapping(data.mappings);
        if (data.fields) setFields(data.fields);
      }).catch(() => {});
    }
  }, [activeBusiness, type]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeBusiness) return;
    setFileName(file.name);
    setError('');
    setLoading(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('dms_token');
      const res = await fetch(`${API}/upload/headers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFileId(data.file_id);
      setSheets(data.sheets);

      if (isOrders) {
        setStep('courier');
      } else if (data.sheets.length === 1) {
        pickSheet(data.sheets[0], data.file_id);
      } else {
        setStep('sheets');
      }
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const pickSheet = (sheet: SheetInfo, fId?: string) => {
    setSelectedSheet(sheet.name);
    setActiveHeaders(sheet.headers);

    // For delivery type, auto-detect status from sheet name
    if (type === 'delivery') {
      const lower = sheet.name.toLowerCase();
      if (lower.includes('pickup') || lower.includes('dispatch')) setDeliveryStatus('Dispatched');
      else if (lower.includes('wait')) setDeliveryStatus('Waiting');
    }

    // Try saved mapping
    if (savedMapping) {
      const colNames = sheet.headers.map(h => h.name);
      const allMapped = Object.values(savedMapping).every(col => colNames.includes(col));
      if (allMapped) {
        setMappings(savedMapping);
        doParse(fId || fileId, sheet.name, savedMapping);
        return;
      }
    }

    setMappings(autoGuess(sheet.headers));
    setStep('mapping');
  };

  const autoGuess = (headers: { col: number; name: string }[]) => {
    const guessMap: Record<string, string[]> = {
      tracking_number: ['trackingnumber', 'tracking number', 'tracking no', 'tracking_number', 'waybill', 'awb'],
      customer_name: ['receivername', 'receiver name', 'customer name', 'customer', 'name'],
      phone: ['receivercontactno', 'receiver contact no', 'phone', 'phone number', 'mobile', 'contact'],
      address: ['receiveraddress', 'receiver address', 'address', 'delivery address'],
      city: ['receivercity', 'receiver city', 'city'],
      product: ['packagedescription', 'package description', 'product', 'item', 'description'],
      salesperson: ['sale rep.', 'sale rep', 'salesperson', 'sales person', 'sales rep'],
      reference: ['reference', 'ref'],
      pieces: ['noofpcs', 'no of pcs', 'pieces', 'qty'],
      weight: ['gram', 'kilo', 'weight'],
      amount: ['amount', 'total', 'price', 'cod'],
      exchange: ['exchange'],
      remark: ['remark', 'remarks', 'note'],
      order_id: ['order id', 'orderid', 'order_id'],
      order_date: ['order date', 'orderdate', 'order_date', 'date'],
      item_codes: ['item codes', 'itemcodes', 'item_codes', 'sku'],
      item_names: ['item names', 'itemnames', 'item_names', 'items'],
      payment_status: ['payment status', 'paymentstatus', 'payment_status', 'payment'],
      order_status: ['order status', 'orderstatus', 'order_status'],
      order_handler: ['order handler', 'orderhandler', 'handler'],
      commission: ['commission'],
      num_items: ['number of items', 'numberofitems', 'num_items', 'qty'],
    };
    const result: Record<string, string> = {};
    const currentFields = fields.length ? fields : [];
    for (const f of currentFields) {
      const guesses = guessMap[f.key] || [];
      const match = headers.find(h => guesses.includes(h.name.toLowerCase().trim()));
      if (match) result[f.key] = match.name;
    }
    return result;
  };

  const confirmCourier = (courier: string) => {
    setSelectedCourier(courier);
    if (sheets.length === 1) pickSheet(sheets[0], fileId);
    else setStep('sheets');
  };

  const doParse = async (fId: string, sheetName: string, map: Record<string, string>) => {
    setLoading(true);
    setError('');
    try {
      const endpoint = type === 'orders' ? '/upload/parse-orders' : '/upload/parse-delivery';
      const body: any = {
        file_id: fId,
        business_id: activeBusiness!.id,
        mappings: map,
        sheet_name: sheetName,
      };
      if (type === 'delivery') body.delivery_status = deliveryStatus;

      const data = await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
      setPreviewData(data);
      setStep('preview');
    } catch (err: any) {
      setError(err.message || 'Parse failed');
      setStep('mapping');
    } finally {
      setLoading(false);
    }
  };

  const handleMappingConfirm = async (save: boolean) => {
    if (!mappings.tracking_number) { setError('Tracking Number mapping is required'); return; }
    if (save && activeBusiness) {
      await api(`/upload/mapping/${activeBusiness.id}/${type}`, {
        method: 'POST', body: JSON.stringify({ mappings }),
      }).catch(() => {});
      setSavedMapping(mappings);
    }
    await doParse(fileId, selectedSheet, mappings);
  };

  const doImport = async () => {
    setLoading(true);
    try {
      const endpoint = type === 'orders' ? '/upload/import-orders' : '/upload/import-delivery';
      const body: any = { business_id: activeBusiness!.id, rows: previewData.rows };
      if (type === 'orders') body.courier = selectedCourier || 'unknown';
      if (type === 'delivery') { body.delivery_status = deliveryStatus; body.create_unmatched = createUnmatched; }
      const data = await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
      // If courier unknown, trigger background detection
      if (type === 'orders' && (!selectedCourier || selectedCourier === 'unknown') && data.unknown_ids?.length) {
        api('/sync/detect-courier', { method: 'POST', body: JSON.stringify({ order_ids: data.unknown_ids }) }).catch(() => {});
      }
      setResult(data);
      setStep('result');
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const isOrders = type === 'orders';
  const accentColor = isOrders ? '#00E5FF' : '#7B2FBE';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,.6)' }}>
      <div className="w-full max-w-lg rounded-xl relative overflow-hidden animate-fadeIn max-h-[90vh] flex flex-col"
        style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
        <div className="absolute top-0 left-0 right-0 h-[2px]"
          style={{ background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)` }} />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid #1A2940' }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: '#E8F4FF' }}>
              {isOrders ? 'Upload Orders (Sales Data)' : 'Upload Delivery Data'}
            </div>
            <div className="text-[11px] mt-1" style={{ color: '#4A6080' }}>
              {activeBusiness?.name}{fileName ? ` · ${fileName}` : ''}{selectedSheet ? ` · Sheet: ${selectedSheet}` : ''}
            </div>
          </div>
          <button onClick={onClose} className="text-lg" style={{ color: '#4A6080' }}>✕</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {error && (
            <div className="rounded-lg p-3 mb-4 text-xs font-semibold"
              style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#EF4444' }}>
              {error}
            </div>
          )}

          {/* File Select */}
          {step === 'select' && (
            <>
              <div onClick={() => fileRef.current?.click()}
                className="rounded-lg p-8 text-center cursor-pointer"
                style={{ border: '2px dashed #1A2940', background: '#080D1A' }}>
                <div className="text-2xl mb-2">{isOrders ? '📋' : '🚚'}</div>
                <div className="text-sm mb-1" style={{ color: '#C8D8E8' }}>
                  {loading ? 'Reading file...' : isOrders ? 'Click to upload Sales Report' : 'Click to upload Delivery Sheet'}
                </div>
                <div className="text-[11px]" style={{ color: '#2A4060' }}>
                  {isOrders ? 'Adds new orders & updates existing order statuses' : 'Updates delivery status (Dispatched / Waiting)'}
                </div>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileSelect} className="hidden" />
              {savedMapping && (
                <div className="mt-3 rounded-lg p-3 text-[11px]"
                  style={{ background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.2)', color: '#10B981' }}>
                  ✓ Saved column mapping found — matching files will auto-map
                </div>
              )}
            </>
          )}

          {/* Courier Selection */}
          {step === 'courier' && (
            <>
              <div className="text-xs mb-4" style={{ color: '#4A6080' }}>
                Which courier service are these orders dispatched through?
              </div>
              <div className="space-y-2 mb-4">
                <button onClick={() => confirmCourier('domex')}
                  className="w-full rounded-lg px-4 py-4 text-left flex items-center gap-4 transition-all"
                  style={{ background: '#080D1A', border: '1px solid rgba(0,229,255,.25)' }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.3)', color: '#00E5FF' }}>DX</div>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: '#E8F4FF' }}>Domex</div>
                    <div className="text-[11px] mt-[2px]" style={{ color: '#4A6080' }}>Tag all orders as Domex — sync will use Domex API</div>
                  </div>
                </button>
                <button onClick={() => confirmCourier('unknown')}
                  className="w-full rounded-lg px-4 py-4 text-left flex items-center gap-4 transition-all"
                  style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', color: '#F59E0B' }}>?</div>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: '#E8F4FF' }}>Don't Know</div>
                    <div className="text-[11px] mt-[2px]" style={{ color: '#4A6080' }}>System will auto-detect courier after import by checking each API</div>
                  </div>
                </button>
              </div>
            </>
          )}

          {/* Sheet Selection */}
          {step === 'sheets' && (
            <>
              <div className="text-xs mb-3" style={{ color: '#4A6080' }}>
                This file has {sheets.length} sheets. Select which to import:
              </div>
              <div className="space-y-2">
                {sheets.map(s => (
                  <button key={s.name} onClick={() => pickSheet(s)}
                    className="w-full rounded-lg px-4 py-3 text-left transition-all flex items-center justify-between"
                    style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                    <div>
                      <div className="text-[13px] font-semibold" style={{ color: '#C8D8E8' }}>{s.name}</div>
                      <div className="text-[11px] mt-1" style={{ color: '#2A4060' }}>
                        {s.row_count} rows · {s.headers.length} columns
                      </div>
                    </div>
                    {type === 'delivery' && (
                      <span className="text-[10px] px-2 py-1 rounded" style={{
                        color: s.name.toLowerCase().includes('pickup') || s.name.toLowerCase().includes('dispatch') ? '#10B981' : '#F59E0B',
                        background: s.name.toLowerCase().includes('pickup') || s.name.toLowerCase().includes('dispatch') ? 'rgba(16,185,129,.1)' : 'rgba(245,158,11,.1)',
                        border: `1px solid ${s.name.toLowerCase().includes('pickup') || s.name.toLowerCase().includes('dispatch') ? 'rgba(16,185,129,.3)' : 'rgba(245,158,11,.3)'}`,
                      }}>
                        {s.name.toLowerCase().includes('pickup') || s.name.toLowerCase().includes('dispatch') ? 'Dispatched' : s.name.toLowerCase().includes('wait') ? 'Waiting' : 'Select'}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Column Mapping */}
          {step === 'mapping' && (
            <>
              <div className="rounded-lg p-3 mb-4 text-xs"
                style={{ background: 'rgba(0,229,255,.04)', border: '1px solid rgba(0,229,255,.1)', color: '#4A6080' }}>
                Map your columns to DMS fields. Only Tracking Number is required.
              </div>

              {type === 'delivery' && (
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs" style={{ color: '#4A6080' }}>Status for this sheet:</span>
                  {['Dispatched', 'Waiting'].map(s => (
                    <button key={s} onClick={() => setDeliveryStatus(s)}
                      className="rounded-md px-3 py-[5px] text-[11px] font-semibold"
                      style={{
                        background: deliveryStatus === s ? (s === 'Dispatched' ? 'rgba(16,185,129,.1)' : 'rgba(245,158,11,.1)') : 'transparent',
                        border: `1px solid ${deliveryStatus === s ? (s === 'Dispatched' ? 'rgba(16,185,129,.3)' : 'rgba(245,158,11,.3)') : '#1A2940'}`,
                        color: deliveryStatus === s ? (s === 'Dispatched' ? '#10B981' : '#F59E0B') : '#4A6080',
                      }}>{s}</button>
                  ))}
                </div>
              )}

              <div className="space-y-[8px] mb-4 max-h-[300px] overflow-y-auto">
                {fields.map(field => (
                  <div key={field.key} className="flex items-center gap-3">
                    <div className="w-[140px] shrink-0 text-xs text-right" style={{ color: field.required ? '#E8F4FF' : '#4A6080' }}>
                      {field.label}{field.required ? <span style={{ color: '#EF4444' }}> *</span> : ''}
                    </div>
                    <div className="text-[11px]" style={{ color: '#2A4060' }}>→</div>
                    <select value={mappings[field.key] || ''}
                      onChange={e => setMappings({ ...mappings, [field.key]: e.target.value })}
                      className="flex-1 rounded-md px-3 py-[7px] text-[12px] outline-none"
                      style={{
                        background: '#080D1A',
                        border: `1px solid ${mappings[field.key] ? `${accentColor}40` : '#1A2940'}`,
                        color: mappings[field.key] ? '#C8D8E8' : '#2A4060',
                      }}>
                      <option value="">— Skip —</option>
                      {activeHeaders.map(h => <option key={h.col} value={h.name}>{h.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button onClick={() => handleMappingConfirm(true)} disabled={loading}
                  className="flex-1 rounded-md py-2 text-xs font-semibold"
                  style={{ background: `${accentColor}14`, border: `1px solid ${accentColor}4D`, color: accentColor }}>
                  {loading ? 'Processing...' : 'Save Mapping & Continue'}
                </button>
                <button onClick={() => handleMappingConfirm(false)} disabled={loading}
                  className="rounded-md px-4 py-2 text-xs font-semibold"
                  style={{ background: 'transparent', border: '1px solid #1A2940', color: '#4A6080' }}>
                  {loading ? '...' : 'Use Once'}
                </button>
              </div>
            </>
          )}

          {/* Preview */}
          {step === 'preview' && previewData && (
            <>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {isOrders ? (
                  <>
                    <div className="rounded-lg p-3 text-center" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                      <div className="mono text-lg font-bold" style={{ color: '#10B981' }}>{previewData.new_count}</div>
                      <div className="text-[10px] uppercase" style={{ color: '#4A6080' }}>New Orders</div>
                    </div>
                    <div className="rounded-lg p-3 text-center" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                      <div className="mono text-lg font-bold" style={{ color: '#00E5FF' }}>{previewData.update_count}</div>
                      <div className="text-[10px] uppercase" style={{ color: '#4A6080' }}>Will Update</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded-lg p-3 text-center" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                      <div className="mono text-lg font-bold" style={{ color: '#10B981' }}>{previewData.matched}</div>
                      <div className="text-[10px] uppercase" style={{ color: '#4A6080' }}>Matched in System</div>
                    </div>
                    <div className="rounded-lg p-3 text-center" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                      <div className="mono text-lg font-bold" style={{ color: '#F59E0B' }}>{previewData.unmatched}</div>
                      <div className="text-[10px] uppercase" style={{ color: '#4A6080' }}>Not in System</div>
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-lg p-3 mb-4 text-xs"
                style={{ background: 'rgba(0,229,255,.04)', border: '1px solid rgba(0,229,255,.1)', color: '#4A6080' }}>
                {isOrders
                  ? `${previewData.total} total rows. ${previewData.new_count} new orders will be added. ${previewData.update_count} existing orders will be updated.`
                  : `${previewData.total} rows from "${selectedSheet}". ${previewData.matched} orders will be set to "${deliveryStatus}". ${previewData.unmatched} tracking numbers not found in system.`
                }
              </div>

              {!isOrders && previewData.unmatched > 0 && (
                <div className="flex items-center gap-3 mb-4 rounded-lg px-3 py-2"
                  style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                  <div onClick={() => setCreateUnmatched(!createUnmatched)}
                    className="w-4 h-4 rounded border flex items-center justify-center shrink-0 cursor-pointer"
                    style={{
                      borderColor: createUnmatched ? accentColor : '#1A2940',
                      background: createUnmatched ? `${accentColor}26` : 'transparent',
                    }}>
                    {createUnmatched && <span style={{ color: accentColor, fontSize: '10px' }}>✓</span>}
                  </div>
                  <span className="text-xs" style={{ color: '#C8D8E8' }}>
                    Create {previewData.unmatched} unmatched orders as new entries
                  </span>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setStep('mapping')}
                  className="rounded-md px-4 py-2 text-xs font-semibold"
                  style={{ background: 'transparent', border: '1px solid #1A2940', color: '#4A6080' }}>
                  Back
                </button>
                <button onClick={doImport} disabled={loading}
                  className="flex-1 rounded-md py-2 text-xs font-semibold"
                  style={{ background: `${accentColor}14`, border: `1px solid ${accentColor}4D`, color: accentColor }}>
                  {loading ? 'Importing...' : `Import ${previewData.total} rows`}
                </button>
              </div>
            </>
          )}

          {/* Result */}
          {step === 'result' && result && (
            <>
              <div className="text-center py-4">
                <div className="text-3xl mb-3">✓</div>
                <div className="text-lg font-bold mb-4" style={{ color: '#10B981' }}>
                  {isOrders ? 'Orders Uploaded' : 'Delivery Data Updated'}
                </div>
                <div className={`grid ${isOrders ? 'grid-cols-2' : 'grid-cols-3'} gap-3`}>
                  {isOrders ? (
                    <>
                      <div className="rounded-lg p-3" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                        <div className="mono text-xl font-bold" style={{ color: '#10B981' }}>{result.inserted}</div>
                        <div className="text-[10px] uppercase mt-1" style={{ color: '#4A6080' }}>New</div>
                      </div>
                      <div className="rounded-lg p-3" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                        <div className="mono text-xl font-bold" style={{ color: '#00E5FF' }}>{result.updated}</div>
                        <div className="text-[10px] uppercase mt-1" style={{ color: '#4A6080' }}>Updated</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="rounded-lg p-3" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                        <div className="mono text-xl font-bold" style={{ color: '#10B981' }}>{result.updated}</div>
                        <div className="text-[10px] uppercase mt-1" style={{ color: '#4A6080' }}>Updated</div>
                      </div>
                      <div className="rounded-lg p-3" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                        <div className="mono text-xl font-bold" style={{ color: '#00E5FF' }}>{result.created}</div>
                        <div className="text-[10px] uppercase mt-1" style={{ color: '#4A6080' }}>Created</div>
                      </div>
                      <div className="rounded-lg p-3" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                        <div className="mono text-xl font-bold" style={{ color: '#F59E0B' }}>{result.skipped}</div>
                        <div className="text-[10px] uppercase mt-1" style={{ color: '#4A6080' }}>Skipped</div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {type === 'delivery' && sheets.length > 1 && (
                <button onClick={() => { setStep('sheets'); setPreviewData(null); setResult(null); }}
                  className="w-full rounded-md py-2 text-xs font-semibold mb-2"
                  style={{ background: 'rgba(123,47,190,.08)', border: '1px solid rgba(123,47,190,.3)', color: '#7B2FBE' }}>
                  Import Another Sheet
                </button>
              )}

              <button onClick={() => { onComplete(); onClose(); }}
                className="w-full rounded-md py-2 text-xs font-semibold"
                style={{ background: `${accentColor}14`, border: `1px solid ${accentColor}4D`, color: accentColor }}>
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
