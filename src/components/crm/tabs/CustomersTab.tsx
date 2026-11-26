'use client';

/** 고객 목록 탭 (2026-11-23 page.tsx 에서 분리 — 동작 변경 없음). 상태·핸들러는 page.tsx 에 있고 props 로 받는다 */
import Btn from '@/components/ui/Btn';
import { EMPTY_CUSTOMER_FORM, type CustomerFormValues } from '@/components/crm/CustomerFormModal';
import { useRef, useState } from 'react';
import { DEALER_KIND, isRetiredDealer } from '@/lib/dealers';
import { buildVCards, deliverVcf, VCF_HINT, loadSavedContacts, markContactsSaved, unsavedContacts, type SavedContacts } from '@/lib/vcard';
import { useEffect } from 'react';
import { isBlacklisted, blacklistInfo } from '@/lib/blacklist';
import type { Vehicle } from '@/lib/vehicles';
import { type Customer, formatDate } from '@/lib/crm-shared';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { memberMissing } from '@/lib/member-ready';
import { isMemberFlag } from '@/lib/membership-flag';
import { ensurePrimaryVehicle } from '@/lib/vehicles';
import { formatPhoneInput } from '@/lib/phone';
import MemberSmsButtons from '@/components/crm/MemberSmsButtons';
import BlacklistModal from '@/components/crm/BlacklistModal';
import DeviceDiagModal from '@/components/crm/DeviceDiagModal';

interface CustomersTabProps {
  customerSearch: string;
  setCustomerSearch: (v: string) => void;
  /** 검색어로 거른 고객 (page.tsx 에서 계산) */
  filteredCustomers: Customer[];
  vehiclesByCustomer: Map<string, Vehicle[]>;
  /** 딜러 id → 이름 (2026-11-23): 손님 줄에 "딜러 ○○○" 표시 */
  dealerNames?: Map<string, string>;
  router: { push: (href: string) => void };
  setCustomerForm: (form: CustomerFormValues) => void;
  setEditCustomerId: (id: string | null) => void;
  setShowAddCustomer: (v: boolean) => void;
  handleEditCustomer: (customer: Customer) => void;
  handleDeleteCustomer: (id: string, name: string) => void;
  /** 빈 칸(차종·연락처)을 줄에서 바로 적어 저장한 뒤 목록 다시 읽기 (2026-11-26 사장님 "- 누르면 바로 수정") */
  refresh?: () => void;
}

export default function CustomersTab({
  customerSearch, setCustomerSearch, filteredCustomers, vehiclesByCustomer, router, dealerNames,
  setCustomerForm, setEditCustomerId, setShowAddCustomer, handleEditCustomer, handleDeleteCustomer, refresh,
}: CustomersTabProps) {
  // 종류 필터 (2026-11-23): 고객 / 회원 / 딜러 / 전체. 기본은 고객만 — 딜러가 목록 맨 위를 차지하지 않게
  // '회원' 필터 (2026-11-26 사장님 "작업 받으면 다 회원인데 고객 목록·회원 탭을 나눌 필요가 있나" → 회원 탭을 빼고 여기로): 시공 기록 + 성함·전화·차종이 다 있는 분
  const [kindFilter, setKindFilter] = useState<'all' | 'customer' | 'member' | 'dealer'>('customer');
  const [onlyUnsent, setOnlyUnsent] = useState(false);
  const [showBlacklist, setShowBlacklist] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  // 회원 페이지 보낸 분·열어 본 분 (회원 탭에서 옮겨 옴): 보냄 = 상담 기록 "[회원 문자] 회원 페이지 링크", 열어 봄 = member_links.visits
  const [linkSent, setLinkSent] = useState<Map<string, string>>(new Map());
  const [linkVisits, setLinkVisits] = useState<Map<string, number>>(new Map());
  const loadLinks = async () => {
    const [{ data: sent }, { data: links }] = await Promise.all([
      supabase.from('consultations').select('customer_id, consultation_date').eq('memo', '회원 문자').like('content', '[회원 문자] 회원 페이지 링크%').order('consultation_date', { ascending: false }),
      supabase.from('member_links').select('customer_id, visits'),
    ]);
    const sm = new Map<string, string>(); for (const x of sent || []) if (x.customer_id && !sm.has(x.customer_id)) sm.set(x.customer_id, x.consultation_date); setLinkSent(sm);
    setLinkVisits(new Map((links || []).map((l) => [l.customer_id as string, (l.visits as number | null) || 0])));
  };
  useEffect(() => { loadLinks(); }, []);
  // 줄에서 바로 적기 (2026-11-26): 차종·연락처가 비어 '-' 로 보이는 칸을 누르면 입력 칸이 되고, Enter 나 다른 곳 클릭으로 저장
  const [inline, setInline] = useState<{ id: string; field: 'car' | 'phone'; value: string } | null>(null);
  const [inlineBusy, setInlineBusy] = useState(false);
  const skipBlur = useRef(false); // Escape 로 취소한 직후 blur 가 저장하지 않게
  const saveInline = async () => {
    if (skipBlur.current) { skipBlur.current = false; return; }
    if (!inline || inlineBusy) return;
    const v = inline.value.trim();
    const { id, field } = inline;
    if (!v) { setInline(null); return; }
    setInlineBusy(true);
    try {
      if (field === 'car') {
        const parts = v.split(/\s+/);
        const brand = parts.length > 1 ? parts[0] : null; // "BMW X5" → 브랜드 BMW, 차종 X5 / 한 단어면 차종만
        const model = parts.length > 1 ? parts.slice(1).join(' ') : v;
        const { error } = await supabase.from('customers').update({ car_brand: brand, car_model: model }).eq('id', id);
        if (error) throw new Error(error.message);
        const c = filteredCustomers.find((x) => x.id === id);
        ensurePrimaryVehicle(id, { brand, model, year: c?.car_year || null, color: c?.car_color || null }).catch(() => {});
      } else {
        const digits = v.replace(/\D/g, '');
        if (digits.length < 10) { alert('전화번호를 끝까지 적어 주세요.'); setInlineBusy(false); return; }
        const phone = digits.length === 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}` : v;
        const { error } = await supabase.from('customers').update({ phone }).eq('id', id);
        if (error) throw new Error(error.message);
      }
      setInline(null);
      refresh?.();
    } catch (e) { alert(`저장 실패: ${e instanceof Error ? e.message : e}`); }
    finally { setInlineBusy(false); }
  };
  const inlineInput = (field: 'car' | 'phone') => (
    <input
      autoFocus
      value={inline?.value || ''}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setInline((cur) => cur ? { ...cur, value: field === 'phone' ? formatPhoneInput(e.target.value) : e.target.value } : cur)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveInline(); } if (e.key === 'Escape') { skipBlur.current = true; setInline(null); } }}
      onBlur={saveInline}
      placeholder={field === 'car' ? '예: BMW X5' : '010-0000-0000'}
      inputMode={field === 'phone' ? 'tel' : undefined}
      className="w-36 bg-[var(--c-input)] border border-[var(--c-text-1)] rounded-md px-2 py-1 text-sm text-[var(--c-text-1)] outline-none"
    />
  );
  const emptyCell = (c: Customer, field: 'car' | 'phone') => (
    <button type="button" onClick={(e) => { e.stopPropagation(); setInline({ id: c.id, field, value: '' }); }} className="text-[var(--c-text-4)] hover:text-[var(--c-text-1)] border-b border-dashed border-[var(--c-text-4)] leading-none" title={field === 'car' ? '눌러서 차종 적기' : '눌러서 전화번호 적기'}>-</button>
  );
  const missingOf = (c: Customer) => c.kind === DEALER_KIND ? [] : memberMissing({ name: c.name, phone: c.phone, car: [c.car_brand, c.car_model].filter(Boolean).join(' '), workCount: c.service_count });
  const isMember = (c: Customer) => c.kind !== DEALER_KIND && isMemberFlag(c.memo); // 회원 = 사장님이 등록한 분 (2026-11-26)
  const linkDelivered = (id: string) => linkSent.has(id) || (linkVisits.get(id) || 0) > 0;
  const members = filteredCustomers.filter(isMember);
  const unsentCount = members.filter((c) => !linkDelivered(c.id)).length;
  const rows = kindFilter === 'all' ? filteredCustomers
    : kindFilter === 'member' ? members.filter((c) => !onlyUnsent || !linkDelivered(c.id))
    : filteredCustomers.filter((c) => (c.kind === DEALER_KIND) === (kindFilter === 'dealer'));
  const memberView = kindFilter === 'member';
  // 연락처 저장 (2026-11-23 사장님 "버튼 한 번이면 내 연락처에"): 지금 보이는 줄(검색·필터 적용)을 vCard 한 파일로
  const [vcfBusy, setVcfBusy] = useState(false);
  const [saved, setSaved] = useState<SavedContacts>({});
  useEffect(() => { setSaved(loadSavedContacts()); }, []);
  const contactList = rows.map((c) => c.kind === DEALER_KIND
    ? { id: c.id, name: c.name, phone: c.phone, prefix: (c.memo || '').split('\n')[0], org: (c.memo || '').split('\n')[0] || '딜러', title: '딜러' }
    : { id: c.id, name: c.name, phone: c.phone, tag: [c.car_brand, c.car_model].filter(Boolean).join(' '), org: '프로이즘 고객', note: c.source ? `유입경로 ${c.source}` : null });
  const fresh = unsavedContacts(contactList, saved); // 이 기기에서 아직 안 넘긴 분(번호 바뀐 분 포함)만 — 중복 저장 방지 (2026-11-23)
  const saveContacts = async () => {
    let list = fresh;
    if (list.length === 0) {
      if (!confirm('지금 보이는 분은 이 기기에서 모두 연락처로 넘겼습니다.\n전부 다시 만들까요? (연락처 앱에 이미 있으면 중복이 생길 수 있습니다)')) return;
      list = contactList;
    }
    const { text, count } = buildVCards(list);
    if (!count) { alert('전화번호가 있는 고객이 없습니다.'); return; }
    const skipped = rows.length - count;
    if (!confirm(`${count}명을 연락처 파일로 만들까요?${skipped > 0 ? `\n(이미 넘긴 분·전화 없는 분 ${skipped}명은 뺍니다)` : ''}`)) return;
    setVcfBusy(true);
    try {
      const how = await deliverVcf(text, `프로이즘-고객-${count}명.vcf`);
      if (how === 'shared' || how === 'downloaded') setSaved(markContactsSaved(list, saved));
      alert(`${count}명 — ${VCF_HINT[how]}`);
    } finally { setVcfBusy(false); }
  };
  return (
    <div>
      {/* 폰(375px)에서 검색칸·버튼이 한 줄에 못 들어가 글자가 세로로 깨지던 것 → 줄바꿈 허용, 검색칸은 폰에서 꽉 차게 (2026-11-23 갤럭시 점검) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <input
            type="text"
            placeholder="이름, 차종으로 검색..."
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] w-full sm:w-64 outline-none focus:border-gold/50 transition-colors placeholder:text-[var(--c-text-3)]"
          />
          <span className="text-xs text-[var(--c-text-3)]">{rows.length}명</span>
          <div className="inline-flex rounded-lg border border-[var(--c-border)] overflow-hidden text-[11px] font-semibold">
            {([['customer', '고객'], ['member', `회원 ${members.length}`], ['dealer', '딜러'], ['all', '전체']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setKindFilter(k)} className={`px-2.5 py-1.5 whitespace-nowrap transition-colors ${kindFilter === k ? 'bg-[var(--c-text-1)] text-[var(--c-card)]' : 'text-[var(--c-text-2)] hover:bg-[var(--c-subtle)]'}`}>{l}</button>
            ))}
          </div>
          {memberView && (
            <>
              <button onClick={() => setOnlyUnsent((v) => !v)} className={`text-[11px] font-medium px-2.5 py-1.5 rounded-full border whitespace-nowrap transition-colors ${onlyUnsent ? 'bg-[var(--c-text-1)] text-[var(--c-card)] border-[var(--c-text-1)]' : 'border-[var(--c-border)] text-[var(--c-text-1)] hover:bg-[var(--c-subtle)]'}`}>링크 안 보낸 분만 {unsentCount}명</button>
              <Link href="/crm/membership" className="text-[11px] text-[var(--c-text-3)] hover:text-[var(--c-text-1)] whitespace-nowrap">소개 현황 →</Link>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 sm:ml-auto">
        <button onClick={saveContacts} disabled={vcfBusy || rows.length === 0} title={fresh.length > 0 ? `아직 폰 연락처에 없는 ${fresh.length}명을 저장` : '지금 보이는 분은 모두 폰 연락처에 있음'} className={`inline-flex items-center gap-1.5 text-sm font-semibold rounded-full pl-3 pr-2 py-2 border transition-colors disabled:opacity-50 whitespace-nowrap ${fresh.length > 0 ? 'border-[var(--c-text-1)] text-[var(--c-text-1)] hover:bg-[var(--c-subtle)]' : 'border-[var(--c-border)] text-[var(--c-text-3)]'}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
          연락처
          {fresh.length > 0
            ? <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-brand text-white text-[11px] font-bold inline-flex items-center justify-center tabular-nums">{fresh.length}</span>
            : <span className="text-ok text-xs font-bold px-1">✓</span>}
        </button>
        <Btn icon="plus" variant="primary" onClick={() => { setEditCustomerId(null); setCustomerForm({ ...EMPTY_CUSTOMER_FORM }); setShowAddCustomer(true); }}>고객 추가</Btn>
        </div>
      </div>

      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-x-auto">
        <table className="w-full whitespace-nowrap md:whitespace-normal">
          <thead>
            <tr className="border-b border-[var(--c-border)]">
              <th className="text-left px-4 py-3 text-xs font-medium text-[var(--c-text-3)]">이름</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-[var(--c-text-3)]">연락처</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-[var(--c-text-3)]">차종</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-[var(--c-text-3)]">최근 시공</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-[var(--c-text-3)]">등록일</th>
              {memberView && <th className="text-left px-4 py-3 text-xs font-medium text-[var(--c-text-3)]">회원 페이지</th>}
              {memberView && <th className="text-left px-4 py-3 text-xs font-medium text-[var(--c-text-3)]">문자</th>}
              <th className="w-20"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr
                key={c.id}
                onClick={() => router.push(`/crm/${c.id}`)}
                className="border-b border-[var(--c-border)] last:border-b-0 hover:bg-[var(--c-page)] cursor-pointer transition-colors group"
              >
                <td className="px-4 py-3 text-sm text-[var(--c-text-1)] font-medium">
                  {c.name}
                  {c.kind === DEALER_KIND && <span className="ml-1.5 text-[9px] bg-[var(--c-text-1)] text-[var(--c-card)] px-1.5 py-0.5 rounded-full font-semibold">딜러</span>}
                  {c.kind === DEALER_KIND && isRetiredDealer(c.memo) && <span className="ml-1 text-[9px] bg-[var(--c-subtle)] text-[var(--c-text-3)] px-1.5 py-0.5 rounded-full font-medium line-through">퇴사</span>}
                  {c.dealer_id && dealerNames?.get(c.dealer_id) && <span className="ml-1.5 text-[9px] bg-[var(--c-subtle)] text-[var(--c-text-3)] px-1.5 py-0.5 rounded-full font-medium" title="이 차를 넣어 준 딜러">딜러 {dealerNames.get(c.dealer_id)}</span>}
                  {isBlacklisted(c.memo) && <span className="ml-1.5 text-[9px] bg-danger/15 text-danger px-1.5 py-0.5 rounded-full font-semibold" title={blacklistInfo(c.memo)?.reason || ''}>⛔ 블랙리스트</span>}
                  {isMember(c) && <span className="ml-1.5 text-[9px] bg-ok/10 text-ok px-1.5 py-0.5 rounded-full font-semibold" title="시공 기록 + 성함·전화·차종이 다 있는 회원">회원</span>}
                  {isMember(c) && missingOf(c).length > 0 && <span className="ml-1.5 text-[9px] bg-warn/10 text-warn px-1.5 py-0.5 rounded-full font-medium" title="회원인데 빠진 정보가 있어 회원 문자를 보낼 수 없음 — 고객 정보 수정에서 채우기">{missingOf(c).join('·')} 없음</span>}
                  {c.service_count >= 2 && <span className="ml-1.5 text-[9px] bg-gold/20 text-gold px-1.5 py-0.5 rounded-full font-medium">재방문</span>}
                  {(vehiclesByCustomer.get(c.id)?.length || 0) > 1 && <span className="ml-1 text-[9px] bg-info/15 text-info px-1.5 py-0.5 rounded-full font-medium">차 {vehiclesByCustomer.get(c.id)!.length}대</span>}
                </td>
                <td className="px-4 py-3 text-sm text-[var(--c-text-2)]">{inline?.id === c.id && inline.field === 'phone' ? inlineInput('phone') : c.phone || emptyCell(c, 'phone')}</td>
                <td className="px-4 py-3 text-sm text-[var(--c-text-2)]">
                  {c.kind === DEALER_KIND
                    ? <span className="text-[var(--c-text-3)]">{(c.memo || '').split('\n')[0] || '-'}</span>
                    : inline?.id === c.id && inline.field === 'car'
                    ? inlineInput('car')
                    : c.car_brand || c.car_model
                    ? `${c.car_brand || ''} ${c.car_model || ''}`.trim()
                    : emptyCell(c, 'car')}
                  {(vehiclesByCustomer.get(c.id)?.length || 0) > 1 && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--c-subtle)] text-[var(--c-text-3)]">외 {(vehiclesByCustomer.get(c.id)?.length || 1) - 1}대</span>}
                </td>
                <td className="px-4 py-3 text-sm text-[var(--c-text-2)]">
                  {c.latest_service
                    ? <>{c.latest_service}{c.latest_is_booking && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-info/10 text-info align-middle">{c.latest_status || '예약'}</span>} <span className="text-[var(--c-text-3)]">({formatDate(c.latest_service_date)})</span></>
                    : '-'}
                </td>
                <td className="px-4 py-3 text-sm text-[var(--c-text-3)]">{formatDate(c.created_at)}</td>
                {memberView && <td className="px-4 py-3 text-xs">{linkSent.has(c.id) ? <span className="text-ok">✓ 보냄 {formatDate(linkSent.get(c.id) || '')}{(linkVisits.get(c.id) || 0) > 0 ? ` · 열어 봄 ${linkVisits.get(c.id)}회` : ''}</span> : (linkVisits.get(c.id) || 0) > 0 ? <span className="text-ok">✓ 열어 봄 {linkVisits.get(c.id)}회</span> : linkVisits.has(c.id) ? <span className="text-[var(--c-text-3)]">링크 있음 · 아직 안 열림</span> : <span className="text-[var(--c-text-4)]">아직</span>}</td>}
                {memberView && <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}><MemberSmsButtons customerId={c.id} name={c.name} phone={c.phone} size="xs" onSent={loadLinks} /></td>}
                <td className="px-2 py-3">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEditCustomer(c); }}
                      className="w-6 h-6 rounded flex items-center justify-center text-[var(--c-text-3)] hover:text-gold hover:bg-gold/10 transition-all text-xs"
                      title="수정"
                    >✎</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteCustomer(c.id, c.name); }}
                      className="w-6 h-6 rounded flex items-center justify-center text-[var(--c-text-3)] hover:text-danger hover:bg-danger/10 transition-all text-xs"
                      title="삭제"
                    >✕</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={memberView ? 8 : 6} className="px-4 py-12 text-center text-sm text-[var(--c-text-3)]">
                  {customerSearch ? '검색 결과가 없습니다' : memberView ? (onlyUnsent ? '링크를 안 보낸 회원이 없습니다' : '아직 회원이 없습니다') : '등록된 고객이 없습니다'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* 회원 탭에서 옮겨 온 작은 입구 (2026-11-26): 블랙리스트는 잘 안 보이게 (2026-11-22 사장님) */}
      <div className="mt-8 flex justify-between">
        <button onClick={() => setShowDiag(true)} className="text-[11px] text-[var(--c-text-4)] hover:text-[var(--c-text-2)] transition-colors">기기 정보</button>
        <button onClick={() => setShowBlacklist(true)} className="text-[11px] text-[var(--c-text-4)] hover:text-danger transition-colors">블랙리스트 관리</button>
      </div>
      {showBlacklist && <BlacklistModal onClose={() => setShowBlacklist(false)} />}
      {showDiag && <DeviceDiagModal onClose={() => setShowDiag(false)} />}
    </div>
  );
}
