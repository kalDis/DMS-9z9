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
  const [syncStatus, setSyncStatus] = useState<{ last_sync: string | null; status: string }>({ last_sync: null, status: 'idle' });
  const [syncing, setSyncing] = useState(false);

  const fetchSyncStatus = useCallback(() => {
    api('/sync/status').then(setSyncStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (user) {
      fetchSyncStatus();
      const interval = setInterval(fetchSyncStatus, 30000);
      return () => clearInterval(interval);
    }
  }, [user, fetchSyncStatus]);

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

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar activeScreen={screen} onNavigate={setScreen} />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Topbar */}
        <div className="shrink-0 flex items-center gap-[14px] px-6 h-[52px]"
          style={{ background: '#0A1220', borderBottom: '1px solid #1A2940' }}>
          <div className="flex-1 text-xs" style={{ color: '#4A6080' }}>{SCREEN_LABELS[screen]}</div>
          <div className="flex items-center gap-2 rounded-md px-3 py-[6px]"
            style={{
              background: syncStatus.status === 'error' ? 'rgba(239,68,68,.06)' : 'rgba(16,185,129,.06)',
              border: `1px solid ${syncStatus.status === 'error' ? 'rgba(239,68,68,.2)' : 'rgba(16,185,129,.2)'}`,
            }}>
            <span className="inline-block w-[7px] h-[7px] rounded-full"
              style={{
                background: syncStatus.status === 'error' ? '#EF4444' : syncing ? '#F59E0B' : '#10B981',
                boxShadow: `0 0 6px ${syncStatus.status === 'error' ? '#EF4444' : '#10B981'}`,
                animation: 'pulse 1.8s ease-in-out infinite',
              }} />
            <span className="text-xs font-semibold" style={{ color: syncStatus.status === 'error' ? '#EF4444' : '#10B981' }}>Domex API</span>
            <span className="text-[11px]" style={{ color: '#2A4060' }}>Last sync: {timeSinceSync()}</span>
            <button onClick={handleSync} disabled={syncing}
              className="rounded px-[10px] py-[3px] text-[11px] font-semibold"
              style={{ background: 'transparent', border: '1px solid #1A2940', color: '#4A6080' }}>
              {syncing ? 'Syncing...' : 'Sync'}
            </button>
          </div>
          <div className="text-[11px]" style={{ color: '#2A4060' }}>
            {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-7">
          {renderScreen()}
        </div>
      </div>
    </div>
  );
}
