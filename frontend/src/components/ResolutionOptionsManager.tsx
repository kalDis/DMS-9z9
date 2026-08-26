'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface ResolutionOption { id: number; label: string; action: string; is_active: number; }

// Add / enable / delete resolution options for one business. Self-fetches when
// businessId changes. Used by the Admin panel and the staff Settings page.
export default function ResolutionOptionsManager({ businessId }: { businessId: number | null }) {
  const [options, setOptions] = useState<ResolutionOption[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newAction, setNewAction] = useState('resolve');

  const load = () => {
    if (!businessId) { setOptions([]); return; }
    api(`/settings/resolution-options/${businessId}`).then(setOptions).catch(() => {});
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [businessId]);

  const add = async () => {
    if (!newLabel.trim() || !businessId) return;
    try {
      await api(`/settings/resolution-options/${businessId}`, { method: 'POST', body: JSON.stringify({ label: newLabel.trim(), action: newAction }) });
      setNewLabel(''); setNewAction('resolve'); load();
    } catch (err: any) { alert(err.message || 'Failed to add'); }
  };

  const toggle = async (id: number, isActive: number) => {
    try { await api(`/settings/resolution-options/${id}`, { method: 'PUT', body: JSON.stringify({ is_active: isActive ? 0 : 1 }) }); load(); }
    catch (err: any) { alert(err.message || 'Failed'); }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this resolution option?')) return;
    try { await api(`/settings/resolution-options/${id}`, { method: 'DELETE' }); load(); }
    catch (err: any) { alert(err.message || 'Failed'); }
  };

  if (!businessId) return null;

  return (
    <>
      <div className="space-y-[6px] mb-4">
        {options.length === 0 && (
          <div className="text-xs" style={{ color: '#2A4060' }}>No resolution options yet — add one below.</div>
        )}
        {options.map(opt => (
          <div key={opt.id} className="flex items-center gap-3 rounded-lg px-4 py-3"
            style={{ background: '#0D1B2A', border: '1px solid #1A2940', opacity: opt.is_active ? 1 : 0.5 }}>
            <div className="flex-1">
              <span className="text-[13px] font-medium" style={{ color: '#C8D8E8' }}>{opt.label}</span>
              <span className="text-[10px] ml-2 px-2 py-[1px] rounded" style={{
                color: opt.action === 'return' ? '#6B7280' : opt.action === 'reschedule' ? '#00E5FF' : '#10B981',
                background: opt.action === 'return' ? 'rgba(107,114,128,.08)' : opt.action === 'reschedule' ? 'rgba(0,229,255,.08)' : 'rgba(16,185,129,.08)',
                border: `1px solid ${opt.action === 'return' ? 'rgba(107,114,128,.2)' : opt.action === 'reschedule' ? 'rgba(0,229,255,.2)' : 'rgba(16,185,129,.2)'}`,
              }}>{opt.action}</span>
            </div>
            <button onClick={() => toggle(opt.id, opt.is_active)}
              className="rounded-md px-2 py-1 text-[11px] font-semibold"
              style={{
                background: opt.is_active ? 'rgba(245,158,11,.06)' : 'rgba(16,185,129,.06)',
                border: `1px solid ${opt.is_active ? 'rgba(245,158,11,.2)' : 'rgba(16,185,129,.2)'}`,
                color: opt.is_active ? '#F59E0B' : '#10B981',
              }}>{opt.is_active ? 'Disable' : 'Enable'}</button>
            <button onClick={() => remove(opt.id)}
              className="rounded-md px-2 py-1 text-[11px] font-semibold"
              style={{ background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)', color: '#EF4444' }}>
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-lg p-4" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
        <div className="text-[12px] font-semibold mb-3" style={{ color: '#E8F4FF' }}>Add New Option</div>
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <div className="text-[10px] mb-1" style={{ color: '#4A6080' }}>Label</div>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
              className="w-full rounded-md px-3 py-[7px] text-[12px] outline-none"
              style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}
              placeholder="e.g. Customer Will Collect" />
          </div>
          <div>
            <div className="text-[10px] mb-1" style={{ color: '#4A6080' }}>Action</div>
            <select value={newAction} onChange={e => setNewAction(e.target.value)}
              className="rounded-md px-3 py-[7px] text-[12px] outline-none"
              style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}>
              <option value="resolve">Resolve (keep order)</option>
              <option value="reschedule">Reschedule (pick date)</option>
              <option value="return">Return (mark as returned)</option>
            </select>
          </div>
          <button onClick={add}
            className="rounded-md px-4 py-[7px] text-[12px] font-semibold"
            style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', color: '#00E5FF' }}>
            Add
          </button>
        </div>
      </div>
    </>
  );
}
