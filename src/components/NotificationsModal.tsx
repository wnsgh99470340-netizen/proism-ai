'use client';
import { useEffect, useState } from 'react';
import Btn from '@/components/ui/Btn';
import { Icon } from '@/components/ui/icons';
import { groupPushLog, seoulTime, type PushLogEntry } from '@/lib/push-log';
import { formatDate } from '@/lib/crm-shared';

/** 받은 알림 목록 창 (2026-11-26): 서버가 보낸 푸시 기록을 날짜별로. 눌러서 그 화면으로 */
export default function NotificationsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<PushLogEntry[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setItems(null); setErr('');
    fetch('/api/push/log', { cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error(`${r.status}`); return (await r.json()) as { items: PushLogEntry[] }; })
      .then((d) => setItems(d.items || []))
      .catch((e) => { setErr(`불러오지 못했습니다 (${e instanceof Error ? e.message : e})`); setItems([]); });
  }, [open]);

  if (!open) return null;
  const groups = groupPushLog(items || []);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-[var(--c-card)] w-full sm:max-w-md max-h-[85dvh] rounded-t-2xl sm:rounded-2xl border border-[var(--c-border)] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--c-border)]">
          <h2 className="text-base font-bold text-[var(--c-text-1)] flex items-center gap-2"><Icon name="bell" size={16} /> 받은 알림</h2>
          <Btn variant="ghost" size="sm" onClick={onClose}>닫기</Btn>
        </div>
        <div className="overflow-y-auto px-5 py-3">
          {items === null && <div className="text-sm text-[var(--c-text-3)] py-6 text-center">불러오는 중…</div>}
          {items && items.length === 0 && <div className="text-sm text-[var(--c-text-3)] py-8 text-center">{err || '아직 기록된 알림이 없습니다. 지금부터 오는 알림이 여기에 남습니다.'}</div>}
          {groups.map((g) => (
            <div key={g.date} className="mb-4">
              <div className="text-[11px] font-semibold text-[var(--c-text-4)] mb-1.5">{formatDate(g.date)}</div>
              <ul className="space-y-1.5">
                {g.items.map((it, i) => (
                  <li key={`${it.at}-${i}`}>
                    <button
                      type="button"
                      onClick={() => { if (it.url) { onClose(); window.location.href = it.url; } }}
                      className={`w-full text-left rounded-xl border border-[var(--c-border)] px-3.5 py-2.5 ${it.url ? 'hover:bg-[var(--c-subtle)]' : 'cursor-default'}`}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-semibold text-[var(--c-text-1)] leading-snug">{it.title}</span>
                        <span className="text-[11px] tabular-nums text-[var(--c-text-4)] shrink-0">{seoulTime(it.at)}</span>
                      </div>
                      {it.body && <div className="text-xs text-[var(--c-text-2)] mt-0.5 whitespace-pre-wrap leading-snug">{it.body}</div>}
                      {it.sent === 0 && <div className="text-[11px] text-warn mt-0.5">알림 켜진 기기가 없어 기록만 남음</div>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
