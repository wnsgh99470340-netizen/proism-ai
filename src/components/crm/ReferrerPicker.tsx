'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * 소개한 분 고르기 (2026-11-22 생애 흐름 점검 9-2): 상담 기록·문의 답변 단계에서 "○○○ 소개로 왔다"를 적어 두면
 * 나중에 고객으로 등록될 때 자동으로 소개 관계가 연결되고 유입경로가 '소개/재방문'이 된다 (src/lib/appointments-flow.ts linkOrphanRecordsByPhone)
 * 메모에는 "소개: 이름 [ref:고객id]" 로 남는다 (화면에서는 [ref:…] 를 숨김)
 */
type Person = { id: string; name: string; phone: string | null; car_brand: string | null; car_model: string | null };

export const REF_TOKEN_RE = /\s*\[ref:([0-9a-f-]{36})\]/g;
export function referrerToken(p: { id: string; name: string } | null | undefined): string {
  return p ? `소개: ${p.name} [ref:${p.id}]` : '';
}
/** 메모에서 [ref:…] 를 떼어 보여 주기용 */
export function hideRefToken(memo: string | null | undefined): string {
  return (memo || '').replace(REF_TOKEN_RE, '');
}

export default function ReferrerPicker({ value, onChange, excludeCustomerId, compact }: { value: Person | null; onChange: (p: Person | null) => void; excludeCustomerId?: string | null; compact?: boolean }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => { supabase.from('customers').select('id, name, phone, car_brand, car_model').order('name').then(({ data }) => setPeople((data || []) as Person[])); }, []);
  const label = (p: Person) => `${p.name}${p.car_brand || p.car_model ? ` · ${[p.car_brand, p.car_model].filter(Boolean).join(' ')}` : ''}${p.phone ? ` · ${p.phone.replace(/\D/g, '').slice(-4)}` : ''}`;
  const list = (people || []).filter((p) => p.id !== excludeCustomerId).filter((p) => {
    const t = q.trim().toLowerCase(); const d = t.replace(/\D/g, '');
    if (!t) return true;
    return p.name.toLowerCase().includes(t) || `${p.car_brand || ''} ${p.car_model || ''}`.toLowerCase().includes(t) || (d.length >= 2 && (p.phone || '').replace(/\D/g, '').includes(d));
  }).slice(0, 8);
  const input = 'w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50';
  if (value) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[var(--c-text-3)] text-xs">소개한 분</span>
        <span className="font-medium text-[var(--c-text-1)]">{label(value)}</span>
        <button type="button" onClick={() => onChange(null)} className="text-xs text-[var(--c-text-3)] hover:text-danger">✕ 바꾸기</button>
      </div>
    );
  }
  return (
    <div className="relative">
      {!compact && <label className="text-xs text-[var(--c-text-3)] mb-1 block">소개한 분 (선택) — 소개로 왔다면 여기서 골라 두면 고객 등록 때 자동으로 연결됩니다</label>}
      <input type="text" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} className={input} placeholder={people ? (compact ? '소개한 분 (이름·전화 뒷자리·차종)' : '이름·전화 뒷자리·차종으로 검색') : '불러오는 중…'} />
      {open && people && (
        <ul className="absolute z-30 mt-1 w-full max-h-52 overflow-y-auto bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg shadow-xl text-sm">
          {list.map((p) => <li key={p.id}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(p); setOpen(false); setQ(''); }} className="w-full text-left px-3 py-2 hover:bg-[var(--c-subtle)] text-[var(--c-text-1)]">{label(p)}</button></li>)}
          {list.length === 0 && <li className="px-3 py-2 text-xs text-[var(--c-text-3)]">검색 결과 없음</li>}
        </ul>
      )}
    </div>
  );
}
