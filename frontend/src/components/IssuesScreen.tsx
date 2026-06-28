'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusPill from './StatusPill';

interface Issue {
  id: number;
  order_id: number;
  source: string;
  status: string;
  attempt: number;
  tracking_number: string;
  customer_name: string;
  phone: string;
  address: string;
  city: string;
  product: string;
  branch: string;
  salesperson: string;
  amount: number;
  order_number: string;
  order_status: string;
  item_names: string;
  pickup_date: string;
  delivered_date: string;
  reason: string;
  domex_branch: string;
  latest_delivery_status: string;
  latest_delivery_date: string;
  latest_delivery_location: string;
  created_at: string;
  updated_at: string;
  resolved_at: string;
  last_contact_at: string;
}

interface Contact {
  id: number;
  attempt_number: number;
  outcome: string;
  resolution: string;
  scheduled_date: string;
  notes: string;
  contacted_by_name: string;
  contacted_at: string;
}

interface ResolutionOption {
  id: number;
  label: string;
  action: string;
  is_active: number;
}

const ATTEMPT_COLORS = ['#00E5FF', '#F59E0B', '#EF4444'];

export default function IssuesScreen() {
  const { user, activeBusiness } = useAuth();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [sourceTab, setSourceTab] = useState<'internal' | 'domex'>('domex');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactLoading, setContactLoading] = useState(false);

  // Contact form
  const [showContactForm, setShowContactForm] = useState<number | null>(null);
  const [contactOutcome, setContactOutcome] = useState('');
  const [resolution, setResolution] = useState('');
  const [customResolution, setCustomResolution] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [contactNotes, setContactNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [contactError, setContactError] = useState('');
  const [resolutionOptions, setResolutionOptions] = useState<ResolutionOption[]>([]);
  const [detailView, setDetailView] = useState<'none' | 'order' | 'tracking'>('none');
  const [trackingHistory, setTrackingHistory] = useState<any[]>([]);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useState<HTMLInputElement | null>(null);

  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

  const handleDomexUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeBusiness) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('business_id', String(activeBusiness.id));
      const token = localStorage.getItem('dms_token');
      const res = await fetch(`${API}/upload/domex-issues`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert(`Domex Issues Uploaded:\n${data.added} added\n${data.skipped} already in queue\n${data.not_found} not found in orders`);
      if (data.not_found_list?.length) {
        console.log('Not found tracking numbers:', data.not_found_list);
      }
      fetchIssues();
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    }
    setUploading(false);
    e.target.value = '';
  };

  const fetchIssues = () => {
    const params = new URLSearchParams();
    if (activeBusiness) params.set('business_id', String(activeBusiness.id));
    params.set('source', sourceTab);
    if (statusFilter) params.set('status', statusFilter);
    if (search.trim()) params.set('search', search.trim());
    api(`/issues?${params}`).then(d => {
      setIssues(d.issues);
      setTotal(d.total);
      setStatusCounts(d.status_counts || {});
    }).catch(() => {});
  };

  useEffect(() => { fetchIssues(); }, [activeBusiness, sourceTab, statusFilter, search]);

  useEffect(() => {
    if (activeBusiness) {
      api(`/settings/resolution-options/${activeBusiness.id}`).then(data => {
        setResolutionOptions(data.filter((o: ResolutionOption) => o.is_active));
      }).catch(() => {});
    }
  }, [activeBusiness]);

  const handleExpand = async (issue: Issue) => {
    if (expandedId === issue.id) { setExpandedId(null); return; }
    setExpandedId(issue.id);
    setContacts([]);
    setShowContactForm(null);
    setDetailView('none');
    setTrackingHistory([]);
    setContactLoading(true);
    try {
      const data = await api(`/issues/${issue.id}/contacts`);
      setContacts(data);
    } catch {}
    setContactLoading(false);
  };

  const loadTracking = async (orderId: number) => {
    if (detailView === 'tracking') { setDetailView('none'); return; }
    setDetailView('tracking');
    setTrackingLoading(true);
    try {
      const data = await api(`/orders/${orderId}/tracking`);
      setTrackingHistory(data);
    } catch { setTrackingHistory([]); }
    setTrackingLoading(false);
  };

  const canAttempt = (issue: Issue) => {
    if (issue.status === 'resolved' || issue.status === 'auto_return') return false;
    if (issue.attempt >= 3) return false;
    if (issue.last_contact_at) {
      const last = new Date(issue.last_contact_at);
      const now = new Date();
      const daysDiff = (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff < 1) return false;
    }
    return true;
  };

  const nextAttemptIn = (issue: Issue) => {
    if (!issue.last_contact_at) return null;
    const last = new Date(issue.last_contact_at);
    const next = new Date(last.getTime() + 24 * 60 * 60 * 1000);
    const now = new Date();
    if (next <= now) return null;
    const hours = Math.ceil((next.getTime() - now.getTime()) / (1000 * 60 * 60));
    return `${hours}h`;
  };

  const submitContact = async (issueId: number) => {
    if (!contactOutcome) return;
    setSubmitting(true);
    setContactError('');
    try {
      const resAction = resolution ? resolution.split(':')[0] : null;
      const resLabel = resolution ? resolutionOptions.find(o => `${o.action}:${o.id}` === resolution)?.label : null;
      const finalResLabel = resLabel || customResolution || null;
      const finalResAction = resAction || (customResolution ? 'resolve' : null);
      await api(`/issues/${issueId}/contact`, {
        method: 'POST',
        body: JSON.stringify({
          outcome: contactOutcome,
          resolution: contactOutcome === 'answered' ? (finalResAction === 'return' ? 'return_confirmed' : finalResAction || null) : null,
          resolution_label: finalResLabel,
          scheduled_date: scheduledDate || null,
          notes: contactNotes || null,
        }),
      });
      setShowContactForm(null);
      setContactOutcome('');
      setResolution('');
      setCustomResolution('');
      setScheduledDate('');
      setContactNotes('');
      fetchIssues();
      // Refresh contacts
      const data = await api(`/issues/${issueId}/contacts`);
      setContacts(data);
    } catch (err: any) {
      setContactError(err.message || 'Failed');
    }
    setSubmitting(false);
  };

  const isDone = (s: string) => s === 'resolved' || s === 'auto_return';

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-[22px]">
        <div>
          <div className="text-[10px] tracking-[.1em] uppercase" style={{ color: '#4A6080' }}>Issue Management</div>
          <div className="text-xl font-bold mt-[2px]" style={{ color: '#E8F4FF' }}>Issue Queue</div>
        </div>
        <div className="flex gap-2 items-center">
          <div className="text-xs px-3 py-[6px] rounded-md" style={{ color: '#4A6080', border: '1px solid #1A2940' }}>
            {statusCounts.all || 0} total · <span style={{ color: '#F59E0B' }}>{(statusCounts.open || 0) + (statusCounts.in_progress || 0)} active</span>
          </div>
          <label className="rounded-md px-4 py-[6px] text-xs font-semibold cursor-pointer transition-all"
            style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', color: '#EF4444' }}>
            {uploading ? 'Uploading...' : '⬆ Domex Issues'}
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleDomexUpload} className="hidden" />
          </label>
        </div>
      </div>

      {/* Source Tabs */}
      <div className="flex mb-[18px]" style={{ borderBottom: '1px solid #1A2940' }}>
        {(['domex', 'internal'] as const).map(t => (
          <button key={t} onClick={() => { setSourceTab(t); setStatusFilter(''); }}
            className="px-5 py-[10px] text-[13px] -mb-px transition-all capitalize"
            style={{
              color: sourceTab === t ? '#00E5FF' : '#4A6080',
              borderBottom: sourceTab === t ? '2px solid #00E5FF' : '2px solid transparent',
              fontWeight: sourceTab === t ? 600 : 400,
              background: 'transparent',
            }}>
            {t} Issues
          </button>
        ))}
      </div>

      {/* Status Filter + Search */}
      <div className="flex gap-[6px] flex-wrap mb-3">
        {['', 'open', 'in_progress', 'resolved', 'auto_return'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className="rounded-full px-3 py-1 text-[11px] whitespace-nowrap transition-all cursor-pointer"
            style={{
              border: statusFilter === s ? '1px solid rgba(0,229,255,.4)' : '1px solid #1A2940',
              color: statusFilter === s ? '#00E5FF' : '#4A6080',
              background: statusFilter === s ? 'rgba(0,229,255,.08)' : 'transparent',
            }}>
            {s === '' ? 'All' : s === 'in_progress' ? 'In Progress' : s === 'auto_return' ? 'Auto Return' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <input className="w-full rounded-lg px-[14px] py-[9px] text-[13px] mb-4 outline-none"
        style={{ background: '#0D1B2A', border: '1px solid #1A2940', color: '#C8D8E8' }}
        placeholder="Search by tracking, customer, phone..."
        value={search} onChange={e => setSearch(e.target.value)} />

      {/* Issue List */}
      {issues.length === 0 && (
        <div className="text-center py-12 text-[13px]" style={{ color: '#2A4060' }}>
          No issues in this queue
        </div>
      )}

      {issues.map(issue => {
        const isOpen = expandedId === issue.id;
        const attemptColor = ATTEMPT_COLORS[Math.min(issue.attempt, 2)];
        const done = isDone(issue.status);
        const waiting = nextAttemptIn(issue);
        const daysInQueue = Math.floor((Date.now() - new Date(issue.created_at).getTime()) / 86400000);

        return (
          <div key={issue.id} className="mb-[10px]">
            {/* Issue Card */}
            <div onClick={() => handleExpand(issue)}
              className="rounded-[10px] p-4 cursor-pointer transition-all"
              style={{
                background: isOpen ? '#0F2236' : '#0D1B2A',
                border: isOpen ? '1px solid rgba(0,229,255,.25)' : done ? '1px solid #1A2940' : issue.attempt >= 3 ? '1px solid rgba(239,68,68,.35)' : '1px solid #1A2940',
                borderRadius: isOpen ? '10px 10px 0 0' : '10px',
                opacity: done ? 0.6 : 1,
              }}>
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-[10px]">
                  <span className="inline-block w-[8px] h-[8px] rounded-full"
                    style={{
                      background: done ? '#3A5570' : attemptColor,
                      boxShadow: !done && issue.attempt >= 2 ? `0 0 6px ${attemptColor}` : 'none',
                    }} />
                  <div>
                    <div className="text-[14px] font-semibold" style={{ color: '#C8D8E8' }}>{issue.customer_name || '—'}</div>
                    <div className="mono text-[11px] mt-[2px]" style={{ color: '#00E5FF' }}>{issue.tracking_number}</div>
                  </div>
                </div>
                <div className="flex items-center gap-[10px]">
                  <span className="text-[12px] font-bold rounded px-[10px] py-[3px]"
                    style={{ color: attemptColor, background: `${attemptColor}15`, border: `1px solid ${attemptColor}30` }}>
                    Attempt {issue.attempt}/3
                  </span>
                  <span className="mono text-[11px]" style={{ color: daysInQueue >= 4 ? '#EF4444' : '#4A6080' }}>
                    {daysInQueue}d in queue
                  </span>
                </div>
              </div>

              {/* Attempt Progress Bar */}
              <div className="flex gap-1 mb-3">
                {[1, 2, 3].map(n => (
                  <div key={n} className="flex-1 h-[3px] rounded-sm"
                    style={{ background: n <= issue.attempt ? attemptColor : '#1A2940' }} />
                ))}
              </div>

              {/* Reason */}
              {issue.reason && (
                <div className="rounded-md px-3 py-[6px] mb-3 text-[13px] font-medium"
                  style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.15)', color: '#F59E0B' }}>
                  {issue.reason}
                </div>
              )}

              {/* Info Row */}
              <div className="flex gap-5 flex-wrap text-[12px] mb-2" style={{ color: '#4A6080' }}>
                <span className="mono font-bold text-[13px]" style={{ color: '#7B2FBE' }}>{issue.phone}</span>
                <span>{issue.product}</span>
                <span>{issue.branch || issue.city}</span>
                {issue.salesperson && <span style={{ color: '#8ABBE0' }}>Sales: {issue.salesperson}</span>}
                {issue.amount && <span>Rs. {Number(issue.amount).toLocaleString()}</span>}
              </div>

              {/* Latest Delivery Status */}
              {issue.latest_delivery_status && (
                <div className="flex items-center gap-2 text-[11px]" style={{ color: '#6A8AA8' }}>
                  <span className="inline-block w-[5px] h-[5px] rounded-full" style={{ background: '#00E5FF' }} />
                  <span>{issue.latest_delivery_status}</span>
                  {issue.latest_delivery_date && (
                    <span className="mono" style={{ color: '#3A5570' }}>
                      {new Date(issue.latest_delivery_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              )}

              {/* Status */}
              {done && (
                <div className="mt-3 text-[13px] font-semibold"
                  style={{ color: issue.status === 'resolved' ? '#10B981' : '#EF4444' }}>
                  {issue.status === 'resolved' ? '✓ Resolved' : '↩ Auto-Return'}
                </div>
              )}
              {waiting && !done && (
                <div className="mt-2 text-[11px]" style={{ color: '#F59E0B' }}>
                  Next attempt available in {waiting}
                </div>
              )}
            </div>

            {/* Expanded Detail */}
            {isOpen && (
              <div className="rounded-b-[10px] px-5 py-4 animate-fadeIn"
                style={{ background: '#0F2236', border: '1px solid rgba(0,229,255,.25)', borderTop: 'none' }}>

                {/* === TOP: Record Attempt Button (Main Action) === */}
                {!done && canAttempt(issue) && showContactForm !== issue.id && (
                  <button onClick={(e) => { e.stopPropagation(); setShowContactForm(issue.id); }}
                    className="w-full rounded-md py-3 text-[13px] font-bold mb-4"
                    style={{ background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.35)', color: '#00E5FF' }}>
                    ◉ Record Attempt {issue.attempt + 1}
                  </button>
                )}

                {!done && !canAttempt(issue) && issue.attempt < 3 && (
                  <div className="text-center py-2 mb-4 rounded-md text-[12px]"
                    style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.15)', color: '#F59E0B' }}>
                    ⏳ Next attempt available in {nextAttemptIn(issue) || 'now'} — minimum 1 day between attempts
                  </div>
                )}

                {/* Contact History (always visible if has attempts) */}
                {contacts.length > 0 && (
                  <div className="mb-4">
                    {contacts.map(c => (
                      <div key={c.id} className="flex items-start gap-3 mb-2 pb-2" style={{ borderBottom: '1px solid #1A294060' }}>
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                          style={{
                            background: c.outcome === 'answered' ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.15)',
                            color: c.outcome === 'answered' ? '#10B981' : '#EF4444',
                            border: `1px solid ${c.outcome === 'answered' ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)'}`,
                          }}>
                          {c.attempt_number}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold" style={{ color: c.outcome === 'answered' ? '#10B981' : '#EF4444' }}>
                              {c.outcome === 'answered' ? '✓ Answered' : '✕ No Answer'}
                            </span>
                            {c.resolution && (
                              <span className="text-[11px] px-2 py-[1px] rounded" style={{
                                background: c.resolution === 'reschedule' ? 'rgba(0,229,255,.08)' : 'rgba(107,114,128,.08)',
                                border: `1px solid ${c.resolution === 'reschedule' ? 'rgba(0,229,255,.2)' : 'rgba(107,114,128,.2)'}`,
                                color: c.resolution === 'reschedule' ? '#00E5FF' : '#6B7280',
                              }}>
                                {c.resolution === 'reschedule' ? `Reschedule → ${c.scheduled_date || ''}` : 'Return Confirmed'}
                              </span>
                            )}
                          </div>
                          {c.notes && <div className="text-[12px] mt-1" style={{ color: '#6A8AA8' }}>{c.notes}</div>}
                          <div className="text-[10px] mt-1" style={{ color: '#3A5570' }}>
                            {c.contacted_by_name} · {new Date(c.contacted_at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {contactLoading && <div className="text-xs mb-3" style={{ color: '#4A6080' }}>Loading...</div>}

                {/* === Toggle Buttons: Order Details & Tracking History === */}
                <div className="flex gap-2 mb-3">
                  <button onClick={() => setDetailView(detailView === 'order' ? 'none' : 'order')}
                    className="rounded-md px-4 py-[7px] text-[12px] font-semibold transition-all"
                    style={{
                      background: detailView === 'order' ? 'rgba(0,229,255,.1)' : 'transparent',
                      border: `1px solid ${detailView === 'order' ? 'rgba(0,229,255,.3)' : '#1A2940'}`,
                      color: detailView === 'order' ? '#00E5FF' : '#4A6080',
                    }}>
                    📋 Order Details
                  </button>
                  <button onClick={() => loadTracking(issue.order_id)}
                    className="rounded-md px-4 py-[7px] text-[12px] font-semibold transition-all"
                    style={{
                      background: detailView === 'tracking' ? 'rgba(123,47,190,.1)' : 'transparent',
                      border: `1px solid ${detailView === 'tracking' ? 'rgba(123,47,190,.3)' : '#1A2940'}`,
                      color: detailView === 'tracking' ? '#7B2FBE' : '#4A6080',
                    }}>
                    🚚 Tracking History
                  </button>
                </div>

                {/* Order Details Panel */}
                {detailView === 'order' && (
                  <div className="rounded-lg p-4 mb-3 animate-fadeIn" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                    <div className="grid grid-cols-3 gap-x-6 gap-y-2">
                      {[
                        { l: 'Tracking', v: issue.tracking_number, mono: true, cyan: true },
                        { l: 'Order #', v: issue.order_number },
                        { l: 'Customer', v: issue.customer_name },
                        { l: 'Phone', v: issue.phone, mono: true, purple: true },
                        { l: 'Address', v: issue.address },
                        { l: 'City', v: issue.city },
                        { l: 'Product', v: issue.product },
                        { l: 'Items', v: issue.item_names },
                        { l: 'Amount', v: issue.amount ? `Rs. ${Number(issue.amount).toLocaleString()}` : '' },
                        { l: 'Salesperson', v: issue.salesperson },
                        { l: 'Branch', v: issue.branch },
                        { l: 'Order Status', v: issue.order_status },
                        { l: 'Pickup Date', v: issue.pickup_date ? new Date(issue.pickup_date).toLocaleDateString() : '' },
                        { l: 'Source', v: issue.source },
                        { l: 'Reason', v: issue.reason },
                        { l: 'Domex Branch', v: issue.domex_branch },
                      ].filter(f => f.v).map((f, i) => (
                        <div key={i}>
                          <div className="text-[10px] tracking-[.06em] uppercase mb-[2px]" style={{ color: '#3A5570' }}>{f.l}</div>
                          <div className={`text-[13px] ${f.mono ? 'mono' : ''}`} style={{
                            color: f.cyan ? '#00E5FF' : f.purple ? '#7B2FBE' : '#C8D8E8',
                            fontWeight: f.cyan || f.purple ? 600 : 400,
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          }}>{f.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tracking History Panel */}
                {detailView === 'tracking' && (
                  <div className="rounded-lg p-4 mb-3 animate-fadeIn" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                    {trackingLoading && <div className="text-xs" style={{ color: '#4A6080' }}>Loading...</div>}
                    {!trackingLoading && trackingHistory.length === 0 && (
                      <div className="text-xs" style={{ color: '#2A4060' }}>No tracking data. Click Sync to fetch from Domex.</div>
                    )}
                    {!trackingLoading && trackingHistory.length > 0 && (
                      <div className="relative pl-5">
                        <div className="absolute left-[7px] top-1 bottom-1 w-[2px]" style={{ background: '#1A2940' }} />
                        {trackingHistory.map((s: any, idx: number) => {
                          const isLast = idx === trackingHistory.length - 1;
                          const sc = s.status_code;
                          const statusColor =
                            sc === 'D' || sc === 'PS' || sc === 'CIG' || sc === 'CRC' || sc === 'CBR' ? '#10B981' :
                            sc === 'ATD' ? '#F59E0B' :
                            sc === 'UD' || sc === 'UDH' ? '#EF4444' :
                            sc === 'RTN' || sc === 'RTNQ' || sc === 'R' || sc === 'RTS' ? '#6B7280' :
                            '#00E5FF';
                          return (
                            <div key={idx} className="relative mb-3 last:mb-0">
                              <div className="absolute -left-5 top-[3px] w-[10px] h-[10px] rounded-full border-2"
                                style={{ borderColor: statusColor, background: isLast ? statusColor : '#080D1A' }} />
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
                )}

                {/* Contact Form */}

                {showContactForm === issue.id && (
                  <div className="rounded-lg p-4 mt-2" style={{ background: '#080D1A', border: '1px solid #1A2940' }}>
                    <div className="text-[12px] font-semibold mb-3" style={{ color: '#E8F4FF' }}>
                      Attempt {issue.attempt + 1} of 3
                    </div>

                    {contactError && (
                      <div className="rounded-md p-2 mb-3 text-[11px]"
                        style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#EF4444' }}>
                        {contactError}
                      </div>
                    )}

                    <div className="text-[11px] mb-2" style={{ color: '#4A6080' }}>Customer response:</div>
                    <div className="flex gap-2 mb-3">
                      <button onClick={() => { setContactOutcome('answered'); setResolution(''); }}
                        className="flex-1 rounded-md py-2 text-xs font-semibold"
                        style={{
                          background: contactOutcome === 'answered' ? 'rgba(16,185,129,.15)' : 'transparent',
                          border: `1px solid ${contactOutcome === 'answered' ? 'rgba(16,185,129,.4)' : '#1A2940'}`,
                          color: contactOutcome === 'answered' ? '#10B981' : '#4A6080',
                        }}>✓ Answered</button>
                      <button onClick={() => { setContactOutcome('no_answer'); setResolution(''); }}
                        className="flex-1 rounded-md py-2 text-xs font-semibold"
                        style={{
                          background: contactOutcome === 'no_answer' ? 'rgba(239,68,68,.15)' : 'transparent',
                          border: `1px solid ${contactOutcome === 'no_answer' ? 'rgba(239,68,68,.4)' : '#1A2940'}`,
                          color: contactOutcome === 'no_answer' ? '#EF4444' : '#4A6080',
                        }}>
                        ✕ No Answer{issue.attempt + 1 >= 3 ? ' → Auto-Return' : ''}
                      </button>
                    </div>

                    {contactOutcome === 'answered' && (
                      <>
                        <div className="text-[11px] mb-2" style={{ color: '#4A6080' }}>Resolution:</div>
                        <div className="flex gap-2 flex-wrap mb-3">
                          {resolutionOptions.map(opt => {
                            const key = `${opt.action}:${opt.id}`;
                            const isSelected = resolution === key;
                            const color = opt.action === 'return' ? '#6B7280' : opt.action === 'reschedule' ? '#00E5FF' : '#10B981';
                            return (
                              <button key={opt.id} onClick={() => { setResolution(key); setCustomResolution(''); }}
                                className="rounded-md py-2 px-3 text-xs font-semibold"
                                style={{
                                  background: isSelected ? `${color}1A` : 'transparent',
                                  border: `1px solid ${isSelected ? `${color}4D` : '#1A2940'}`,
                                  color: isSelected ? color : '#4A6080',
                                }}>{opt.label}</button>
                            );
                          })}
                        </div>

                        <div className="mb-3">
                          <div className="text-[11px] mb-1" style={{ color: '#4A6080' }}>Or type custom resolution:</div>
                          <input value={customResolution}
                            onChange={e => { setCustomResolution(e.target.value); if (e.target.value) setResolution(''); }}
                            className="rounded-md px-3 py-[7px] text-[12px] outline-none w-full"
                            style={{
                              background: '#080D1A',
                              border: `1px solid ${customResolution ? 'rgba(0,229,255,.3)' : '#1A2940'}`,
                              color: '#C8D8E8',
                            }}
                            placeholder="e.g. Customer will collect from Domex branch" />
                        </div>

                        {resolution.startsWith('reschedule:') && (
                          <div className="mb-3">
                            <div className="text-[11px] mb-2" style={{ color: '#4A6080' }}>Reschedule date:</div>
                            <div className="flex gap-2 flex-wrap mb-2">
                              {[
                                { label: 'Tomorrow', days: 1 },
                                { label: 'In 2 Days', days: 2 },
                                { label: 'In 3 Days', days: 3 },
                                { label: 'Next Week', days: 7 },
                              ].map(opt => {
                                const d = new Date(); d.setDate(d.getDate() + opt.days);
                                const val = d.toISOString().split('T')[0];
                                return (
                                  <button key={opt.days} onClick={() => setScheduledDate(val)}
                                    className="rounded-md px-3 py-[6px] text-[11px] font-semibold"
                                    style={{
                                      background: scheduledDate === val ? 'rgba(0,229,255,.1)' : 'transparent',
                                      border: `1px solid ${scheduledDate === val ? 'rgba(0,229,255,.3)' : '#1A2940'}`,
                                      color: scheduledDate === val ? '#00E5FF' : '#4A6080',
                                    }}>{opt.label}</button>
                                );
                              })}
                            </div>
                            <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)}
                              className="rounded-md px-3 py-[7px] text-[12px] outline-none w-full"
                              style={{ background: '#0D1B2A', border: '1px solid #1A2940', color: '#C8D8E8' }} />
                          </div>
                        )}
                      </>
                    )}

                    <div className="mb-3">
                      <div className="text-[11px] mb-1" style={{ color: '#4A6080' }}>Notes (optional):</div>
                      <input value={contactNotes} onChange={e => setContactNotes(e.target.value)}
                        className="rounded-md px-3 py-[7px] text-[12px] outline-none w-full"
                        style={{ background: '#0D1B2A', border: '1px solid #1A2940', color: '#C8D8E8' }}
                        placeholder="Add notes..." />
                    </div>

                    {issue.attempt + 1 >= 3 && contactOutcome === 'no_answer' && (
                      <div className="rounded-md p-2 mb-3 text-[11px]"
                        style={{ background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)', color: '#EF4444' }}>
                        ⚠ Final attempt — marking No Answer will trigger Auto-Return. This cannot be undone.
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button onClick={() => submitContact(issue.id)} disabled={submitting || !contactOutcome || (contactOutcome === 'answered' && !resolution && !customResolution.trim())}
                        className="flex-1 rounded-md py-2 text-xs font-semibold"
                        style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', color: '#00E5FF' }}>
                        {submitting ? 'Saving...' : 'Confirm'}
                      </button>
                      <button onClick={() => { setShowContactForm(null); setContactOutcome(''); setResolution(''); setContactError(''); }}
                        className="rounded-md px-4 py-2 text-xs font-semibold"
                        style={{ background: 'transparent', border: '1px solid #1A2940', color: '#4A6080' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        );
      })}

      {total > 0 && (
        <div className="text-center mt-4 text-xs" style={{ color: '#2A4060' }}>{total} total issues</div>
      )}
    </div>
  );
}
