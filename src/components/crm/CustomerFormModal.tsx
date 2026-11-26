'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { MEMBERSHIP } from '@/config/membership';
import { closeQuoteFollowUpsFor } from '@/lib/followups';
import { ensurePrimaryVehicle } from '@/lib/vehicles';
import { formatPhoneInput } from '@/lib/phone';
import { ensureArrivalNotice } from '@/lib/appointments-flow';
import { dealerSupport, loadDealers, DEALER_KIND, type DealerRef } from '@/lib/dealers';

/**
 * 고객 등록·수정 창 하나 (2026-11-18 사장님: "왜 자꾸 등록 창이랑 수정 창이 달라" → 어디서 열든 같은 창, 같은 칸)
 * - 고객 목록의 추가/수정, 예약 줄의 👤 고객 정보, 고객 상세 화면의 ✎ 수정이 전부 이 컴포넌트를 쓴다
 * - 수정일 때는 가장 최근 예약(시공 종류·시작·종료·금액·메모)을 같이 보여 주고 같이 저장한다
 */
export const SERVICE_TYPES = ['PPF', '컬러PPF', 'PWF', '랩핑', '크롬죽이기', '썬팅', '유리막코팅', '가죽코팅', '실내PPF', '신차패키지'];
export const SOURCE_OPTIONS = ['카페', '블로그', '소개/재방문', '유튜브', '고정', '경로X', '기타'];

export interface CustomerFormValues {
  name: string; phone: string; car_brand: string; car_model: string; car_year: string; car_color: string; source: string; memo: string;
  appointment_start_date: string; appointment_end_date: string; appointment_service_type: string; appointment_amount: string; appointment_memo: string;
  /** 고객 종류 '일반' | '딜러' + 넣어 주신 딜러(고객 id) — 2026-11-23. 열이 없으면 저장하지 않음 */
  kind: string; dealer_id: string;
}
export const EMPTY_CUSTOMER_FORM: CustomerFormValues = {
  name: '', phone: '', car_brand: '', car_model: '', car_year: '', car_color: '', source: '', memo: '',
  appointment_start_date: '', appointment_end_date: '', appointment_service_type: '', appointment_amount: '', appointment_memo: '',
  kind: '일반', dealer_id: '',
};

/** 고객 한 명과 가장 최근 예약을 읽어 폼 값으로 */
export async function loadCustomerForm(customerId: string): Promise<{ form: CustomerFormValues; latestApptId: string | null } | null> {
  const { data: c, error } = await supabase.from('customers').select('*').eq('id', customerId).single();
  if (error || !c) return null;
  const { data: a } = await supabase.from('appointments').select('id, appointment_date, end_date, service_type, amount, memo').eq('customer_id', customerId).order('appointment_date', { ascending: false }).limit(1).maybeSingle();
  let apptMemo = '';
  if (a?.memo) { try { JSON.parse(a.memo); } catch { apptMemo = a.memo; } } // 작업 내역서(JSON)는 보여 주지도 고치지도 않음
  return {
    form: {
      name: c.name || '', phone: c.phone || '', car_brand: c.car_brand || '', car_model: c.car_model || '', car_year: c.car_year || '', car_color: c.car_color || '', source: c.source || '', memo: c.memo || '',
      appointment_start_date: a?.appointment_date || '', appointment_end_date: a?.end_date || '', appointment_service_type: a?.service_type || '', appointment_amount: a?.amount ? String(a.amount) : '', appointment_memo: apptMemo,
      kind: (c.kind as string | null) || '일반', dealer_id: (c.dealer_id as string | null) || '',
    },
    latestApptId: a?.id || null,
  };
}

/** 전화번호 저장 형식 통일 010-0000-0000 (2026-11-22) */
function normalizePhoneForSave(raw: string): string | null {
  const t = (raw || '').trim(); if (!t) return null;
  const d = t.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return t;
}

/** 고객 정보 + 최근 예약 저장. 예약이 없는데 시작일을 넣었으면 새 예약을 만든다. 실패하면 오류 문구를 돌려줌 */
export async function saveCustomerEdit(customerId: string, form: CustomerFormValues, latestApptId: string | null): Promise<string | null> {
  if (!form.name.trim()) return '이름은 비울 수 없습니다';
  const { error } = await supabase.from('customers').update({
    name: form.name.trim(), phone: normalizePhoneForSave(form.phone), car_brand: form.car_brand.trim() || null, car_model: form.car_model.trim() || null,
    car_year: form.car_year.trim() || null, car_color: form.car_color.trim() || null, source: form.source || null, memo: form.memo.trim() || null,
    ...(await dealerSupport() ? { kind: form.kind || '일반', dealer_id: form.kind === DEALER_KIND ? null : (form.dealer_id || null) } : {}), // 딜러 구분 (2026-11-23)
  }).eq('id', customerId);
  if (error) return '수정 실패: ' + error.message;
  ensurePrimaryVehicle(customerId, { brand: form.car_brand.trim() || null, model: form.car_model.trim() || null, year: form.car_year.trim() || null, color: form.car_color.trim() || null }).catch(() => {}); // 대표 차량과 맞춤 (2026-11-22)

  const amount = form.appointment_amount ? Number(form.appointment_amount) : null;
  // 예약이 없는 손님인데 날짜 없이 시공 종류·금액만 적으면 그동안 조용히 버려졌음 (2026-11-26 김지훈 실내PPF "수정했는데 반영이 안 돼") → 어디에 적어야 하는지 알려 주고 멈춘다
  if (!latestApptId && !form.appointment_start_date && (form.appointment_service_type || amount)) {
    return '예약으로 남기려면 입고 날짜를 적어 주세요.\n이미 끝난 시공이면 고객 상세 → 시공 이력 → "시공 추가"에서 날짜·금액과 함께 남겨 주세요.';
  }
  if (latestApptId) {
    const patch: Record<string, unknown> = { amount, service_type: form.appointment_service_type || null };
    if (form.appointment_start_date) { patch.appointment_date = form.appointment_start_date; patch.end_date = form.appointment_end_date || null; }
    const { data: cur } = await supabase.from('appointments').select('memo').eq('id', latestApptId).single();
    let curIsJson = false; try { if (cur?.memo) { JSON.parse(cur.memo); curIsJson = true; } } catch { /* 글 메모 */ }
    if (!curIsJson) patch.memo = form.appointment_memo || null;
    const { error: e2 } = await supabase.from('appointments').update(patch).eq('id', latestApptId);
    if (e2) return '예약 저장 실패: ' + e2.message;
  } else if (form.appointment_start_date) {
    const { error: e3 } = await supabase.from('appointments').insert({
      customer_id: customerId, appointment_date: form.appointment_start_date, end_date: form.appointment_end_date || null,
      service_type: form.appointment_service_type || null, status: form.appointment_service_type ? '예약확정' : '상담중', amount, memo: form.appointment_memo || null,
    });
    if (e3) return '예약 저장 실패: ' + e3.message;
    closeQuoteFollowUpsFor(customerId, form.phone).catch(() => {}); // 예약 잡히면 견적 재연락 닫기 (2026-11-22)
    ensureArrivalNotice({ customerId, name: form.name.trim(), phone: form.phone, date: form.appointment_start_date, serviceType: form.appointment_service_type || null }).catch(() => {}); // 입고 전날 안내 (2026-11-22)
  }
  return null;
}

const input = 'w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50';
const label = 'text-xs text-[var(--c-text-3)] mb-1 block';

export default function CustomerFormModal({ mode, form, setForm, latestApptId, busy, onSubmit, onClose, referrerId, setReferrerId, excludeCustomerId }: {
  mode: 'add' | 'edit';
  form: CustomerFormValues;
  setForm: (f: CustomerFormValues) => void;
  latestApptId?: string | null;
  busy?: boolean;
  onSubmit: () => void;
  onClose: () => void;
  /** 멤버십(2026-11-18): 유입경로가 소개/재방문이면 "소개한 분"을 고른다. 저장은 부모가 linkReferral 로 */
  referrerId?: string | null;
  setReferrerId?: (id: string | null) => void;
  /** 수정 중인 고객 본인은 소개한 분 목록에서 뺀다 */
  excludeCustomerId?: string | null;
}) {
  const set = (k: keyof CustomerFormValues, v: string) => setForm({ ...form, [k]: v });
  const showReferrer = !!setReferrerId && form.source === '소개/재방문';
  type Person = { id: string; name: string; phone: string | null; car_brand: string | null; car_model: string | null };
  const [people, setPeople] = useState<Person[] | null>(null);
  useEffect(() => {
    if (!showReferrer || people) return;
    supabase.from('customers').select('id, name, phone, car_brand, car_model').neq('kind', '딜러').order('name').then(({ data }) => setPeople((data || []) as Person[]));
  }, [showReferrer, people]);
  // 소개한 분 검색 (2026-11-19 사장님 "고객이 많아지면 하나하나 찾기 힘드니 검색도 되게"): 이름·전화 숫자·차종으로 거르고 위 8명만
  const [refQuery, setRefQuery] = useState('');
  const [refOpen, setRefOpen] = useState(false);
  const refSelected = (people || []).find((p) => p.id === referrerId) || null;
  const personLabel = (p: Person) => `${p.name}${p.car_brand || p.car_model ? ` · ${[p.car_brand, p.car_model].filter(Boolean).join(' ')}` : ''}${p.phone ? ` · ${p.phone.replace(/\D/g, '').slice(-4)}` : ''}`;
  const refMatches = (() => {
    const q = refQuery.trim().toLowerCase(); const qd = q.replace(/\D/g, '');
    return (people || []).filter((p) => p.id !== excludeCustomerId).filter((p) => {
      if (!q) return true;
      const car = [p.car_brand, p.car_model].filter(Boolean).join(' ').toLowerCase();
      return p.name.toLowerCase().includes(q) || car.includes(q) || (qd.length >= 2 && (p.phone || '').replace(/\D/g, '').includes(qd));
    }).slice(0, 8);
  })();
  const apptTitle = mode === 'add' ? '예약 정보 (선택)' : latestApptId ? '최근 예약 (고치면 그 예약이 바뀝니다)' : '예약 정보 (시작일을 넣으면 새 예약이 생깁니다)';
  // 딜러 구분 (2026-11-23 사장님 "차를 넣어 주는 건 딜러, 실제 고객은 따로"): 종류 선택 + 일반 고객이면 "넣어 주신 딜러"
  const [dealers, setDealers] = useState<DealerRef[] | null>(null);
  const [dealerOk, setDealerOk] = useState<boolean | null>(null);
  useEffect(() => { dealerSupport().then((ok) => { setDealerOk(ok); if (ok) loadDealers().then(setDealers); }); }, []);
  const isDealerForm = form.kind === DEALER_KIND;
  // 딜러 검색 (2026-11-23 사장님 "딜러 검색 가능하게"): 이름·직급·전시장·전화 뒷자리로 거르고 위 8명
  const [dealerQuery, setDealerQuery] = useState('');
  const [dealerOpen, setDealerOpen] = useState(false);
  const dealerSelected = (dealers || []).find((d) => d.id === form.dealer_id) || null;
  const dealerLabel = (d: DealerRef) => `${d.name}${d.memo ? ` · ${d.memo.split('\n')[0].slice(0, 24)}` : ''}${d.phone ? ` · ${d.phone.replace(/\D/g, '').slice(-4)}` : ''}`;
  const dealerMatches = (() => {
    const q = dealerQuery.trim().toLowerCase(); const qd = q.replace(/\D/g, '');
    return (dealers || []).filter((d) => !q || d.name.toLowerCase().includes(q) || (d.memo || '').toLowerCase().includes(q) || (qd.length >= 2 && (d.phone || '').replace(/\D/g, '').includes(qd))).slice(0, 8);
  })();
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[var(--c-text-1)] font-semibold text-base mb-4">{mode === 'edit' ? '고객 수정' : '고객 추가'}</h3>
        <div className="grid grid-cols-2 gap-3">
          {dealerOk && (
            <div className="col-span-2 flex items-center gap-2">
              <span className={label + ' mb-0'}>종류</span>
              <div className="inline-flex rounded-lg border border-[var(--c-border)] overflow-hidden text-xs font-semibold">
                {(['일반', DEALER_KIND] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setForm({ ...form, kind: k, dealer_id: k === DEALER_KIND ? '' : form.dealer_id })} className={`px-3 py-1.5 transition-colors ${form.kind === k ? 'bg-[var(--c-text-1)] text-[var(--c-card)]' : 'text-[var(--c-text-2)] hover:bg-[var(--c-subtle)]'}`}>{k === DEALER_KIND ? '딜러' : '일반 고객'}</button>
                ))}
              </div>
              {isDealerForm && <span className="text-[11px] text-[var(--c-text-4)]">딜러는 입고·출고 안내만 받고, 보증서·관리 안내는 실제 고객에게 갑니다</span>}
            </div>
          )}
          <div className="col-span-2"><label className={label}>{isDealerForm ? '딜러 이름 *' : '이름 *'}</label><input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className={input} placeholder={isDealerForm ? '예: 조중용 부장' : '고객 이름'} /></div>
          <div><label className={label}>연락처</label><input type="tel" inputMode="numeric" value={form.phone} onChange={(e) => set('phone', formatPhoneInput(e.target.value))} className={input} placeholder="010-0000-0000" /></div>
          {!isDealerForm && <div>
            <label className={label}>유입경로</label>
            <select value={form.source} onChange={(e) => set('source', e.target.value)} className={input}>
              <option value="">선택...</option>
              {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>}
          {dealerOk && !isDealerForm && (
            <div className="col-span-2">
              <label className={label}>넣어 주신 딜러 <span className="text-[var(--c-text-4)]">(딜러가 맡긴 차면 선택 — 입고·출고 안내가 딜러에게 갑니다)</span></label>
              {dealerSelected ? (
                <div className={`${input} flex items-center justify-between gap-2`}>
                  <span className="truncate">{dealerLabel(dealerSelected)}</span>
                  <button type="button" onClick={() => { setForm({ ...form, dealer_id: '' }); setDealerQuery(''); setDealerOpen(true); }} className="shrink-0 text-xs text-[var(--c-text-3)] hover:text-danger">✕ 바꾸기</button>
                </div>
              ) : (
                <div className="relative">
                  <input type="text" value={dealerQuery} onChange={(e) => { setDealerQuery(e.target.value); setDealerOpen(true); }} onFocus={() => setDealerOpen(true)} onBlur={() => setTimeout(() => setDealerOpen(false), 150)} className={input} placeholder={dealers ? (dealers.length ? '이름·전시장·전화 뒷자리로 검색 (고객이 직접 오셨으면 비워 둠)' : '딜러가 아직 없습니다 — 종류를 딜러로 두고 먼저 등록') : '불러오는 중…'} />
                  {dealerOpen && dealers && dealers.length > 0 && (
                    <ul className="absolute left-0 right-0 top-full mt-1 z-10 max-h-56 overflow-y-auto bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg shadow-lg py-1">
                      {dealerMatches.length === 0 ? <li className="px-3 py-2 text-xs text-[var(--c-text-4)]">맞는 딜러가 없습니다</li> : dealerMatches.map((d) => (
                        <li key={d.id}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setForm({ ...form, dealer_id: d.id, source: form.source || '고정' }); setDealerOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-[var(--c-text-1)] hover:bg-[var(--c-hover)]">{dealerLabel(d)}</button></li>
                      ))}
                      {!dealerQuery && dealers.length > 8 && <li className="px-3 py-1.5 text-[11px] text-[var(--c-text-4)]">전체 {dealers.length}명 중 8명만 표시 · 이름이나 전시장을 입력해 주세요</li>}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
          {showReferrer && (
            <div className="col-span-2">
              <label className={label}>소개한 분 <span className="text-[var(--c-text-4)]">(회원 혜택: 소개한 분 {MEMBERSHIP.referrerReward} · 소개받은 분 {MEMBERSHIP.referredCondition}일 때 혜택)</span></label>
              {refSelected ? (
                <div className={`${input} flex items-center justify-between gap-2`}>
                  <span className="truncate">{personLabel(refSelected)}</span>
                  <button type="button" onClick={() => { setReferrerId?.(null); setRefQuery(''); setRefOpen(true); }} className="shrink-0 text-xs text-[var(--c-text-3)] hover:text-danger">✕ 바꾸기</button>
                </div>
              ) : (
                <div className="relative">
                  <input type="text" value={refQuery} onChange={(e) => { setRefQuery(e.target.value); setRefOpen(true); }} onFocus={() => setRefOpen(true)} onBlur={() => setTimeout(() => setRefOpen(false), 150)} className={input} placeholder={people ? '이름·전화 뒷자리·차종으로 검색 (재방문이면 비워 둠)' : '불러오는 중…'} />
                  {refOpen && people && (
                    <ul className="absolute left-0 right-0 top-full mt-1 z-10 max-h-56 overflow-y-auto bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg shadow-lg py-1">
                      {refMatches.length === 0 ? <li className="px-3 py-2 text-xs text-[var(--c-text-4)]">맞는 고객이 없습니다</li> : refMatches.map((p) => (
                        <li key={p.id}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setReferrerId?.(p.id); setRefOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-[var(--c-text-1)] hover:bg-[var(--c-hover)]">{personLabel(p)}</button></li>
                      ))}
                      {!refQuery && (people.length - (excludeCustomerId ? 1 : 0)) > 8 && <li className="px-3 py-1.5 text-[11px] text-[var(--c-text-4)]">전체 {people.length}명 중 8명만 표시 · 이름이나 번호를 입력해 주세요</li>}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
          {isDealerForm ? (
            <div className="col-span-2"><label className={label}>소속 (전시장·브랜드)</label><input type="text" value={form.memo} onChange={(e) => set('memo', e.target.value)} className={input} placeholder="예: BMW 성수전시장" /></div>
          ) : (<>
          <div><label className={label}>차량 브랜드</label><input type="text" value={form.car_brand} onChange={(e) => set('car_brand', e.target.value)} className={input} placeholder="BMW, 벤츠, 포르쉐 등" /></div>
          <div><label className={label}>차량 모델</label><input type="text" value={form.car_model} onChange={(e) => set('car_model', e.target.value)} className={input} placeholder="X5, GLE, 카이엔 등" /></div>
          <div><label className={label}>연식</label><input type="text" value={form.car_year} onChange={(e) => set('car_year', e.target.value)} className={input} placeholder="2024" /></div>
          <div><label className={label}>색상</label><input type="text" value={form.car_color} onChange={(e) => set('car_color', e.target.value)} className={input} placeholder="블랙, 화이트 등" /></div>
          <div className="col-span-2"><label className={label}>메모</label><textarea value={form.memo} onChange={(e) => set('memo', e.target.value)} className={`${input} resize-none h-20`} placeholder="특이사항" /></div>

          <div className="col-span-2 border-t border-[var(--c-border)] pt-3 mt-1"><div className="text-xs text-gold font-medium mb-2">{apptTitle}</div></div>
          <div><label className={label}>시공 시작일</label><input type="date" value={form.appointment_start_date} onChange={(e) => set('appointment_start_date', e.target.value)} onInput={(e) => set('appointment_start_date', (e.target as HTMLInputElement).value)} className={input} /></div>
          <div><label className={label}>시공 종료일</label><input type="date" value={form.appointment_end_date} onChange={(e) => set('appointment_end_date', e.target.value)} onInput={(e) => set('appointment_end_date', (e.target as HTMLInputElement).value)} className={input} /></div>
          <div className="col-span-2">
            <label className={label}>시공 종류</label>
            <select value={form.appointment_service_type} onChange={(e) => set('appointment_service_type', e.target.value)} className={input}>
              <option value="">선택...</option>
              {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="col-span-2"><label className={label}>예상 금액</label><input type="text" inputMode="numeric" value={form.appointment_amount ? Number(form.appointment_amount).toLocaleString() : ''} onChange={(e) => set('appointment_amount', e.target.value.replace(/[^0-9]/g, ''))} className={input} placeholder="2,500,000" /></div>
          <div className="col-span-2"><label className={label}>예약 메모</label><textarea value={form.appointment_memo} onChange={(e) => set('appointment_memo', e.target.value)} className={`${input} resize-none h-16`} placeholder="예약 관련 메모" /></div>
          </>)}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-2)] transition-colors disabled:opacity-50">취소</button>
          <button onClick={onSubmit} disabled={busy} className="bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-50">{busy ? '저장 중…' : mode === 'edit' ? '수정' : '추가'}</button>
        </div>
      </div>
    </div>
  );
}
