'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusPill from './StatusPill';
import DateRangeFilter from './DateRangeFilter';
import UploadModal from './UploadModal';

const STATUSES = ['All', 'Pending Delivery', 'New', 'Waiting', 'Dispatched', 'In Transit', 'Out for Delivery', 'Delivered', 'Failed', 'Returned'];

function Pagination({ page, total, perPage, onPageChange }: { page: number; total: number; perPage: number; onPageChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / perPage);
  return (
    <div className="flex items-center justify-between py-3">
      <div className="text-[13px] font-semibold" style={{ color: '#8ABBE0' }}>
        Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of <span style={{ color: '#00E5FF' }}>{total}</span> orders
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1}
          className="rounded-md px-4 py-[6px] text-[13px] font-semibold transition-all"
          style={{
            background: page === 1 ? 'transparent' : 'rgba(0,229,255,.08)',
            border: `1px solid ${page === 1 ? '#1A2940' : 'rgba(0,229,255,.3)'}`,
            color: page === 1 ? '#1A2940' : '#00E5FF',
          }}>
          ← Prev
        </button>
        <span className="mono text-[14px] font-bold" style={{ color: '#C8D8E8' }}>
          {page} <span style={{ color: '#4A6080' }}>/</span> {totalPages}
        </span>
        <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
          className="rounded-md px-4 py-[6px] text-[13px] font-semibold transition-all"
          style={{
            background: page >= totalPages ? 'transparent' : 'rgba(0,229,255,.08)',
            border: `1px solid ${page >= totalPages ? '#1A2940' : 'rgba(0,229,255,.3)'}`,
            color: page >= totalPages ? '#1A2940' : '#00E5FF',
          }}>
          Next →
        </button>
      </div>
    </div>
  );
}

function DetailField({ label, value, mono, cyan, purple }: { label: string; value: string; mono?: boolean; cyan?: boolean; purple?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] tracking-[.06em] uppercase mb-[2px]" style={{ color: '#3A5570' }}>{label}</div>
      <div className={`text-[13px] ${mono ? 'mono' : ''}`} style={{
        color: cyan ? '#00E5FF' : purple ? '#7B2FBE' : '#C8D8E8',
        fontWeight: cyan || purple ? 600 : 400,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>{value}</div>
    </div>
  );
}

interface Order {
  id: number;
  tracking_number: string;
  customer_name: string;
  phone: string;
  product: string;
  branch: string;
  salesperson: string;
  status: string;
  created_at: string;
  address: string;
  city: string;
  order_id: string;
  order_date: string;
  amount: number;
  item_codes: string;
  item_names: string;
  payment_status: string;
  order_status: string;
  order_handler: string;
  commission: number;
  num_items: number;
  pieces: number;
  weight: string;
  exchange: string;
  reference: string;
  remark: string;
  dispatched_at: string;
  pickup_date: string;
  delivered_date: string;
  updated_at: string;
  issue_source: string | null;
  issue_status: string | null;
}

export default function OrdersScreen() {
  const { activeBusiness } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [addingToIssues, setAddingToIssues] = useState(false);
  const [filter, setFilter] = useState('All');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const debounceRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(searchInput), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);
  const [total, setTotal] = useState(0);
  const [uploadType, setUploadType] = useState<'orders' | 'delivery' | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [trackingHistory, setTrackingHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pickupFrom, setPickupFrom] = useState('');
  const [pickupTo, setPickupTo] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('order_id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const perPage = 100;

  const toggleSort = (field: string) => {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortDir('desc'); }
  };

  const fetchOrders = () => {
    const params = new URLSearchParams();
    if (activeBusiness) params.set('business_id', String(activeBusiness.id));
    if (filter !== 'All') params.set('status', filter);
    if (search) params.set('search', search);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (pickupFrom) params.set('pickup_from', pickupFrom);
    if (pickupTo) params.set('pickup_to', pickupTo);
    params.set('page', String(page));
    params.set('limit', String(perPage));
    params.set('sort_by', sortBy);
    params.set('sort_dir', sortDir);
    api(`/orders?${params}`).then(d => {
      setOrders(d.orders);
      setTotal(d.total);
      if (d.status_counts) setStatusCounts(d.status_counts);
    }).catch(() => {});
  };

  useEffect(() => { fetchOrders(); }, [activeBusiness, filter, search, dateFrom, dateTo, pickupFrom, pickupTo, page, sortBy, sortDir]);
  useEffect(() => { setPage(1); }, [filter, search, dateFrom, dateTo, pickupFrom, pickupTo, activeBusiness]);

  const handleExpand = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    setTrackingHistory([]);
    setHistoryLoading(true);
    try {
      const data = await api(`/orders/${id}/tracking`);
      setTrackingHistory(data);
    } catch { setTrackingHistory([]); }
    setHistoryLoading(false);
  };

  const daysSince = (d: string) => {
    const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    return diff === 0 ? 'Today' : `${diff}d`;
  };

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-[22px]">
        <div>
          <div className="text-[10px] tracking-[.1em] uppercase" style={{ color: '#4A6080' }}>Order Management</div>
          <div className="text-xl font-bold mt-[2px]" style={{ color: '#E8F4FF' }}>All Orders</div>
        </div>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <button onClick={async () => {
              if (!activeBusiness) return;
              setAddingToIssues(true);
              try {
                const data = await api('/issues/add', {
                  method: 'POST',
                  body: JSON.stringify({ order_ids: Array.from(selectedIds), business_id: activeBusiness.id, source: 'internal' }),
                });
                alert(`Added ${data.added} to issue queue (${data.skipped} already in queue)`);
                setSelectedIds(new Set());
              } catch (err: any) { alert(err.message); }
              setAddingToIssues(false);
            }}
              disabled={addingToIssues}
              className="rounded-md px-4 py-2 text-xs font-semibold transition-all"
              style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', color: '#EF4444' }}>
              {addingToIssues ? 'Adding...' : `◉ Add ${selectedIds.size} to Issues`}
            </button>
          )}
          <button onClick={() => setUploadType('orders')}
            className="rounded-md px-4 py-2 text-xs font-semibold transition-all"
            style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', color: '#00E5FF' }}>
            📋 Add Orders
          </button>
          <button onClick={() => setUploadType('delivery')}
            className="rounded-md px-4 py-2 text-xs font-semibold transition-all"
            style={{ background: 'rgba(123,47,190,.08)', border: '1px solid rgba(123,47,190,.35)', color: '#7B2FBE' }}>
            🚚 Delivery Data
          </button>
        </div>
      </div>

      <input
        className="w-full rounded-lg px-[14px] py-[9px] text-[13px] mb-3 outline-none"
        style={{ background: '#0D1B2A', border: '1px solid #1A2940', color: '#C8D8E8' }}
        placeholder="Search by tracking, customer, phone, order ID..."
        value={searchInput}
        onChange={e => setSearchInput(e.target.value)}
      />

      <div className="flex items-center gap-4 mb-3 text-[11px]" style={{ color: '#4A6080' }}>
        <span className="flex items-center gap-[5px]"><span className="inline-block w-[8px] h-[8px] rounded-full" style={{ background: '#EF4444', boxShadow: '0 0 4px #EF4444' }} /> Domex Issue</span>
        <span className="flex items-center gap-[5px]"><span className="inline-block w-[8px] h-[8px] rounded-full" style={{ background: '#F59E0B', boxShadow: '0 0 4px #F59E0B' }} /> Internal Issue</span>
      </div>

      <div className="flex gap-6 flex-wrap mb-3">
        <DateRangeFilter
          label="Order Date"
          onFilter={(from, to) => { setDateFrom(from); setDateTo(to); }}
          onClear={() => { setDateFrom(''); setDateTo(''); }}
        />
        <DateRangeFilter
          label="Pickup Date"
          onFilter={(from, to) => { setPickupFrom(from); setPickupTo(to); }}
          onClear={() => { setPickupFrom(''); setPickupTo(''); }}
        />
      </div>

      <div className="flex gap-[6px] flex-wrap mb-4">
        {STATUSES.map(s => {
          const count = statusCounts[s] || 0;
          return (
            <button key={s}
              onClick={() => setFilter(s)}
              className="rounded-full px-3 py-1 text-[11px] whitespace-nowrap transition-all cursor-pointer flex items-center gap-[5px]"
              style={{
                border: filter === s ? '1px solid rgba(0,229,255,.4)' : '1px solid #1A2940',
                color: filter === s ? '#00E5FF' : '#4A6080',
                background: filter === s ? 'rgba(0,229,255,.08)' : 'transparent',
              }}>
              {s}
              {count > 0 && (
                <span className="mono text-[10px] font-bold rounded-full px-[5px]"
                  style={{
                    background: filter === s ? 'rgba(0,229,255,.15)' : '#1A2940',
                    color: filter === s ? '#00E5FF' : '#3A5570',
                  }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {total > 0 && <Pagination page={page} total={total} perPage={perPage} onPageChange={setPage} />}

      <div className="grid gap-[10px] px-4 py-[7px] text-[10px] tracking-[.08em] uppercase mb-1"
        style={{ gridTemplateColumns: '30px 70px 110px 1fr 130px 110px 110px 80px 130px', color: '#2A4060' }}>
        <span onClick={() => {
          if (selectedIds.size === orders.length) setSelectedIds(new Set());
          else setSelectedIds(new Set(orders.map(o => o.id)));
        }} className="cursor-pointer" style={{ color: selectedIds.size > 0 ? '#00E5FF' : '#2A4060' }}>
          {selectedIds.size > 0 && selectedIds.size === orders.length ? '☑' : '☐'}
        </span>
        {[
          { key: 'order_id', label: 'Order #' },
          { key: 'tracking_number', label: 'Tracking' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'product', label: 'Product' },
          { key: 'branch', label: 'Branch' },
          { key: 'salesperson', label: 'Salesperson' },
          { key: 'pickup_date', label: 'Age' },
          { key: 'status', label: 'Status' },
        ].map(col => (
          <span key={col.key} onClick={() => toggleSort(col.key)}
            className="cursor-pointer select-none hover:text-[#8ABBE0] transition-colors"
            style={{ color: sortBy === col.key ? '#00E5FF' : undefined }}>
            {col.label} {sortBy === col.key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
          </span>
        ))}
      </div>

      {orders.length === 0 && (
        <div className="text-center py-12 text-[13px]" style={{ color: '#2A4060' }}>No orders found</div>
      )}

      {orders.map(o => {
        const days = o.pickup_date ? daysSince(o.pickup_date) : '—';
        const daysNum = days === 'Today' ? 0 : days === '—' ? -1 : parseInt(days);
        const isOpen = expandedId === o.id;
        return (
          <div key={o.id} className="mb-[5px]">
            <div onClick={() => handleExpand(o.id)}
              className="grid gap-[10px] px-4 py-3 rounded-lg items-center cursor-pointer transition-all"
              style={{
                gridTemplateColumns: '30px 70px 110px 1fr 130px 110px 110px 80px 130px',
                background: isOpen ? '#0F2236' : '#0D1B2A',
                border: isOpen ? '1px solid rgba(0,229,255,.25)' : '1px solid #1A2940',
                borderBottom: isOpen ? 'none' : undefined,
                borderRadius: isOpen ? '8px 8px 0 0' : '8px',
              }}>
              <span onClick={(e) => {
                e.stopPropagation();
                const s = new Set(selectedIds);
                if (s.has(o.id)) s.delete(o.id); else s.add(o.id);
                setSelectedIds(s);
              }} className="cursor-pointer text-[14px]" style={{ color: selectedIds.has(o.id) ? '#00E5FF' : '#1A2940' }}>
                {selectedIds.has(o.id) ? '☑' : '☐'}
              </span>
              <span className="mono text-[13px] font-semibold" style={{ color: '#F59E0B' }}>{o.order_id || '—'}</span>
              <span className="mono text-[13px] font-semibold flex items-center gap-[6px]" style={{ color: '#00E5FF' }}>
                {o.issue_source && (
                  <span className="inline-block w-[8px] h-[8px] rounded-full shrink-0" style={{
                    background: o.issue_source === 'domex' ? '#EF4444' : '#F59E0B',
                    boxShadow: `0 0 4px ${o.issue_source === 'domex' ? '#EF4444' : '#F59E0B'}`,
                  }} />
                )}
                {o.tracking_number}
              </span>
              <div>
                <div className="text-[14px] font-medium" style={{ color: '#C8D8E8' }}>{o.customer_name}</div>
                <div className="mono text-[14px] font-bold" style={{ color: '#7B2FBE' }}>{o.phone}</div>
              </div>
              <span className="text-[13px]" style={{ color: '#6A8AA8' }}>{o.product}</span>
              <span className="text-[13px]" style={{ color: '#6A8AA8' }}>{o.branch}</span>
              <span className="text-[13px]" style={{ color: '#6A8AA8' }}>{o.salesperson}</span>
              <span className="mono text-[13px] font-semibold" style={{ color: daysNum >= 3 ? '#EF4444' : '#6A8AA8' }}>{days}</span>
              <StatusPill status={o.status} />
            </div>
            {isOpen && (
              <div className="rounded-b-lg px-5 py-4 animate-fadeIn"
                style={{ background: '#0F2236', border: '1px solid rgba(0,229,255,.25)', borderTop: 'none' }}>
                <div className="grid grid-cols-3 gap-x-8 gap-y-3">
                  <DetailField label="Tracking Number" value={o.tracking_number} mono cyan />
                  <DetailField label="Customer Name" value={o.customer_name} />
                  <DetailField label="Phone" value={o.phone} mono purple />
                  <DetailField label="Address" value={o.address} />
                  <DetailField label="City" value={o.city} />
                  <DetailField label="Status" value={o.status} />
                  <DetailField label="Order ID" value={o.order_id} mono />
                  <DetailField label="Order Date" value={o.order_date ? new Date(o.order_date).toLocaleDateString() : ''} />
                  <DetailField label="Amount" value={o.amount ? `Rs. ${Number(o.amount).toLocaleString()}` : ''} />
                  <DetailField label="Items" value={o.item_names} />
                  <DetailField label="Item Codes" value={o.item_codes} />
                  <DetailField label="No. of Items" value={o.num_items ? String(o.num_items) : ''} />
                  <DetailField label="Salesperson" value={o.salesperson} />
                  <DetailField label="Order Handler" value={o.order_handler} />
                  <DetailField label="Branch" value={o.branch} />
                  <DetailField label="Payment Status" value={o.payment_status} />
                  <DetailField label="Order Status" value={o.order_status} />
                  <DetailField label="Commission" value={o.commission ? String(o.commission) : ''} />
                  <DetailField label="Reference" value={o.reference} />
                  <DetailField label="Pieces" value={o.pieces ? String(o.pieces) : ''} />
                  <DetailField label="Weight" value={o.weight} />
                  <DetailField label="Exchange" value={o.exchange} />
                  <DetailField label="Remark" value={o.remark} />
                  <DetailField label="Pickup Date" value={o.pickup_date ? new Date(o.pickup_date).toLocaleString() : ''} />
                  <DetailField label="Delivered Date" value={o.delivered_date ? new Date(o.delivered_date).toLocaleString() : ''} />
                  <DetailField label="Dispatched At" value={o.dispatched_at ? new Date(o.dispatched_at).toLocaleString() : ''} />
                  <DetailField label="Created" value={new Date(o.created_at).toLocaleString()} />
                  <DetailField label="Last Updated" value={o.updated_at ? new Date(o.updated_at).toLocaleString() : ''} />
                </div>

                {/* Tracking Timeline */}
                <div className="mt-4 pt-4" style={{ borderTop: '1px solid #1A2940' }}>
                  <div className="text-[11px] tracking-[.08em] uppercase mb-3" style={{ color: '#3A5570' }}>
                    Delivery Tracking History
                  </div>
                  {historyLoading && <div className="text-xs" style={{ color: '#4A6080' }}>Loading...</div>}
                  {!historyLoading && trackingHistory.length === 0 && (
                    <div className="text-xs" style={{ color: '#2A4060' }}>No tracking data yet. Click Sync to fetch from Domex.</div>
                  )}
                  {!historyLoading && trackingHistory.length > 0 && (
                    <div className="relative pl-5">
                      <div className="absolute left-[7px] top-1 bottom-1 w-[2px]" style={{ background: '#1A2940' }} />
                      {trackingHistory.map((s: any, idx: number) => {
                        const isLast = idx === trackingHistory.length - 1;
                        const statusColor =
                          s.status_code === 'D' || s.status_code === 'PS' || s.status_code === 'CIG' || s.status_code === 'CRC' || s.status_code === 'CBR' ? '#10B981' :
                          s.status_code === 'ATD' ? '#F59E0B' :
                          s.status_code === 'UD' || s.status_code === 'UDH' ? '#EF4444' :
                          s.status_code === 'RTN' || s.status_code === 'RTNQ' || s.status_code === 'R' || s.status_code === 'RTS' ? '#6B7280' :
                          '#00E5FF';
                        return (
                          <div key={idx} className="relative mb-3 last:mb-0">
                            <div className="absolute -left-5 top-[3px] w-[10px] h-[10px] rounded-full border-2"
                              style={{
                                borderColor: statusColor,
                                background: isLast ? statusColor : '#0F2236',
                              }} />
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <div className="text-[13px] font-medium" style={{ color: isLast ? statusColor : '#C8D8E8' }}>
                                  {s.status_text}
                                </div>
                                {s.remark && <div className="text-[11px] mt-[2px]" style={{ color: '#4A6080' }}>{s.remark}</div>}
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="mono text-[11px]" style={{ color: '#6A8AA8' }}>
                                  {new Date(s.status_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </div>
                                <div className="mono text-[10px]" style={{ color: '#3A5570' }}>
                                  {new Date(s.status_date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {total > 0 && <Pagination page={page} total={total} perPage={perPage} onPageChange={setPage} />}

      {uploadType && (
        <UploadModal type={uploadType} onClose={() => setUploadType(null)} onComplete={fetchOrders} />
      )}
    </div>
  );
}
