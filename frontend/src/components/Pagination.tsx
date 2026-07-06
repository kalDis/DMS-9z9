'use client';

export default function Pagination({ page, total, perPage, onPageChange, noun = 'items' }: {
  page: number; total: number; perPage: number; onPageChange: (p: number) => void; noun?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between py-3 flex-wrap gap-2">
      <div className="text-[13px] font-semibold" style={{ color: '#8ABBE0' }}>
        Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of <span style={{ color: '#00E5FF' }}>{total}</span> {noun}
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
