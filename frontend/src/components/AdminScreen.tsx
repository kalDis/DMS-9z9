'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import DateRangeFilter from './DateRangeFilter';

interface Business {
  id: number; name: string; contact_person: string; contact_phone: string;
  sms_sender_id: string; default_branch: string; status: string; user_count: number;
  domex_api_key: string; domex_customer_code: string; domex_sender_name: string;
  domex_sender_address: string; domex_sender_phone: string;
}

interface User {
  id: number; name: string; email: string; role: string; status: string;
  last_login: string; businesses: { id: number; name: string }[];
}

interface AuditLog {
  id: number; user_name: string; action: string; business_name: string; created_at: string;
}

export default function AdminScreen() {
  const [tab, setTab] = useState<'businesses' | 'users' | 'settings' | 'audit'>('businesses');
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [showBizForm, setShowBizForm] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [bizForm, setBizForm] = useState({ name: '', contact_person: '', contact_phone: '', sms_sender_id: '', default_branch: '' });
  const [userForm, setUserForm] = useState({ name: '', email: '', role: '', business_ids: [] as number[] });
  const [tempPw, setTempPw] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [domexEditId, setDomexEditId] = useState<number | null>(null);
  const [domexForm, setDomexForm] = useState({ domex_api_key: '', domex_customer_code: '', domex_sender_name: '', domex_sender_address: '', domex_sender_phone: '' });
  const [domexTesting, setDomexTesting] = useState(false);
  const [domexTestResult, setDomexTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [resOptions, setResOptions] = useState<any[]>([]);
  const [resBizId, setResBizId] = useState<number | null>(null);
  const [newResLabel, setNewResLabel] = useState('');
  const [newResAction, setNewResAction] = useState('resolve');
  const [auditDateFrom, setAuditDateFrom] = useState('');
  const [auditDateTo, setAuditDateTo] = useState('');

  const fetchAll = () => {
    const auditParams = new URLSearchParams();
    if (auditDateFrom) auditParams.set('date_from', auditDateFrom);
    if (auditDateTo) auditParams.set('date_to', auditDateTo);
    api('/businesses').then(setBusinesses).catch(() => {});
    api('/users').then(setUsers).catch(() => {});
    api(`/audit?${auditParams}`).then(setAudit).catch(() => {});
  };

  useEffect(() => { fetchAll(); }, [auditDateFrom, auditDateTo]);

  const createBiz = async () => {
    if (!bizForm.name) return alert('Business Name required');
    await api('/businesses', { method: 'POST', body: JSON.stringify(bizForm) });
    setBizForm({ name: '', contact_person: '', contact_phone: '', sms_sender_id: '', default_branch: '' });
    setShowBizForm(false);
    fetchAll();
  };

  const toggleBizStatus = async (b: Business) => {
    await api(`/businesses/${b.id}`, { method: 'PUT', body: JSON.stringify({ status: b.status === 'active' ? 'inactive' : 'active' }) });
    fetchAll();
  };

  const createUser = async () => {
    if (!userForm.name || !userForm.email || !userForm.role) return alert('All fields required');
    if (!userForm.business_ids.length && userForm.role !== 'admin') return alert('Select at least one business');
    const data = await api('/users', { method: 'POST', body: JSON.stringify(userForm) });
    setTempPw(data.temp_password);
    setEmailSent(data.email_sent);
    setUserForm({ name: '', email: '', role: '', business_ids: [] });
    setShowUserForm(false);
    fetchAll();
  };

  const openEditUser = (u: User) => {
    setEditUserId(u.id);
    setUserForm({ name: u.name, email: u.email, role: u.role, business_ids: u.businesses.map(b => b.id) });
    setShowUserForm(false);
  };

  const saveEditUser = async () => {
    if (!editUserId) return;
    await api(`/users/${editUserId}`, { method: 'PUT', body: JSON.stringify(userForm) });
    setEditUserId(null);
    setUserForm({ name: '', email: '', role: '', business_ids: [] });
    fetchAll();
  };

  const toggleUserStatus = async (u: User) => {
    await api(`/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ status: u.status === 'active' ? 'inactive' : 'active' }) });
    fetchAll();
  };

  const resetPw = async (u: User) => {
    const data = await api(`/users/${u.id}/reset-password`, { method: 'POST' });
    setTempPw(data.temp_password);
    setEmailSent(data.email_sent);
  };

  const toggleBizId = (bizId: number) => {
    const ids = userForm.business_ids.includes(bizId)
      ? userForm.business_ids.filter(id => id !== bizId)
      : [...userForm.business_ids, bizId];
    setUserForm({ ...userForm, business_ids: ids });
  };

  const tabs = [
    { id: 'businesses' as const, label: 'Businesses' },
    { id: 'users' as const, label: 'Users' },
    { id: 'settings' as const, label: 'Settings' },
    { id: 'audit' as const, label: 'Audit Log' },
  ];

  const initials = (name: string) => name.split(' ').map(n => n[0]).join('').slice(0, 2);

  const loadResOptions = async (bizId: number) => {
    setResBizId(bizId);
    const data = await api(`/settings/resolution-options/${bizId}`);
    setResOptions(data);
  };

  const addResOption = async () => {
    if (!newResLabel.trim() || !resBizId) return;
    await api(`/settings/resolution-options/${resBizId}`, {
      method: 'POST', body: JSON.stringify({ label: newResLabel.trim(), action: newResAction }),
    });
    setNewResLabel('');
    setNewResAction('resolve');
    loadResOptions(resBizId);
  };

  const toggleResOption = async (id: number, isActive: number) => {
    await api(`/settings/resolution-options/${id}`, {
      method: 'PUT', body: JSON.stringify({ is_active: isActive ? 0 : 1 }),
    });
    if (resBizId) loadResOptions(resBizId);
  };

  const deleteResOption = async (id: number) => {
    await api(`/settings/resolution-options/${id}`, { method: 'DELETE' });
    if (resBizId) loadResOptions(resBizId);
  };

  const openDomexConfig = (b: Business) => {
    setDomexEditId(b.id);
    setDomexForm({
      domex_api_key: b.domex_api_key || '',
      domex_customer_code: b.domex_customer_code || '',
      domex_sender_name: b.domex_sender_name || '',
      domex_sender_address: b.domex_sender_address || '',
      domex_sender_phone: b.domex_sender_phone || '',
    });
    setDomexTestResult(null);
  };

  const saveDomexConfig = async () => {
    if (!domexEditId) return;
    await api(`/businesses/${domexEditId}`, { method: 'PUT', body: JSON.stringify(domexForm) });
    setDomexEditId(null);
    fetchAll();
  };

  const testDomexConnection = async () => {
    setDomexTesting(true);
    setDomexTestResult(null);
    try {
      const data = await api('/sync/test-connection', {
        method: 'POST',
        body: JSON.stringify({ api_key: domexForm.domex_api_key, customer_code: domexForm.domex_customer_code }),
      });
      setDomexTestResult(data);
    } catch (err: any) {
      setDomexTestResult({ success: false, message: err.message });
    }
    setDomexTesting(false);
  };

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-[22px]">
        <div>
          <div className="text-[10px] tracking-[.1em] uppercase" style={{ color: '#4A6080' }}>System Administration</div>
          <div className="text-xl font-bold mt-[2px]" style={{ color: '#E8F4FF' }}>Admin Panel</div>
        </div>
        <div className="rounded-md px-[14px] py-[6px] text-xs font-semibold"
          style={{ background: 'rgba(123,47,190,.1)', border: '1px solid rgba(123,47,190,.3)', color: '#7B2FBE' }}>
          ⚙ Admin Only
        </div>
      </div>

      {tempPw && (
        <div className="rounded-lg p-3 mb-4" style={{ background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.25)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: '#10B981' }}>Temporary password: <span className="mono font-bold">{tempPw}</span></span>
            <button onClick={() => { setTempPw(''); setEmailSent(false); }} className="text-xs" style={{ color: '#4A6080' }}>✕</button>
          </div>
          <div className="text-[11px] mt-1" style={{ color: emailSent ? '#10B981' : '#F59E0B' }}>
            {emailSent ? '✓ Credentials email sent to user' : '⚠ Email not configured — share password manually'}
          </div>
          <div className="text-[10px] mt-1" style={{ color: '#4A6080' }}>User must change password on first login</div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex mb-[18px]" style={{ borderBottom: '1px solid #1A2940' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setShowBizForm(false); setShowUserForm(false); }}
            className="px-5 py-[10px] text-[13px] -mb-px transition-all"
            style={{
              color: tab === t.id ? '#00E5FF' : '#4A6080',
              borderBottom: tab === t.id ? '2px solid #00E5FF' : '2px solid transparent',
              fontWeight: tab === t.id ? 600 : 400,
              background: 'transparent',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Businesses Tab */}
      {tab === 'businesses' && (
        <>
          <div className="flex justify-end mb-[14px]">
            <button onClick={() => setShowBizForm(!showBizForm)}
              className="rounded-md px-4 py-2 text-xs font-semibold"
              style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', color: '#00E5FF' }}>
              + New Business
            </button>
          </div>

          {showBizForm && (
            <div className="rounded-[10px] p-[18px] mb-[18px] relative overflow-hidden"
              style={{ background: '#0D1B2A', border: '1px solid rgba(0,229,255,.25)' }}>
              <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #00E5FF, transparent)' }} />
              <div className="text-[13px] font-semibold mb-[14px]" style={{ color: '#00E5FF' }}>Create New Business</div>
              <div className="grid grid-cols-2 gap-[10px]">
                {[
                  { key: 'name', ph: 'Business Name *' },
                  { key: 'contact_person', ph: 'Contact Person' },
                  { key: 'contact_phone', ph: 'Contact Phone' },
                  { key: 'sms_sender_id', ph: 'SMS Sender ID (e.g. MYSHOP)' },
                ].map(f => (
                  <input key={f.key} className="rounded-lg px-[14px] py-[9px] text-[13px] outline-none"
                    style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}
                    placeholder={f.ph}
                    value={(bizForm as any)[f.key]}
                    onChange={e => setBizForm({ ...bizForm, [f.key]: e.target.value })} />
                ))}
                <input className="rounded-lg px-[14px] py-[9px] text-[13px] outline-none col-span-2"
                  style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}
                  placeholder="Default Delivery Branch"
                  value={bizForm.default_branch}
                  onChange={e => setBizForm({ ...bizForm, default_branch: e.target.value })} />
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={createBiz} className="flex-1 rounded-md py-2 text-xs font-semibold"
                  style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', color: '#00E5FF' }}>
                  Create Business
                </button>
                <button onClick={() => setShowBizForm(false)} className="rounded-md px-4 py-2 text-xs font-semibold"
                  style={{ background: 'transparent', border: '1px solid #1A2940', color: '#4A6080' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-[10px] px-4 py-[7px] text-[10px] tracking-[.08em] uppercase mb-1"
            style={{ gridTemplateColumns: '1fr 140px 100px 80px 80px 200px', color: '#2A4060' }}>
            <span>Business Name</span><span>Contact</span><span>Branch</span><span>Users</span><span>API</span><span>Actions</span>
          </div>

          {businesses.map(b => (
            <div key={b.id} className="mb-[5px]">
              <div className="grid gap-[10px] px-4 py-3 rounded-lg items-center"
                style={{
                  gridTemplateColumns: '1fr 140px 100px 80px 80px 200px',
                  background: domexEditId === b.id ? '#0F2236' : '#0D1B2A',
                  border: domexEditId === b.id ? '1px solid rgba(0,229,255,.25)' : '1px solid #1A2940',
                  borderRadius: domexEditId === b.id ? '8px 8px 0 0' : '8px',
                }}>
                <div className="flex items-center gap-2">
                  <span className="inline-block w-[7px] h-[7px] rounded-full shrink-0"
                    style={{ background: b.status === 'active' ? '#10B981' : '#3A5570', boxShadow: b.status === 'active' ? '0 0 6px #10B981' : 'none' }} />
                  <span className="text-[13px] font-semibold" style={{ color: '#C8D8E8' }}>{b.name}</span>
                </div>
                <span className="text-xs" style={{ color: '#4A6080' }}>{b.contact_person || '—'}</span>
                <span className="text-xs" style={{ color: '#4A6080' }}>{b.default_branch || '—'}</span>
                <span className="mono text-xs" style={{ color: '#4A6080' }}>{b.user_count}</span>
                <span className="text-[10px] px-2 py-[2px] rounded" style={{
                  color: b.domex_api_key ? '#10B981' : '#4A6080',
                  background: b.domex_api_key ? 'rgba(16,185,129,.08)' : 'transparent',
                  border: `1px solid ${b.domex_api_key ? 'rgba(16,185,129,.2)' : '#1A2940'}`,
                }}>{b.domex_api_key ? '● Connected' : '○ Not set'}</span>
                <div className="flex gap-[5px]">
                  <button onClick={() => domexEditId === b.id ? setDomexEditId(null) : openDomexConfig(b)}
                    className="rounded-md px-[8px] py-1 text-[11px] font-semibold"
                    style={{ background: 'rgba(123,47,190,.08)', border: '1px solid rgba(123,47,190,.3)', color: '#7B2FBE' }}>
                    API
                  </button>
                  <button className="rounded-md px-[8px] py-1 text-[11px] font-semibold"
                    style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', color: '#00E5FF' }}>
                    Edit
                  </button>
                  <button onClick={() => toggleBizStatus(b)}
                    className="rounded-md px-[8px] py-1 text-[11px] font-semibold"
                    style={{
                      background: b.status === 'active' ? 'rgba(239,68,68,.06)' : 'rgba(16,185,129,.06)',
                      border: `1px solid ${b.status === 'active' ? 'rgba(239,68,68,.3)' : 'rgba(16,185,129,.3)'}`,
                      color: b.status === 'active' ? '#EF4444' : '#10B981',
                    }}>
                    {b.status === 'active' ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>

              {/* Domex API Config Panel */}
              {domexEditId === b.id && (
                <div className="rounded-b-lg px-5 py-4 animate-fadeIn"
                  style={{ background: '#0F2236', border: '1px solid rgba(0,229,255,.25)', borderTop: 'none' }}>
                  <div className="text-[12px] font-semibold mb-3" style={{ color: '#7B2FBE' }}>Domex API Configuration</div>
                  <div className="grid grid-cols-2 gap-[10px] mb-3">
                    <input className="rounded-md px-3 py-[7px] text-[12px] outline-none"
                      style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}
                      placeholder="API Key *" value={domexForm.domex_api_key}
                      onChange={e => setDomexForm({ ...domexForm, domex_api_key: e.target.value })} />
                    <input className="rounded-md px-3 py-[7px] text-[12px] outline-none"
                      style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}
                      placeholder="Customer Code *" value={domexForm.domex_customer_code}
                      onChange={e => setDomexForm({ ...domexForm, domex_customer_code: e.target.value })} />
                    <input className="rounded-md px-3 py-[7px] text-[12px] outline-none"
                      style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}
                      placeholder="Sender Name" value={domexForm.domex_sender_name}
                      onChange={e => setDomexForm({ ...domexForm, domex_sender_name: e.target.value })} />
                    <input className="rounded-md px-3 py-[7px] text-[12px] outline-none"
                      style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}
                      placeholder="Sender Phone" value={domexForm.domex_sender_phone}
                      onChange={e => setDomexForm({ ...domexForm, domex_sender_phone: e.target.value })} />
                    <input className="rounded-md px-3 py-[7px] text-[12px] outline-none col-span-2"
                      style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}
                      placeholder="Sender Address" value={domexForm.domex_sender_address}
                      onChange={e => setDomexForm({ ...domexForm, domex_sender_address: e.target.value })} />
                  </div>
                  {domexTestResult && (
                    <div className="rounded-md p-2 mb-3 text-[11px]" style={{
                      background: domexTestResult.success ? 'rgba(16,185,129,.06)' : 'rgba(239,68,68,.06)',
                      border: `1px solid ${domexTestResult.success ? 'rgba(16,185,129,.25)' : 'rgba(239,68,68,.25)'}`,
                      color: domexTestResult.success ? '#10B981' : '#EF4444',
                    }}>{domexTestResult.success ? '✓' : '✕'} {domexTestResult.message}</div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={testDomexConnection} disabled={domexTesting || !domexForm.domex_api_key || !domexForm.domex_customer_code}
                      className="rounded-md px-3 py-[6px] text-[11px] font-semibold"
                      style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', color: '#F59E0B' }}>
                      {domexTesting ? 'Testing...' : 'Test Connection'}
                    </button>
                    <button onClick={saveDomexConfig}
                      className="flex-1 rounded-md py-[6px] text-[11px] font-semibold"
                      style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', color: '#00E5FF' }}>
                      Save API Settings
                    </button>
                    <button onClick={() => setDomexEditId(null)}
                      className="rounded-md px-3 py-[6px] text-[11px] font-semibold"
                      style={{ background: 'transparent', border: '1px solid #1A2940', color: '#4A6080' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* Users Tab */}
      {tab === 'users' && (
        <>
          <div className="flex justify-end mb-[14px]">
            <button onClick={() => { setShowUserForm(!showUserForm); setEditUserId(null); setUserForm({ name: '', email: '', role: '', business_ids: [] }); }}
              className="rounded-md px-4 py-2 text-xs font-semibold"
              style={{ background: 'rgba(123,47,190,.08)', border: '1px solid rgba(123,47,190,.35)', color: '#7B2FBE' }}>
              + New User
            </button>
          </div>

          {(showUserForm || editUserId) && (
            <div className="rounded-[10px] p-[18px] mb-[18px] relative overflow-hidden"
              style={{ background: '#0D1B2A', border: `1px solid ${editUserId ? 'rgba(0,229,255,.3)' : 'rgba(123,47,190,.3)'}` }}>
              <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${editUserId ? '#00E5FF' : '#7B2FBE'}, transparent)` }} />
              <div className="text-[13px] font-semibold mb-[14px]" style={{ color: editUserId ? '#00E5FF' : '#7B2FBE' }}>
                {editUserId ? 'Edit User' : 'Create New User'}
              </div>
              <div className="grid grid-cols-2 gap-[10px]">
                <input className="rounded-lg px-[14px] py-[9px] text-[13px] outline-none"
                  style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}
                  placeholder="Full Name *"
                  value={userForm.name}
                  onChange={e => setUserForm({ ...userForm, name: e.target.value })} />
                <input className="rounded-lg px-[14px] py-[9px] text-[13px] outline-none" type="email"
                  style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}
                  placeholder="Email Address *"
                  value={userForm.email}
                  onChange={e => setUserForm({ ...userForm, email: e.target.value })} />
                <select className="rounded-lg px-[14px] py-[9px] text-[13px] outline-none"
                  style={{ background: '#080D1A', border: '1px solid #1A2940', color: userForm.role ? '#C8D8E8' : '#2A4060' }}
                  value={userForm.role}
                  onChange={e => setUserForm({ ...userForm, role: e.target.value })}>
                  <option value="" disabled>Select Role *</option>
                  <option value="admin">Admin</option>
                  <option value="issue_handler">Issue Handler</option>
                  <option value="viewer">Viewer</option>
                </select>
                <div>
                  <div className="text-[10px] mb-1" style={{ color: '#4A6080' }}>Assign Businesses {userForm.role !== 'admin' ? '*' : ''}</div>
                  <div className="flex gap-1 flex-wrap">
                    {businesses.map(b => (
                      <button key={b.id} onClick={() => toggleBizId(b.id)}
                        className="rounded-md px-2 py-[4px] text-[11px] transition-all"
                        style={{
                          background: userForm.business_ids.includes(b.id) ? 'rgba(0,229,255,.1)' : 'transparent',
                          border: `1px solid ${userForm.business_ids.includes(b.id) ? 'rgba(0,229,255,.3)' : '#1A2940'}`,
                          color: userForm.business_ids.includes(b.id) ? '#00E5FF' : '#4A6080',
                        }}>{b.name}</button>
                    ))}
                  </div>
                </div>
              </div>
              {!editUserId && (
                <div className="rounded-md p-[10px_12px] text-[11px] mt-[10px]"
                  style={{ background: 'rgba(0,229,255,.05)', border: '1px solid rgba(0,229,255,.12)', color: '#4A6080' }}>
                  🔑 Temp password auto-generated. Email sent if SMTP configured. User must change on first login.
                </div>
              )}
              <div className="flex gap-2 mt-3">
                <button onClick={editUserId ? saveEditUser : createUser} className="flex-1 rounded-md py-2 text-xs font-semibold"
                  style={{ background: editUserId ? 'rgba(0,229,255,.08)' : 'rgba(123,47,190,.08)', border: `1px solid ${editUserId ? 'rgba(0,229,255,.3)' : 'rgba(123,47,190,.35)'}`, color: editUserId ? '#00E5FF' : '#7B2FBE' }}>
                  {editUserId ? 'Save Changes' : 'Create User'}
                </button>
                <button onClick={() => { setShowUserForm(false); setEditUserId(null); setUserForm({ name: '', email: '', role: '', business_ids: [] }); }} className="rounded-md px-4 py-2 text-xs font-semibold"
                  style={{ background: 'transparent', border: '1px solid #1A2940', color: '#4A6080' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-[10px] px-4 py-[7px] text-[10px] tracking-[.08em] uppercase mb-1"
            style={{ gridTemplateColumns: '1fr 120px 120px 100px 70px 220px', color: '#2A4060' }}>
            <span>Name / Email</span><span>Role</span><span>Business</span><span>Last Login</span><span>Status</span><span>Actions</span>
          </div>

          {users.map(u => {
            const roleColors: Record<string, { c: string; bg: string; bc: string }> = {
              admin: { c: '#7B2FBE', bg: 'rgba(123,47,190,.1)', bc: 'rgba(123,47,190,.3)' },
              issue_handler: { c: '#00E5FF', bg: 'rgba(0,229,255,.08)', bc: 'rgba(0,229,255,.25)' },
              viewer: { c: '#4A6080', bg: 'rgba(107,114,128,.08)', bc: 'rgba(107,114,128,.2)' },
            };
            const rc = roleColors[u.role] || roleColors.viewer;
            const roleLabel = u.role === 'issue_handler' ? 'Issue Handler' : u.role.charAt(0).toUpperCase() + u.role.slice(1);
            const bizNames = u.businesses?.map(b => b.name).join(', ') || (u.role === 'admin' ? 'All' : '—');
            const lastLogin = u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never';

            return (
              <div key={u.id} className="grid gap-[10px] px-4 py-3 rounded-lg items-center mb-[5px]"
                style={{ gridTemplateColumns: '1fr 120px 120px 100px 70px 220px', background: '#0D1B2A', border: '1px solid #1A2940' }}>
                <div className="flex items-center gap-[10px]">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                    style={{ background: 'linear-gradient(135deg, #7B2FBE, #00E5FF)' }}>
                    {initials(u.name)}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold" style={{ color: '#C8D8E8' }}>{u.name}</div>
                    <div className="text-[11px]" style={{ color: '#3A5570' }}>{u.email}</div>
                  </div>
                </div>
                <span className="rounded px-[10px] py-[2px] text-[11px] font-semibold inline-block w-fit"
                  style={{ color: rc.c, background: rc.bg, border: `1px solid ${rc.bc}` }}>
                  {roleLabel}
                </span>
                <span className="text-xs" style={{ color: '#4A6080' }}>{bizNames}</span>
                <span className="mono text-[11px]" style={{ color: '#3A5570' }}>{lastLogin}</span>
                <span className="text-xs font-semibold" style={{ color: u.status === 'active' ? '#10B981' : '#4A6080' }}>{u.status}</span>
                <div className="flex gap-[5px]">
                  <button onClick={() => openEditUser(u)} className="rounded-md px-2 py-1 text-[11px] font-semibold"
                    style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', color: '#00E5FF' }}>Edit</button>
                  <button onClick={() => resetPw(u)} className="rounded-md px-2 py-1 text-[11px] font-semibold"
                    style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)', color: '#F59E0B' }}>Reset PW</button>
                  <button onClick={() => toggleUserStatus(u)} className="rounded-md px-2 py-1 text-[11px] font-semibold"
                    style={{
                      background: u.status === 'active' ? 'rgba(239,68,68,.06)' : 'rgba(16,185,129,.06)',
                      border: `1px solid ${u.status === 'active' ? 'rgba(239,68,68,.2)' : 'rgba(16,185,129,.2)'}`,
                      color: u.status === 'active' ? '#EF4444' : '#10B981',
                    }}>
                    {u.status === 'active' ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={async () => {
                    if (!confirm(`Delete user ${u.name}? This cannot be undone.`)) return;
                    try { await api(`/users/${u.id}`, { method: 'DELETE' }); fetchAll(); } catch (err: any) { alert(err.message); }
                  }} className="rounded-md px-2 py-1 text-[11px] font-semibold"
                    style={{ background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)', color: '#EF4444' }}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Settings Tab */}
      {tab === 'settings' && (
        <>
          <div className="text-[13px] font-semibold mb-3" style={{ color: '#E8F4FF' }}>Resolution Options</div>
          <div className="text-xs mb-4" style={{ color: '#4A6080' }}>
            Configure the resolution options shown when staff contacts a customer. Each business can have its own options.
          </div>

          {/* Business selector for settings */}
          <div className="mb-4">
            <div className="text-[11px] mb-2" style={{ color: '#4A6080' }}>Select business:</div>
            <div className="flex gap-2 flex-wrap">
              {businesses.map(b => (
                <button key={b.id} onClick={() => loadResOptions(b.id)}
                  className="rounded-md px-3 py-[6px] text-[12px] font-semibold"
                  style={{
                    background: resBizId === b.id ? 'rgba(0,229,255,.1)' : 'transparent',
                    border: `1px solid ${resBizId === b.id ? 'rgba(0,229,255,.3)' : '#1A2940'}`,
                    color: resBizId === b.id ? '#00E5FF' : '#4A6080',
                  }}>{b.name}</button>
              ))}
            </div>
          </div>

          {resBizId && (
            <>
              {/* Existing options */}
              <div className="space-y-[6px] mb-4">
                {resOptions.map(opt => (
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
                    <button onClick={() => toggleResOption(opt.id, opt.is_active)}
                      className="rounded-md px-2 py-1 text-[11px] font-semibold"
                      style={{
                        background: opt.is_active ? 'rgba(245,158,11,.06)' : 'rgba(16,185,129,.06)',
                        border: `1px solid ${opt.is_active ? 'rgba(245,158,11,.2)' : 'rgba(16,185,129,.2)'}`,
                        color: opt.is_active ? '#F59E0B' : '#10B981',
                      }}>{opt.is_active ? 'Disable' : 'Enable'}</button>
                    <button onClick={() => deleteResOption(opt.id)}
                      className="rounded-md px-2 py-1 text-[11px] font-semibold"
                      style={{ background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)', color: '#EF4444' }}>
                      Delete
                    </button>
                  </div>
                ))}
              </div>

              {/* Add new option */}
              <div className="rounded-lg p-4" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
                <div className="text-[12px] font-semibold mb-3" style={{ color: '#E8F4FF' }}>Add New Option</div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <div className="text-[10px] mb-1" style={{ color: '#4A6080' }}>Label</div>
                    <input value={newResLabel} onChange={e => setNewResLabel(e.target.value)}
                      className="w-full rounded-md px-3 py-[7px] text-[12px] outline-none"
                      style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}
                      placeholder="e.g. Customer Will Collect" />
                  </div>
                  <div>
                    <div className="text-[10px] mb-1" style={{ color: '#4A6080' }}>Action</div>
                    <select value={newResAction} onChange={e => setNewResAction(e.target.value)}
                      className="rounded-md px-3 py-[7px] text-[12px] outline-none"
                      style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}>
                      <option value="resolve">Resolve (keep order)</option>
                      <option value="reschedule">Reschedule (pick date)</option>
                      <option value="return">Return (mark as returned)</option>
                    </select>
                  </div>
                  <button onClick={addResOption}
                    className="rounded-md px-4 py-[7px] text-[12px] font-semibold"
                    style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', color: '#00E5FF' }}>
                    Add
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Audit Tab */}
      {tab === 'audit' && (
        <>
          <div className="mb-4">
            <DateRangeFilter
              onFilter={(from, to) => { setAuditDateFrom(from); setAuditDateTo(to); }}
              onClear={() => { setAuditDateFrom(''); setAuditDateTo(''); }}
            />
          </div>
          <div className="grid gap-[10px] px-4 py-[7px] text-[10px] tracking-[.08em] uppercase mb-1"
            style={{ gridTemplateColumns: '140px 1fr 120px 150px', color: '#2A4060' }}>
            <span>User</span><span>Action</span><span>Business</span><span>Time</span>
          </div>
          {audit.map(a => (
            <div key={a.id} className="grid gap-[10px] px-4 py-3 rounded-lg items-center mb-[5px]"
              style={{ gridTemplateColumns: '140px 1fr 120px 150px', background: '#0D1B2A', border: '1px solid #1A2940' }}>
              <span className="text-[13px] font-semibold" style={{ color: '#C8D8E8' }}>{a.user_name}</span>
              <span className="text-xs" style={{ color: '#6A8AA8' }}>{a.action}</span>
              <span className="text-xs" style={{ color: '#4A6080' }}>{a.business_name}</span>
              <span className="mono text-[11px]" style={{ color: '#2A4060' }}>
                {new Date(a.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
