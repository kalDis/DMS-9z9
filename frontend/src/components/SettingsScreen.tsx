'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import ResolutionOptionsManager from './ResolutionOptionsManager';

// Staff-facing settings — lets issue handlers manage the resolution options
// for the businesses they're assigned to (the Admin panel stays admin-only).
export default function SettingsScreen() {
  const { businesses, activeBusiness } = useAuth();
  const [bizId, setBizId] = useState<number | null>(null);

  useEffect(() => {
    if (!bizId) setBizId(activeBusiness?.id || businesses[0]?.id || null);
    // eslint-disable-next-line
  }, [activeBusiness, businesses]);

  return (
    <div className="animate-fadeIn">
      <div className="mb-[22px]">
        <div className="text-[10px] tracking-[.1em] uppercase" style={{ color: '#4A6080' }}>Settings</div>
        <div className="text-xl font-bold mt-[2px]" style={{ color: '#E8F4FF' }}>Resolution Options</div>
      </div>

      <div className="text-xs mb-4" style={{ color: '#4A6080' }}>
        Configure the resolution options shown when you contact a customer. Each business has its own.
      </div>

      {businesses.length > 1 && (
        <div className="mb-4">
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
        <ResolutionOptionsManager businessId={bizId} />
      )}
    </div>
  );
}
