'use client';
/**
 * 통화 요약 캡처로 상담 기록 (2026-11-25 사장님 "통화 요약 캡처를 CRM 에서 바로" / "바로 예약에 잡히면 안 돼, 각 기능과 맞물리게")
 * 캡처 올리기(여러 장·붙여넣기) → /api/consult/from-call 이 통화를 뽑고 고객·딜러와 맞춤 → 표에서 손님·종류·시공·요지·재연락을 고쳐 "N건 기록"
 * - 저장되는 것: 상담 기록(접두 [통화 요약]) + 사장님이 켠 견적 재연락만. 예약·고객은 만들지 않는다(예약 얘기면 '예약 추가' 창을 미리 채워 열어 줄 뿐)
 * - 미등록 손님은 메모 첫 줄 "이름 전화 · 차종" 꼴 → 고객 등록 때 linkOrphanRecordsByPhone 이 자동으로 붙인다. 견적 문자 창도 바로 열 수 있다
 */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { todaySeoul } from '@/lib/local-date';
import { CALL_KINDS, callContent, unregisteredMemoHead, type CallKind, type ExtractedCall } from '@/lib/call-summary';
import { SERVICE_TYPES } from '@/lib/crm-shared';
import type { QuoteSmsInitial } from '@/components/crm/QuoteSmsModal';
import ReferrerPicker, { referrerToken } from '@/components/crm/ReferrerPicker';

interface Row {
  key: string; call: ExtractedCall; name: string; phone: string | null; car: string | null; org: string | null;
  customerId: string | null; customerKind: string | null; matchBy: 'phone' | 'name' | null; blacklisted: boolean;
  kind: CallKind; service: string | null; duplicate: boolean; hasOpenQuote: boolean; hasUpcoming: boolean; followUpDate: string | null;
}
type RefPerson = NonNullable<Parameters<typeof ReferrerPicker>[0]['value']>;
interface EditRow extends Row { include: boolean; followUp: boolean; summary: string; referrer: RefPerson | null }

export default function CallSummaryImportModal({ customers, onClose, onDone, openQuote, openAppointment }: {
  customers: { id: string; name: string; phone: string | null; car_brand?: string | null; car_model?: string | null; kind?: string | null }[];
  onClose: () => void;
  onDone: () => void;
  openQuote: (v: QuoteSmsInitial) => void;
  /** 예약 얘기면 예약 추가 창을 미리 채워 연다 — 자동 등록 없음 */
  openAppointment: (v: { customerId: string | null; date: string | null; serviceType: string | null; memo: string }) => void;
}) {
  const [rows, setRows] = useState<EditRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const today = todaySeoul();

  const readFile = async (file: File | undefined | null) => {
    if (!file || !/^image\//.test(file.type)) return;
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      const res = await fetch('/api/consult/from-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: dataUrl.split(',')[1], mediaType: 'image/jpeg' }) });
      const j = await res.json();
      if (!res.ok || j.error) { alert(j.error || '캡처를 읽지 못했습니다'); return; }
      const got = ((j.rows || []) as Row[]).map((r): EditRow => ({
        ...r,
        include: !r.duplicate && r.kind !== '기타' && !!(r.call.title || r.call.bullets.length), // 상세 없는 목록 줄·부재중은 기본 해제
        followUp: !!r.followUpDate && !r.blacklisted && r.kind === '문의', // 딜러 통화는 제안만 하고 기본 해제 (딜러는 여러 이유로 전화함)
        summary: r.call.bullets.join('\n'),
        referrer: null,
      }));
      setRows((prev) => { const keys = new Set(prev.map((p) => p.key)); return [...prev, ...got.filter((g) => !keys.has(g.key))]; });
      if (got.length === 0) alert('이 캡처에서 통화를 찾지 못했습니다');
    } catch (e) {
      alert('읽기 실패: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setBusy(false); }
  };
  // ⌘V 붙여넣기
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => { const f = [...(e.clipboardData?.files || [])].find((x) => /^image\//.test(x.type)); if (f) { e.preventDefault(); readFile(f); } };
    window.addEventListener('paste', onPaste); return () => window.removeEventListener('paste', onPaste);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: string, patch: Partial<EditRow>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const personLabel = (c: (typeof customers)[number]) => `${c.name}${c.car_brand || c.car_model ? ` · ${[c.car_brand, c.car_model].filter(Boolean).join(' ')}` : ''}${c.kind === '딜러' ? ' (딜러)' : ''}`;

  const save = async () => {
    const todo = rows.filter((r) => r.include);
    if (todo.length === 0) { alert('기록할 통화를 골라 주세요.'); return; }
    setSaving(true);
    let saved = 0, fus = 0;
    try {
      for (const r of todo) {
        const call: ExtractedCall = { ...r.call, bullets: r.summary.split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean) };
        const dealerName = r.customerKind === '딜러' ? r.name : null;
        const content = callContent(call, r.kind, dealerName);
        const memoParts = [r.customerId ? '' : unregisteredMemoHead(r.name, r.phone, r.car), r.customerId && r.car ? r.car : '', `통화 요약(캡처) ${today}`, r.referrer ? referrerToken(r.referrer) : ''].filter(Boolean);
        const { error } = await supabase.from('consultations').insert({
          customer_id: r.customerId, consultation_date: r.call.date || today, content,
          interested_services: r.service || null, memo: memoParts.join(' · ') || null,
        });
        if (error) throw new Error(`${r.name || r.phone}: ${error.message}`);
        saved++;
        // 견적 재연락 — 사장님이 켠 것만. 메모 첫 줄은 브리핑·사후관리 탭이 읽는 꼴("이름 전화 · 차종 시공")
        if (r.followUp && r.followUpDate && r.phone) {
          const head = `${r.name || '손님'} ${r.phone} · ${[r.car, r.service].filter(Boolean).join(' ')}`.trim();
          const body = `안녕하세요 3M 프로이즘 대표 진준호입니다.\n통화 때 말씀 나눈 ${r.service || '시공'} 건, 생각 정리되셨으면 편하게 연락 주세요.\n입고 날짜 맞춰 준비해 두겠습니다.`;
          const { error: e2 } = await supabase.from('follow_ups').insert({ customer_id: r.customerId, follow_up_type: '견적재연락', scheduled_date: r.followUpDate, is_completed: false, memo: `${head}\n${body}` });
          if (!e2) fus++;
        }
      }
      alert(`상담 기록 ${saved}건${fus ? ` · 견적 재연락 ${fus}건` : ''} 남겼습니다.`);
      onDone(); onClose();
    } catch (e) {
      alert('저장 실패: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setSaving(false); }
  };

  const input = 'bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--c-text-1)] outline-none focus:border-gold/50';
  const chip = 'text-[11px] font-medium px-2.5 py-1 rounded-full border border-[var(--c-border)] hover:bg-[var(--c-subtle)] text-[var(--c-text-1)] whitespace-nowrap';
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-3 sm:p-4" onClick={() => { if (!busy && !saving) onClose(); }}>
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-3xl max-h-[calc(100dvh-1.5rem)] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 sm:px-6 py-4 border-b border-[var(--c-border)] flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[var(--c-text-1)] font-semibold text-base">통화 요약으로 상담 기록</h3>
            <p className="text-xs text-[var(--c-text-3)] mt-0.5">전화 앱의 통화 요약 캡처를 올리면 손님을 찾아 상담 기록으로 남깁니다. 예약은 만들지 않고, 재연락은 체크한 것만 잡습니다.</p>
          </div>
          <button onClick={onClose} className="text-[var(--c-text-3)] hover:text-[var(--c-text-1)] text-lg leading-none">✕</button>
        </div>
        <div className="px-4 sm:px-6 py-3 border-b border-[var(--c-border)] flex items-center gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { for (const f of e.target.files || []) readFile(f); e.target.value = ''; }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="text-sm font-semibold rounded-full px-4 py-2 bg-[var(--c-text-1)] text-[var(--c-card)] disabled:opacity-50">{busy ? '읽는 중…' : '캡처 고르기'}</button>
          <span className="text-xs text-[var(--c-text-4)]">여러 장 한 번에 · PC 는 ⌘V 붙여넣기</span>
          {rows.length > 0 && <span className="ml-auto text-xs text-[var(--c-text-3)]">{rows.length}건 읽음 · {rows.filter((r) => r.include).length}건 기록 예정</span>}
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-3 space-y-3">
          {rows.length === 0 && !busy && <div className="py-10 text-center text-sm text-[var(--c-text-3)]">캡처를 올리면 여기 통화가 하나씩 나옵니다</div>}
          {rows.map((r) => (
            <div key={r.key} className={`rounded-xl border p-3 sm:p-4 ${r.include ? 'border-[var(--c-border)]' : 'border-[var(--c-border)] opacity-60'} ${r.blacklisted ? 'bg-danger/5' : 'bg-[var(--c-page)]'}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={r.include} onChange={(e) => set(r.key, { include: e.target.checked })} className="mt-1 w-4 h-4 accent-brand" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="font-semibold text-[var(--c-text-1)]">{r.call.savedName || r.phone}</span>
                    <span className="text-xs text-[var(--c-text-3)]">{r.call.date?.slice(5).replace('-', '/')} {r.call.time} {r.call.direction}{r.call.duration ? ` ${r.call.duration}` : ''}</span>
                    {r.duplicate && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--c-subtle)] text-[var(--c-text-3)]">이미 기록됨</span>}
                    {r.blacklisted && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-danger/15 text-danger">⛔ 블랙리스트</span>}
                    {r.hasUpcoming && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-info/15 text-info">예약 있음</span>}
                    {r.hasOpenQuote && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gold/20 text-gold">재연락 열림</span>}
                  </div>
                  <div className="text-sm font-medium text-[var(--c-text-1)]">{r.call.title || '(제목 없음)'}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <label className="col-span-2 text-[11px] text-[var(--c-text-3)]">손님
                      <select value={r.customerId || ''} onChange={(e) => { const c = customers.find((x) => x.id === e.target.value); set(r.key, { customerId: c?.id || null, customerKind: c?.kind || null, name: c ? c.name : r.name, phone: c?.phone || r.phone, car: c ? [c.car_brand, c.car_model].filter(Boolean).join(' ') || r.car : r.car }); }} className={`${input} w-full mt-0.5`}>
                        <option value="">미등록 — {r.name || '이름 없음'} {r.phone || ''}</option>
                        {customers.filter((c) => c.name.split(' ')[0] === (r.name || '').split(' ')[0] || (r.phone && c.phone === r.phone)).map((c) => <option key={c.id} value={c.id}>{personLabel(c)}{r.matchBy ? ` · ${r.matchBy === 'phone' ? '번호 일치' : '이름 일치'}` : ''}</option>)}
                        <option disabled>──</option>
                        {customers.filter((c) => c.kind !== '딜러').map((c) => <option key={'a' + c.id} value={c.id}>{personLabel(c)}</option>)}
                      </select>
                    </label>
                    <label className="text-[11px] text-[var(--c-text-3)]">종류
                      <select value={r.kind} onChange={(e) => set(r.key, { kind: e.target.value as CallKind, followUp: (e.target.value === '문의' || e.target.value === '딜러') && r.followUp })} className={`${input} w-full mt-0.5`}>
                        {CALL_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </label>
                    <label className="text-[11px] text-[var(--c-text-3)]">시공
                      <select value={r.service || ''} onChange={(e) => set(r.key, { service: e.target.value || null })} className={`${input} w-full mt-0.5`}>
                        <option value="">-</option>
                        {SERVICE_TYPES.filter((t) => !['리터치', 'QC점검', '메인터넌스'].includes(t)).map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                  </div>
                  <textarea value={r.summary} onChange={(e) => set(r.key, { summary: e.target.value })} rows={Math.min(5, Math.max(2, r.summary.split('\n').length))} className={`${input} w-full resize-y`} placeholder="요지 (한 줄에 하나)" />
                  <div className="flex items-center gap-2 flex-wrap">
                    {(r.kind === '문의' || r.kind === '딜러') && (
                      <label className={`inline-flex items-center gap-1.5 text-xs ${r.followUpDate ? 'text-[var(--c-text-1)]' : 'text-[var(--c-text-4)]'}`}>
                        <input type="checkbox" checked={r.followUp} disabled={!r.phone} onChange={(e) => set(r.key, { followUp: e.target.checked, followUpDate: r.followUpDate || today })} className="accent-brand" />
                        견적 재연락
                        <input type="date" value={r.followUpDate || ''} onChange={(e) => set(r.key, { followUpDate: e.target.value || null })} className={`${input} py-0.5`} />
                        {!r.phone && <span className="text-[var(--c-text-4)]">(번호 없음)</span>}
                        {r.hasOpenQuote && <span className="text-[var(--c-text-4)]">이미 열린 재연락 있음</span>}
                      </label>
                    )}
                    {r.kind === '문의' && !r.customerId && r.phone && (
                      <span className="text-[11px] text-[var(--c-text-4)]">소개로 왔으면 → <ReferrerPicker value={r.referrer} onChange={(p) => set(r.key, { referrer: p })} compact placeholder="소개한 분" /></span>
                    )}
                    <span className="ml-auto flex items-center gap-1.5">
                      {(r.kind === '문의' || r.kind === '딜러') && <button type="button" onClick={() => openQuote({ customerId: r.customerId, name: r.name, phone: r.phone || '', car: r.car || '', service: r.service || undefined })} className={chip}>견적 문자</button>}
                      {(r.kind === '예약' || r.kind === '사후') && <button type="button" onClick={() => openAppointment({ customerId: r.customerId, date: r.call.todo?.date || null, serviceType: r.kind === '사후' ? '리터치' : r.service, memo: `통화 ${r.call.date?.slice(5)} ${r.call.time}: ${r.call.title}` })} className={chip}>{r.kind === '사후' ? '리터치 예약 창' : '예약 추가 창'}</button>}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 sm:px-6 py-3 border-t border-[var(--c-border)] flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px] text-[var(--c-text-4)]">기타(택배·퀵 등)는 기본으로 빠져 있습니다 · 미등록 손님은 나중에 고객 등록 때 번호로 자동 연결</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={saving} className="px-3 py-2 text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-2)]">닫기</button>
            <button onClick={save} disabled={saving || busy || rows.filter((r) => r.include).length === 0} className="bg-brand hover:bg-brand-dark text-white text-sm font-semibold rounded-full px-5 py-2 disabled:opacity-50 whitespace-nowrap">{saving ? '저장 중…' : `${rows.filter((r) => r.include).length}건 기록`}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
