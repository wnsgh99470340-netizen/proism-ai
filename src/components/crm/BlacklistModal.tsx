'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadBlacklist, setBlacklist, clearBlacklist, blacklistByPhone, type BlacklistedCustomer } from '@/lib/blacklist';
import ReferrerPicker from '@/components/crm/ReferrerPicker';

/** 블랙리스트 창 (2026-11-22): 목록 · 추가(고객 고르기 + 사유) · 해제 */
export default function BlacklistModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [list, setList] = useState<BlacklistedCustomer[]>([]);
  const [pick, setPick] = useState<{ id: string; name: string; phone: string | null; car_brand: string | null; car_model: string | null } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => setList(await loadBlacklist()), []);
  useEffect(() => { reload(); }, [reload]);

  const add = async () => {
    if (!pick) return;
    setBusy(true);
    try { const err = await setBlacklist(pick.id, reason); if (err) alert(err); else { setPick(null); setReason(''); await reload(); onChanged?.(); } } finally { setBusy(false); }
  };
  const remove = async (c: BlacklistedCustomer) => {
    if (!confirm(`${c.name} 님을 블랙리스트에서 뺄까요?`)) return;
    const err = await clearBlacklist(c.id); if (err) alert(err); else { await reload(); onChanged?.(); }
  };
  const editReason = async (c: BlacklistedCustomer) => {
    const r = window.prompt('사유를 적어 주세요', c.reason === '사유 미기입' ? '' : c.reason);
    if (r === null) return;
    const err = await setBlacklist(c.id, r); if (err) alert(err); else { await reload(); onChanged?.(); }
  };
  const input = 'w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50';

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--c-border)] flex items-center justify-between">
          <div>
            <div className="text-[var(--c-text-1)] font-semibold">⛔ 블랙리스트 <span className="text-[var(--c-text-3)] font-normal text-sm">{list.length}명</span></div>
            <div className="text-xs text-[var(--c-text-3)] mt-0.5">고객 목록·예약 고르기에 ⛔ 표시, 상담·견적·문의 답변에서 번호가 맞으면 경고가 뜹니다. 손님 페이지에는 안 보입니다</div>
          </div>
          <button onClick={onClose} className="text-[var(--c-text-3)] hover:text-[var(--c-text-1)] text-lg">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded-xl border border-[var(--c-border)] bg-[var(--c-subtle)] p-3 space-y-2">
            <div className="text-xs font-semibold text-[var(--c-text-2)]">추가</div>
            <ReferrerPicker compact value={pick} onChange={setPick} placeholder="고객 고르기 (이름·전화 뒷자리·차종)" selectedLabel="고객" />
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유 (예: 결제 미이행, 무리한 요구)" className={input} />
            <div className="flex justify-end"><button onClick={add} disabled={!pick || busy} className="text-sm px-4 py-2 rounded-lg bg-danger text-white disabled:opacity-40">{busy ? '저장 중…' : '블랙리스트에 넣기'}</button></div>
          </div>
          {list.length === 0 ? <div className="text-sm text-[var(--c-text-3)] text-center py-6">블랙리스트가 비어 있습니다</div> : (
            <ul className="space-y-2">
              {list.map((c) => (
                <li key={c.id} className="rounded-xl border border-danger/30 bg-danger/5 px-3.5 py-2.5 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[var(--c-text-1)]">{c.name} <span className="text-xs font-normal text-[var(--c-text-3)]">{c.phone || ''}{c.car ? ` · ${c.car}` : ''}</span></div>
                    <div className="text-xs text-[var(--c-text-2)] mt-0.5">{c.reason} <span className="text-[var(--c-text-4)]">· {c.date}</span></div>
                  </div>
                  <button onClick={() => editReason(c)} className="text-[11px] text-[var(--c-text-3)] hover:text-[var(--c-text-1)]">사유</button>
                  <button onClick={() => remove(c)} className="text-[11px] text-[var(--c-text-3)] hover:text-ok">해제</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** 전화번호가 블랙리스트와 맞으면 빨간 띠 (상담 추가·견적 문자·문의 답변) */
export function BlacklistWarning({ phone }: { phone: string | null | undefined }) {
  const [hit, setHit] = useState<BlacklistedCustomer | null>(null);
  useEffect(() => {
    const d = (phone || '').replace(/\D/g, '');
    if (d.length < 10) { setHit(null); return; }
    let alive = true;
    const t = setTimeout(() => { blacklistByPhone(phone).then((h) => { if (alive) setHit(h); }); }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [phone]);
  if (!hit) return null;
  return <div className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger font-semibold">⛔ 블랙리스트 고객입니다 — {hit.name} · {hit.reason} ({hit.date})</div>;
}
