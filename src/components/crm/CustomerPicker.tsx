'use client';
/**
 * 고객 고르기 (예약 추가·상담 추가 창). 2026-11-26 사장님 "고객 선택이 불가해, 스크롤도 안 되고 검색도 안 돼":
 * 이 컴포넌트가 page.tsx 렌더 함수 안에 정의돼 있어서 부모가 다시 그릴 때마다(검색 글자 하나, 10초 폴링…) 새 컴포넌트로 바뀌며
 * 열림 상태가 날아갔다 → 파일로 빼고 검색어·열림 상태를 안에 둔다.
 */
import { useEffect, useRef, useState } from 'react';
import { isBlacklisted, blacklistInfo } from '@/lib/blacklist';
import { vehicleLabel, type Vehicle } from '@/lib/vehicles';

export interface PickerCustomerLike { id: string; name: string; phone?: string | null; car_brand?: string | null; car_model?: string | null; memo?: string | null }

export default function CustomerPicker({ value, onChange, customers, vehiclesByCustomer }: {
  value: string;
  onChange: (id: string) => void;
  customers: PickerCustomerLike[];
  vehiclesByCustomer?: Map<string, Vehicle[]>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const selected = customers.find((c) => c.id === value);

  // 바깥을 누르면 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const k = q.trim().toLowerCase();
  const digits = k.replace(/\D/g, '');
  const list = !k ? customers : customers.filter((c) =>
    c.name.toLowerCase().includes(k)
    || (digits.length >= 2 && (c.phone || '').replace(/\D/g, '').includes(digits))
    || `${c.car_brand || ''} ${c.car_model || ''}`.toLowerCase().includes(k)
    || (vehiclesByCustomer?.get(c.id) || []).some((v) => `${v.brand || ''} ${v.model || ''}`.toLowerCase().includes(k)));

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setQ(''); }}
        className="w-full text-left bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] hover:border-gold/50 transition-colors"
      >
        {selected ? `${selected.name}${selected.phone ? ` (${selected.phone})` : ''}` : '고객 선택...'}
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg shadow-2xl z-50 max-h-64 overflow-y-auto overscroll-contain">
          <div className="p-2 border-b border-[var(--c-border)] sticky top-0 bg-[var(--c-card)]">
            <input
              type="text"
              placeholder="이름·연락처·차종 검색..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && list.length === 1) { onChange(list[0].id); setOpen(false); } }}
              className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded px-2 py-1.5 text-xs text-[var(--c-text-1)] outline-none focus:border-gold/50"
              autoFocus
            />
          </div>
          {list.slice(0, 200).map((c) => {
            const cars = (vehiclesByCustomer?.get(c.id) || []).map((v) => vehicleLabel(v)).filter(Boolean);
            const label = cars.length ? cars.join(' · ') : `${c.car_brand || ''} ${c.car_model || ''}`.trim();
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => { onChange(c.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm text-[var(--c-text-1)] hover:bg-[var(--c-subtle)] transition-colors"
              >
                {isBlacklisted(c.memo) && <span className="text-danger mr-1" title={`블랙리스트: ${blacklistInfo(c.memo)?.reason || ''}`}>⛔</span>}{c.name} {c.phone && <span className="text-[var(--c-text-3)]">({c.phone})</span>}
                {label ? <span className="ml-2 text-xs text-[var(--c-text-3)]">{label}</span> : null}
              </button>
            );
          })}
          {list.length > 200 && <div className="px-3 py-2 text-xs text-[var(--c-text-3)]">{list.length - 200}명 더 있음 — 이름이나 번호로 검색해 주세요</div>}
          {list.length === 0 && <div className="px-3 py-2 text-xs text-[var(--c-text-3)]">검색 결과 없음</div>}
        </div>
      )}
    </div>
  );
}
