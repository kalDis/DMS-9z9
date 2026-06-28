'use client';
import { useAuth } from '@/lib/auth-context';

const NAV_ITEMS = [
  { id: 'overview', icon: '⬡', label: 'Overview' },
  { id: 'orders', icon: '◈', label: 'Orders' },
  { id: 'issues', icon: '◉', label: 'Issues', badge: true },
  { id: 'sms', icon: '▷', label: 'SMS', badgeWarn: true },
  { id: 'export', icon: '⬒', label: 'Export' },
  { id: 'admin', icon: '⚙', label: 'Admin Panel', adminOnly: true },
];

interface SidebarProps {
  activeScreen: string;
  onNavigate: (screen: string) => void;
}

export default function Sidebar({ activeScreen, onNavigate }: SidebarProps) {
  const { user, businesses, activeBusiness, setActiveBusiness, logout } = useAuth();

  const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2) || '??';

  return (
    <aside className="w-[220px] shrink-0 flex flex-col h-screen overflow-hidden"
      style={{ background: '#0A1220', borderRight: '1px solid #1A2940' }}>

      {/* Logo */}
      <div className="px-[18px] pt-[22px] pb-[18px] flex items-center gap-[10px]"
        style={{ borderBottom: '1px solid #1A2940' }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
          style={{ background: 'linear-gradient(135deg, rgba(0,229,255,.15), rgba(123,47,190,.2))', border: '1px solid rgba(0,229,255,.35)' }}>
          ⬡
        </div>
        <div>
          <div className="text-white text-sm font-bold tracking-[.04em]">DMS</div>
          <div className="text-[9px] tracking-[.12em] uppercase" style={{ color: '#2A4060' }}>Delivery System</div>
        </div>
      </div>

      {/* Business Selector */}
      {businesses.length > 0 && (
        <div className="px-[14px] py-[10px]" style={{ borderBottom: '1px solid #1A2940' }}>
          <div className="text-[9px] tracking-[.1em] uppercase mb-[5px]" style={{ color: '#2A4060' }}>Business Unit</div>
          <select
            value={activeBusiness?.id || ''}
            onChange={e => {
              const b = businesses.find(b => b.id === Number(e.target.value));
              if (b) setActiveBusiness(b);
            }}
            className="w-full rounded-md px-[10px] py-[7px] text-xs outline-none"
            style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#00E5FF' }}
          >
            {businesses.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-[10px] py-[10px] overflow-y-auto">
        {NAV_ITEMS.map(item => {
          if (item.adminOnly && user?.role !== 'admin') return null;
          const active = activeScreen === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className="flex items-center gap-[10px] px-3 py-[10px] rounded-[7px] mb-[2px] text-[13px] w-full text-left transition-all"
              style={{
                color: active ? '#00E5FF' : '#4A6080',
                background: active ? 'rgba(0,229,255,.07)' : 'transparent',
                border: active ? '1px solid rgba(0,229,255,.2)' : '1px solid transparent',
              }}
            >
              <span className="text-[15px] shrink-0">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-[14px] flex items-center gap-[10px]" style={{ borderTop: '1px solid #1A2940' }}>
        <div className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
          style={{ background: 'linear-gradient(135deg, #7B2FBE, #00E5FF)' }}>
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs truncate" style={{ color: '#8ABBE0' }}>{user?.name}</div>
          <div className="text-[10px] capitalize" style={{ color: '#2A4060' }}>{user?.role?.replace('_', ' ')}</div>
        </div>
        <button onClick={logout} className="text-[10px] px-2 py-1 rounded"
          style={{ color: '#4A6080', border: '1px solid #1A2940' }} title="Logout">
          ↗
        </button>
      </div>
    </aside>
  );
}
