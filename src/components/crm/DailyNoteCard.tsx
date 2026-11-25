'use client';
/**
 * 홈 "오늘 있었던 일" 카드 (2026-11-25): 말하듯 한 줄 적고 손님을 고르면 그 손님 타임라인에, 안 고르면 매장 메모로.
 * 폰에서는 키보드의 마이크로 말해서 적는다(앱 안 음성 인식은 안 둠 — 폰 키보드가 더 정확하고 늘 있음)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Btn from '@/components/ui/Btn';
import { Icon } from '@/components/ui/icons';
import { saveDailyNote, loadRecentNotes, deleteDailyNote, type DailyNote } from '@/lib/daily-notes';
import { todaySeoul } from '@/lib/local-date';

export interface NoteCustomer { id: string; name?: string; phone?: string | null; car_brand?: string | null; car_model?: string | null; kind?: string | null }

export default function DailyNoteCard({ customers }: { customers: NoteCustomer[] }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<NoteCustomer | null>(null);
  const [notes, setNotes] = useState<DailyNote[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => setNotes(await loadRecentNotes(14, 20)), []);
  useEffect(() => { load(); }, [load]);

  const matches = useMemo(() => {
    const k = q.trim().toLowerCase(); if (k.length < 1) return [];
    const digits = k.replace(/\D/g, '');
    return customers.filter((c) => (c.kind || '일반') !== '딜러').filter((c) => (c.name || '').toLowerCase().includes(k) || (digits.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(digits)) || `${c.car_brand || ''} ${c.car_model || ''}`.toLowerCase().includes(k)).slice(0, 6);
  }, [q, customers]);

  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const r = await saveDailyNote(text, picked?.id || null);
    setBusy(false);
    if (r.error) { alert(`저장 실패: ${r.error}`); return; }
    setText(''); setPicked(null); setQ('');
    await load();
  };
  const remove = async (n: DailyNote) => { if (!confirm('이 메모를 지울까요?')) return; await deleteDailyNote(n.id); await load(); };

  const today = todaySeoul();
  const todayNotes = notes.filter((n) => n.date === today);
  const older = notes.filter((n) => n.date !== today);
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

  return (
    <section className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl p-5 md:p-6 min-w-0">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-bold text-[var(--c-text-1)]">오늘 있었던 일 <span className="text-[var(--c-text-3)] text-sm font-medium ml-1">{todayNotes.length ? `${todayNotes.length}줄` : ''}</span></h2>
        <span className="text-xs text-[var(--c-text-3)] hidden sm:inline">말하듯 한 줄 · 손님을 고르면 그 손님 기록에, 안 고르면 매장 메모로 · 시공기 재료가 됩니다</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="예: 조성준님 크롬죽이기 출고. 창문 몰딩 아래쪽 라인이 생각보다 깊어 시간이 갔고, 손님이 뒤에서 보더니 바로 만족. 폰 키보드의 마이크를 누르면 말로 적힙니다"
        className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-xl px-3.5 py-3 text-sm text-[var(--c-text-1)] outline-none focus:border-[var(--c-text-1)] resize-none"
      />
      <div className="mt-2 flex items-start gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          {picked ? (
            <div className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full bg-[var(--c-subtle)] text-[var(--c-text-1)]">
              <Icon name="user" size={12} />{picked.name}{picked.car_model ? <span className="text-[var(--c-text-3)]">{picked.car_brand ? `${picked.car_brand} ` : ''}{picked.car_model}</span> : null}
              <button type="button" onClick={() => setPicked(null)} className="ml-1 text-[var(--c-text-3)] hover:text-[var(--c-text-1)]" aria-label="손님 선택 해제">✕</button>
            </div>
          ) : (
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="손님 이름·차종으로 찾기 (선택)" className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-full px-3.5 py-1.5 text-xs text-[var(--c-text-1)] outline-none focus:border-[var(--c-text-1)]" />
          )}
          {!picked && matches.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl shadow-lg overflow-hidden">
              {matches.map((c) => (
                <button key={c.id} type="button" onClick={() => { setPicked(c); setQ(''); }} className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--c-subtle)] flex items-center gap-2">
                  <span className="font-medium text-[var(--c-text-1)]">{c.name}</span>
                  <span className="text-[var(--c-text-3)]">{[c.car_brand, c.car_model].filter(Boolean).join(' ')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Btn variant="dark" icon="check" onClick={save} disabled={busy || !text.trim()}>{busy ? '저장 중…' : '남기기'}</Btn>
      </div>

      {(todayNotes.length > 0 || older.length > 0) && (
        <div className="mt-4 border-t border-[var(--c-border)] pt-3">
          <ul className="space-y-2">
            {(open ? notes : todayNotes.length ? todayNotes : older.slice(0, 3)).map((n) => (
              <li key={n.id} className="flex items-start gap-2 text-sm group">
                <span className="text-[11px] tabular-nums text-[var(--c-text-4)] w-9 shrink-0 pt-0.5">{md(n.date)}</span>
                <span className="min-w-0 flex-1 text-[var(--c-text-2)] leading-snug">{n.customerName && <span className="font-medium text-[var(--c-text-1)] mr-1.5">{n.customerName}</span>}{n.text}</span>
                <button type="button" onClick={() => remove(n)} className="text-[11px] text-[var(--c-text-4)] opacity-0 group-hover:opacity-100 hover:text-danger shrink-0" aria-label="메모 지우기">지우기</button>
              </li>
            ))}
          </ul>
          {notes.length > (todayNotes.length || Math.min(older.length, 3)) && (
            <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 text-xs text-[var(--c-text-3)] hover:text-[var(--c-text-1)]">{open ? '접기' : `지난 2주 메모 ${notes.length}줄 보기`}</button>
          )}
        </div>
      )}
    </section>
  );
}
