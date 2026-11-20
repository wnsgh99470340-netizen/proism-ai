'use client';

import { useState } from 'react';
import type { FactSheet } from '@/lib/facts';

/**
 * 사실표 확인 카드 (2026-11-20 재설계): 줄 단위로 지우고 보태서 "이대로 써"
 * - 줄마다 출처 꼬리표. 지운 줄은 글에 들어가지 않고, 새로 적은 줄은 '사장님 메모' 출처로 들어간다
 * - 확인 필요 목록은 글에 안 쓰는 것. 실제로 한 작업이면 "표에 넣기"로 올린다
 */
export default function FactSheetCard({ facts, onConfirm, onDelete }: { facts: FactSheet; onConfirm: (lines: string[]) => Promise<void> | void; onDelete: () => void }) {
  const [items, setItems] = useState<{ text: string; source: string }[]>(facts.lines.map(l => ({ text: l.text, source: l.source })));
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);

  const removeAt = (i: number) => setItems(ls => ls.filter((_, k) => k !== i));
  const addLine = (t: string) => { const v = t.trim(); if (v) setItems(ls => [...ls, { text: v, source: '사장님 메모' }]); };
  const submit = async () => {
    setBusy(true);
    try {
      const all = [...items.map(i => i.text), ...extra.split('\n').map(s => s.trim()).filter(Boolean)];
      await onConfirm(all);
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-2 rounded-lg border border-gold/50 bg-[var(--c-card)] p-2.5 text-[11px]">
      <div className="font-semibold text-[var(--c-text-1)] mb-1">이 작업의 사실표 — 글은 이 줄들로만 씁니다</div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={`${i}-${it.text.slice(0, 8)}`} className="flex items-start gap-1.5">
            <span className="text-[var(--c-text-4)] shrink-0 w-4 text-right">{i + 1}.</span>
            <span className="flex-1 text-[var(--c-text-1)]">{it.text}<span className="ml-1 text-[9px] text-[var(--c-text-4)]">({it.source})</span></span>
            <button onClick={() => removeAt(i)} className="text-[var(--c-text-4)] hover:text-danger px-1 shrink-0" title="이 줄 빼기">✕</button>
          </li>
        ))}
      </ul>
      {facts.unsure.length > 0 && (
        <div className="mt-2 rounded bg-[var(--c-subtle)] p-2">
          <div className="text-[10px] font-medium text-[var(--c-text-2)] mb-1">확인 필요 — 글에 쓰지 않습니다. 실제로 한 것이면 표에 넣으세요</div>
          <ul className="space-y-1">
            {facts.unsure.map((u, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="flex-1 text-[var(--c-text-3)]">{u}</span>
                <button onClick={() => addLine(u.replace(/^사진에\s*/, '').replace(/,?\s*요청에는? 없음.*$/, ''))} className="text-[10px] text-gold hover:underline shrink-0">표에 넣기</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <textarea
        value={extra}
        onChange={(e) => setExtra(e.target.value)}
        rows={2}
        placeholder="보탤 사실이 있으면 한 줄에 하나씩 (시간이 간 곳, 손님이 물은 것, 발견한 것)"
        className="mt-2 w-full rounded border border-[var(--c-border)] bg-[var(--c-page)] px-2 py-1.5 text-[11px] text-[var(--c-text-1)] placeholder:text-[var(--c-text-4)] resize-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <button onClick={submit} disabled={busy || items.length === 0} className="flex-1 rounded-lg bg-brand text-white font-semibold py-2 disabled:opacity-50">{busy ? '시작하는 중…' : '이대로 써'}</button>
        <button onClick={onDelete} disabled={busy} className="rounded-lg border border-[var(--c-border)] px-3 py-2 text-[var(--c-text-2)]">취소</button>
      </div>
    </div>
  );
}
