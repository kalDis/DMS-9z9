'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import OverviewScreen from '@/components/OverviewScreen';
import OrdersScreen from '@/components/OrdersScreen';
import AdminScreen from '@/components/AdminScreen';
import IssuesScreen from '@/components/IssuesScreen';
import ExportScreen from '@/components/ExportScreen';

const SCREEN_LABELS: Record<string, string> = {
  overview: 'Overview',
  orders: 'Orders',
  issues: 'Issue Queue',
  sms: 'SMS Log',
  export: 'Domex Export',
  admin: 'Admin Panel',
};

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [screen, setScreen] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ last_sync: string | null; status: string; progress: number; total: number; updated: number; errors: number }>({ last_sync: null, status: 'idle', progress: 0, total: 0, updated: 0, errors: 0 });
  const [syncing, setSyncing] = useState(false);

  const fetchSyncStatus = useCallback(() => {
    api('/sync/status').then(setSyncStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (user) {
      fetchSyncStatus();
      const interval = setInterval(fetchSyncStatus, syncStatus.status === 'syncing' ? 3000 : 30000);
      return () => clearInterval(interval);
    }
  }, [user, fetchSyncStatus, syncStatus.status]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const data = await api('/sync/trigger', { method: 'POST' });
      setSyncStatus(data);
    } catch {}
    setSyncing(false);
  };

  const timeSinceSync = () => {
    if (!syncStatus.last_sync) return 'Never';
    const diff = Math.floor((Date.now() - new Date(syncStatus.last_sync).getTime()) / 60000);
    if (diff < 1) return 'Just now';
    return `${diff}m ago`;
  };

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#080D1A' }}>
        <div className="text-sm" style={{ color: '#4A6080' }}>Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  const renderScreen = () => {
    switch (screen) {
      case 'overview': return <OverviewScreen />;
      case 'orders': return <OrdersScreen />;
      case 'admin': return user.role === 'admin' ? <AdminScreen /> : <div className="text-center py-20" style={{ color: '#4A6080' }}>Access denied</div>;
      case 'issues': return <IssuesScreen />;
      case 'sms': return <div className="text-center py-20" style={{ color: '#4A6080' }}>SMS Log — coming in Phase 4</div>;
      case 'export': return <ExportScreen />;
      default: return <OverviewScreen />;
    }
  };

  const handleNavigate = (s: string) => {
    setScreen(s);
    setSidebarOpen(false);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar — hidden on mobile, shown on desktop */}
      <div className={`fixed md:relative z-50 h-full transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        <Sidebar activeScreen={screen} onNavigate={handleNavigate} />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Topbar */}
        <div className="shrink-0 flex items-center gap-[10px] px-4 md:px-6 h-[52px]"
          style={{ background: '#0A1220', borderBottom: '1px solid #1A2940' }}>
          {/* Hamburger - mobile only */}
          <button onClick={() => setSidebarOpen(true)} className="md:hidden shrink-0 p-1"
            style={{ color: '#4A6080' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <div className="flex-1 text-xs" style={{ color: '#4A6080' }}>{SCREEN_LABELS[screen]}</div>
          <div className="hidden sm:flex items-center gap-2 rounded-md px-3 py-[6px]"
            style={{
              background: syncStatus.status === 'error' ? 'rgba(239,68,68,.06)' : syncStatus.status === 'syncing' ? 'rgba(245,158,11,.06)' : 'rgba(16,185,129,.06)',
              border: `1px solid ${syncStatus.status === 'error' ? 'rgba(239,68,68,.2)' : syncStatus.status === 'syncing' ? 'rgba(245,158,11,.2)' : 'rgba(16,185,129,.2)'}`,
            }}>
            <span className="inline-block w-[7px] h-[7px] rounded-full"
              style={{
                background: syncStatus.status === 'error' ? '#EF4444' : syncStatus.status === 'syncing' ? '#F59E0B' : '#10B981',
                boxShadow: `0 0 6px ${syncStatus.status === 'error' ? '#EF4444' : syncStatus.status === 'syncing' ? '#F59E0B' : '#10B981'}`,
                animation: 'pulse 1.8s ease-in-out infinite',
              }} />
            {syncStatus.status === 'syncing' ? (
              <>
                <div className="flex flex-col gap-[2px]">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: '#F59E0B' }}>Syncing</span>
                    <span className="mono text-[11px]" style={{ color: '#C8D8E8' }}>
                      {syncStatus.progress}/{syncStatus.total}
                    </span>
                    <span className="text-[10px]" style={{ color: '#10B981' }}>{syncStatus.updated} updated</span>
                  </div>
                  <div className="w-[120px] h-[3px] rounded-full" style={{ background: '#1A2940' }}>
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${syncStatus.total > 0 ? (syncStatus.progress / syncStatus.total * 100) : 0}%`,
                      background: 'linear-gradient(90deg, #F59E0B, #10B981)',
                    }} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <span className="text-xs font-semibold" style={{ color: syncStatus.status === 'error' ? '#EF4444' : '#10B981' }}>Domex API</span>
                <span className="text-[11px]" style={{ color: '#2A4060' }}>Last sync: {timeSinceSync()}</span>
                {syncStatus.updated > 0 && <span className="text-[10px]" style={{ color: '#10B981' }}>{syncStatus.updated} updated</span>}
              </>
            )}
            <button onClick={handleSync} disabled={syncStatus.status === 'syncing'}
              className="rounded px-[10px] py-[3px] text-[11px] font-semibold"
              style={{ background: 'transparent', border: '1px solid #1A2940', color: syncStatus.status === 'syncing' ? '#1A2940' : '#4A6080' }}>
              {syncStatus.status === 'syncing' ? `${Math.round(syncStatus.total > 0 ? syncStatus.progress / syncStatus.total * 100 : 0)}%` : 'Sync'}
            </button>
          </div>
          <div className="text-[11px]" style={{ color: '#2A4060' }}>
            {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-7">
          {renderScreen()}
        </div>
      </div>
    </div>
  );
}
