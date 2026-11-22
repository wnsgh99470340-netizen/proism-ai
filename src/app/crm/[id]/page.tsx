'use client';

import { useState, useEffect, useCallback } from 'react';
import CustomerFormModal, { EMPTY_CUSTOMER_FORM, loadCustomerForm, saveCustomerEdit, type CustomerFormValues } from '@/components/crm/CustomerFormModal';
import { todaySeoul } from '@/lib/local-date';
import { linkReferral, loadReferralsFor, markThanksSent, updateReferral, unlinkReferral, loadPoints, usePoints, grantPointForReferral, deletePointRow, type Referral, type PointSummary } from '@/lib/referrals';
import { MEMBERSHIP, POINTS } from '@/config/membership';
import MemberSmsButtons from '@/components/crm/MemberSmsButtons';
import VehicleList from '@/components/crm/VehicleList';
import { vehicleLabel, type Vehicle } from '@/lib/vehicles';
import { blacklistInfo, clearBlacklist } from '@/lib/blacklist';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  car_brand: string | null;
  car_model: string | null;
  car_year: string | null;
  car_color: string | null;
  source: string | null;
  memo: string | null;
  created_at: string;
}

interface Service {
  id: string;
  vehicle_id?: string | null;
  service_type: string;
  film_used: string | null;
  service_area: string | null;
  service_date: string | null;
  completion_date: string | null;
  amount: number | null;
  memo: string | null;
}

interface Consultation {
  id: string;
  consultation_date: string;
  content: string | null;
  estimate: string | null;
  interested_services: string | null;
  memo: string | null;
}

interface FollowUp {
  id: string;
  follow_up_type: string;
  scheduled_date: string;
  is_completed: boolean;
  completed_date: string | null;
  memo: string | null;
  service?: { service_type: string };
}

interface Discount {
  id: string;
  discount_date: string;
  discount_type: string;
  discount_value: string | null;
  memo: string | null;
}

type DetailTab = 'services' | 'consultations' | 'followups' | 'discounts';

const SERVICE_TYPE_OPTIONS = ['PPF', '컬러PPF', 'PWF', '랩핑', '크롬죽이기', '썬팅', '유리막코팅', '가죽코팅', '실내PPF', '신차패키지'];

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function CustomerDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]); // 차량 N대 (2026-11-22) — 시공 줄에 어느 차인지 표시용
  // 예약(보증서 발급 여부·다음 예약 표시용, 2026-11-18 사장님: 상세 화면에서도 보증서 보냈는지 보이게)
  const [appts, setAppts] = useState<{ id: string; appointment_date: string; end_date: string | null; service_type: string | null; status: string; memo: string | null }[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [activeTab, setActiveTab] = useState<DetailTab>('services');
  const [discountForm, setDiscountForm] = useState({ discount_date: '', discount_type: '재방문', discount_value: '', memo: '' });

  // Service edit modal state
  // 고객 정보 수정: 고객 목록과 같은 창(CustomerFormModal)을 쓴다 (2026-11-18 사장님: 등록·수정 창은 어디서 열든 같아야 함)
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<CustomerFormValues>({ ...EMPTY_CUSTOMER_FORM });
  const [editLatestApptId, setEditLatestApptId] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  // 멤버십(2026-11-18): 소개 연결·혜택 사용
  const [refs, setRefs] = useState<{ receivedFrom: Referral | null; gave: Referral[]; tableMissing: boolean }>({ receivedFrom: null, gave: [], tableMissing: false });
  // 소개 포인트 (2026-11-19): 잔액·내역·사용
  const [pts, setPts] = useState<PointSummary>({ balance: 0, rows: [], lastEarnAt: null, expiresAt: null, expired: false, tableMissing: false });
  const [ptsOpen, setPtsOpen] = useState(false);
  const [editReferrerId, setEditReferrerId] = useState<string | null>(null);
  const openSms = (phone: string, msg: string) => {
    const p = phone.replace(/[^\d]/g, '');
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    window.open(isIOS ? `sms:${p}&body=${encodeURIComponent(msg)}` : `sms:${p}?body=${encodeURIComponent(msg)}`);
  };
  const startEditInfo = async () => {
    const loaded = await loadCustomerForm(id);
    if (!loaded) { alert('고객 정보를 불러오지 못했습니다'); return; }
    setEditForm(loaded.form); setEditLatestApptId(loaded.latestApptId); setEditReferrerId(refs.receivedFrom?.referrer_id ?? null); setEditOpen(true);
  };
  const saveInfo = async () => {
    setEditBusy(true);
    const err = await saveCustomerEdit(id, editForm, editLatestApptId);
    if (!err && editReferrerId && editForm.source === '소개/재방문') { const e2 = await linkReferral(id, editReferrerId); if (e2) alert(e2); }
    setEditBusy(false);
    if (err) { alert(err); return; }
    setEditOpen(false);
    fetchData();
  };
  const [editService, setEditService] = useState<Service | null>(null);
  const [serviceForm, setServiceForm] = useState({
    service_type: '', service_date: '', completion_date: '', amount: '', memo: '',
  });

  const handleEditService = (s: Service) => {
    setServiceForm({
      service_type: s.service_type || '',
      service_date: s.service_date || '',
      completion_date: s.completion_date || '',
      amount: s.amount ? String(s.amount) : '',
      memo: (() => {
        if (!s.memo) return '';
        try { const p = JSON.parse(s.memo); return (p && typeof p === 'object' && 'car_number' in p) ? '' : s.memo; } catch { return s.memo; }
      })(),
    });
    setEditService(s);
  };

  const handleUpdateService = async () => {
    if (!editService) return;
    await supabase.from('services').update({
      service_type: serviceForm.service_type,
      service_date: serviceForm.service_date || null,
      completion_date: serviceForm.completion_date || null,
      amount: serviceForm.amount ? Number(serviceForm.amount) : null,
      ...(serviceForm.memo ? { memo: serviceForm.memo } : {}),
    }).eq('id', editService.id);
    setEditService(null);
    fetchData();
  };

  const handleDeleteService = async (serviceId: string) => {
    if (!confirm('이 시공 이력을 삭제하시겠습니까?\n관련 사후관리도 함께 삭제됩니다.')) return;
    await supabase.from('follow_ups').delete().eq('service_id', serviceId);
    await supabase.from('services').delete().eq('id', serviceId);
    fetchData();
  };

  const fetchData = useCallback(async () => {
    const [{ data: c }, { data: s }, { data: con }, { data: f }, { data: ap }] = await Promise.all([
      supabase.from('customers').select('*').eq('id', id).single(),
      supabase.from('services').select('*').eq('customer_id', id).order('service_date', { ascending: false }),
      supabase.from('consultations').select('*').eq('customer_id', id).order('consultation_date', { ascending: false }),
      supabase.from('follow_ups').select('*, service:services(service_type)').eq('customer_id', id).order('scheduled_date', { ascending: false }),
      supabase.from('appointments').select('id, appointment_date, end_date, service_type, status, memo').eq('customer_id', id).order('appointment_date', { ascending: false }),
    ]);
    if (c) setCustomer(c);
    if (ap) setAppts(ap);
    if (s) setServices(s);
    if (con) setConsultations(con);
    if (f) setFollowUps(f as FollowUp[]);
    // 할인 이력
    try {
      const res = await fetch(`/api/discounts?customer_id=${id}`);
      if (res.ok) setDiscounts(await res.json());
    } catch { /* ignore */ }
    setRefs(await loadReferralsFor(id));
    setPts(await loadPoints(id));
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (!customer) {
    return (
      <div className="h-dvh bg-[var(--c-page)] flex items-center justify-center text-[var(--c-text-3)] text-sm">
        불러오는 중...
      </div>
    );
  }

  const tabs: { key: DetailTab; label: string; count: number }[] = [
    { key: 'services', label: '시공 이력', count: services.length },
    { key: 'consultations', label: '상담 기록', count: consultations.length },
    { key: 'followups', label: '사후관리', count: followUps.length },
    { key: 'discounts', label: '할인 이력', count: discounts.length },
  ];

  return (
    <div className="h-dvh flex flex-col bg-[var(--c-page)]">
      {/* Header */}
      <div className="h-14 border-b border-[var(--c-border)] bg-[var(--c-card)] flex items-center px-4 justify-between shrink-0 pt-[env(safe-area-inset-top)] box-content">
        <div className="flex items-center gap-3">
          <Link href="/crm" className="text-[var(--c-text-3)] hover:text-[var(--c-text-1)] transition-colors text-sm">
            ← CRM
          </Link>
          <span className="text-[var(--c-border)]">|</span>
          <span className="text-[var(--c-text-1)] font-semibold text-sm">{customer.name}</span>
          {customer.phone && <span className="text-[var(--c-text-3)] text-xs">{customer.phone}</span>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {blacklistInfo(customer.memo) && (
          <div className="mb-4 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 flex items-center gap-3">
            <span className="text-danger font-semibold text-sm">⛔ 블랙리스트 고객</span>
            <span className="text-sm text-[var(--c-text-2)]">{blacklistInfo(customer.memo)?.reason} <span className="text-[var(--c-text-4)]">· {blacklistInfo(customer.memo)?.date}</span></span>
            <button onClick={async () => { if (!confirm('블랙리스트에서 뺄까요?')) return; const e = await clearBlacklist(customer.id); if (e) alert(e); else fetchData(); }} className="ml-auto text-xs text-[var(--c-text-3)] hover:text-ok">해제</button>
          </div>
        )}
        {/* 차량 (2026-11-22 차량 N대) */}
        <VehicleList customerId={id} onChange={setVehicles} />
        {/* Customer Info Card */}
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-[var(--c-text-3)]">고객 정보</div>
            <button onClick={startEditInfo} className="text-xs font-semibold rounded-full px-3 py-1.5 border border-[var(--c-border)] bg-[var(--c-card)] hover:bg-[var(--c-subtle)] text-[var(--c-text-1)] transition-colors">✎ 수정</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InfoItem label="차량" value={
              [customer.car_brand, customer.car_model].filter(Boolean).join(' ') || '-'
            } />
            <InfoItem label="연식" value={customer.car_year || '-'} />
            <InfoItem label="색상" value={customer.car_color || '-'} />
            <InfoItem label="유입경로" value={customer.source || '-'} />
            <InfoItem label="등록일" value={formatDate(customer.created_at)} />
            <InfoItem label="시공 횟수" value={`${services.length}회`} />
            <InfoItem label="총 매출" value={
              services.reduce((sum, s) => sum + (s.amount || 0), 0) > 0
                ? `${services.reduce((sum, s) => sum + (s.amount || 0), 0).toLocaleString()}원`
                : '-'
            } />
            {(() => {
              // 다음(또는 최근) 예약: 취소 제외, 날짜 내림차순 첫 건
              const a = appts.find((x) => x.status !== '취소');
              return a ? <InfoItem label="예약" value={`${a.service_type || '시공 미정'} · ${formatDate(a.appointment_date)}${a.end_date && a.end_date !== a.appointment_date ? `~${formatDate(a.end_date).slice(6)}` : ''} · ${a.status}`} /> : <InfoItem label="예약" value="-" />;
            })()}
            {(() => {
              // 보증서: 예약 메모(JSON)에 warranty_issued / warranty 가 있으면 발급된 것. 매장 보증서 페이지 링크(warranty_url)가 있으면 열기
              type W = { warranty_issued?: boolean; warranty?: { date?: string; work_details?: string }; warranty_url?: string };
              const issued = appts.map((x) => { try { return { a: x, w: JSON.parse(x.memo || '') as W }; } catch { return null; } }).filter((v): v is { a: typeof appts[number]; w: W } => !!v && !!(v.w.warranty_issued || v.w.warranty));
              const done = appts.find((x) => x.status === '완료');
              const makeLink = (apptId: string, text: string) => <Link href={`/crm?tab=appointments&warranty=${apptId}`} className="text-xs font-semibold px-2 py-0.5 rounded-full border border-[var(--c-border)] hover:bg-[var(--c-subtle)]">{text}</Link>;
              if (issued.length === 0) {
                return (
                  <div>
                    <div className="text-xs text-[var(--c-text-3)] mb-0.5">보증서</div>
                    <div className="text-sm text-[var(--c-text-1)] flex items-center gap-2 flex-wrap">{done ? <><span>미발급</span>{makeLink(done.id, '발급하기')}</> : '-'}</div>
                  </div>
                );
              }
              const { a, w } = issued[0];
              const url = (w.warranty_url || '').replace(/\s+/g, '');
              return (
                <div>
                  <div className="text-xs text-[var(--c-text-3)] mb-0.5">보증서</div>
                  <div className="text-sm text-[var(--c-text-1)] flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-ok font-semibold">✓ 발급</span>
                    <span className="text-[var(--c-text-3)]">{formatDate(w.warranty?.date || a.appointment_date)}{w.warranty?.work_details ? ` · ${w.warranty.work_details}` : a.service_type ? ` · ${a.service_type}` : ''}</span>
                    {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold px-2 py-0.5 rounded-full border border-[var(--c-border)] hover:bg-[var(--c-subtle)]">보기</a> : makeLink(a.id, '보증서 페이지 만들기')}
                    {issued.length > 1 && <span className="text-xs text-[var(--c-text-4)]">외 {issued.length - 1}건</span>}
                  </div>
                </div>
              );
            })()}
            {customer.memo && <InfoItem label="메모" value={customer.memo} />}
          </div>
        </div>
        {editOpen && (
          <CustomerFormModal mode="edit" form={editForm} setForm={setEditForm} latestApptId={editLatestApptId} busy={editBusy} referrerId={editReferrerId} setReferrerId={setEditReferrerId} excludeCustomerId={id} onSubmit={saveInfo} onClose={() => { if (!editBusy) setEditOpen(false); }} />
        )}

        {/* 멤버십 카드 (2026-11-18): 회원 여부(시공 완료면 자동), 소개받음·소개함과 혜택 사용 */}
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-xs font-semibold text-[var(--c-text-3)]">{MEMBERSHIP.name}</div>
              {services.length > 0
                ? <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-ok/10 text-ok">회원 · 가입 {formatDate(services[services.length - 1].service_date)}</span>
                : <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[var(--c-subtle)] text-[var(--c-text-3)]">비회원 · 시공 완료 시 자동 가입</span>}
            </div>
            <MemberSmsButtons customerId={customer.id} name={customer.name} phone={customer.phone} onSent={fetchData} />
          </div>
          {refs.tableMissing ? (
            <div className="text-xs text-warn">소개 기록 표(referrals)가 아직 없습니다. supabase-schema.sql 9번 블록을 Supabase SQL Editor 에서 한 번 실행하면 켜집니다.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-[var(--c-text-3)] mb-1">소개받음</div>
                {refs.receivedFrom ? (
                  <div className="space-y-2">
                    <div className="text-[var(--c-text-1)]">소개한 분: <Link href={`/crm/${refs.receivedFrom.referrer_id}`} className="font-semibold underline-offset-2 hover:underline">{refs.receivedFrom.referrer?.name || '-'}</Link> <span className="text-[var(--c-text-3)] text-xs">{formatDate(refs.receivedFrom.created_at)}</span></div>
                    <div className="text-[11px] text-[var(--c-text-4)]">혜택 조건: {MEMBERSHIP.referredCondition}</div>
                    {refs.receivedFrom.referred_reward_used_at ? (
                      <div className="text-ok text-xs font-semibold">✓ 혜택 적용 {formatDate(refs.receivedFrom.referred_reward_used_at)} · {refs.receivedFrom.referred_reward}</div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {MEMBERSHIP.referredRewardOptions.map((opt) => (
                          <button key={opt} onClick={async () => { if (!confirm(`"${opt}" 혜택을 오늘 적용한 것으로 기록할까요?`)) return; const e = await updateReferral(refs.receivedFrom!.id, { referred_reward: opt, referred_reward_used_at: todaySeoul() }); if (e) alert(e); else fetchData(); }} className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-[var(--c-border)] hover:bg-[var(--c-subtle)] text-[var(--c-text-1)]">{opt.split('(')[0].trim()} 적용</button>
                        ))}
                      </div>
                    )}
                    <button onClick={async () => { if (confirm('소개 연결을 지울까요?')) { await unlinkReferral(refs.receivedFrom!.id); fetchData(); } }} className="text-[11px] text-[var(--c-text-4)] hover:text-danger">연결 지우기</button>
                  </div>
                ) : (
                  <div className="text-[var(--c-text-3)]">- <span className="text-[11px] text-[var(--c-text-4)]">(✎ 수정에서 유입경로를 소개/재방문으로 두고 소개한 분을 고르면 연결됩니다)</span></div>
                )}
              </div>
              <div>
                <div className="text-xs text-[var(--c-text-3)] mb-1">이분이 소개한 손님 {refs.gave.length > 0 && <b className="text-[var(--c-text-1)]">{refs.gave.length}명</b>}</div>
                {refs.gave.length === 0 ? <div className="text-[var(--c-text-3)]">-</div> : (
                  <ul className="space-y-2">
                    {refs.gave.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-2">
                        <Link href={`/crm/${r.referred_id}`} className="font-semibold text-[var(--c-text-1)] hover:underline">{r.referred?.name || '-'}</Link>
                        <span className="text-xs text-[var(--c-text-3)]">{formatDate(r.created_at)}</span>
                        {r.thanks_sms_sent_at ? <span className="text-[11px] text-ok">✓ 감사 문자</span> : customer.phone ? <button onClick={() => { openSms(customer.phone!, MEMBERSHIP.thanksSms(customer.name, r.referred?.name || '고객')); markThanksSent(r.referred_id).then(fetchData); }} className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-[var(--c-border)] hover:bg-[var(--c-subtle)]">감사 문자</button> : null}
                        {r.referrer_reward_used_at ? <span className="text-[11px] text-ok">✓ 혜택 적용 {formatDate(r.referrer_reward_used_at)}</span> : <button onClick={async () => { if (!confirm(`소개 혜택(${MEMBERSHIP.referrerReward})을 오늘 적용한 것으로 기록할까요?`)) return; const e = await updateReferral(r.id, { referrer_reward: MEMBERSHIP.referrerReward, referrer_reward_used_at: todaySeoul() }); if (e) alert(e); else fetchData(); }} className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-[var(--c-border)] hover:bg-[var(--c-subtle)]">혜택 적용</button>}
                        {!pts.tableMissing && (pts.rows.some((p) => p.referral_id === r.id)
                          ? <span className="text-[11px] text-ok">✓ 1점 적립</span>
                          : <button onClick={async () => { if (!confirm(`${r.referred?.name || '고객'} 님 소개 건으로 1포인트를 적립할까요? (시공을 마쳤을 때만)`)) return; const e = await grantPointForReferral(r); if (e) alert(e); else fetchData(); }} className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-[var(--c-border)] hover:bg-[var(--c-subtle)]">+1점 적립</button>)}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="text-[11px] text-[var(--c-text-4)] mt-2">소개한 분 혜택: {MEMBERSHIP.referrerReward} · 소개 1건마다 1포인트</div>
              </div>
            </div>
          )}
          {/* 소개 포인트 (2026-11-19 사장님 결정): 소개 1건 = 1점, 쓰는 항목은 전부 공임 서비스(필름값만) */}
          {!refs.tableMissing && (
            <div className="mt-4 pt-4 border-t border-[var(--c-border)]">
              {pts.tableMissing ? (
                <div className="text-xs text-warn">소개 포인트 표(referral_points)가 아직 없습니다. docs/소개포인트-referral_points-표-만들기.sql 을 Supabase SQL Editor 에서 한 번 실행하면 켜집니다.</div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs text-[var(--c-text-3)]">소개 포인트</span>
                      <span className="text-xl font-extrabold text-[var(--c-text-1)] tabular-nums">{pts.balance}<span className="text-sm font-semibold ml-0.5">점</span></span>
                      {pts.expired && <span className="text-[11px] text-warn">기한 지남</span>}
                      {!pts.expired && pts.expiresAt && <span className="text-[11px] text-[var(--c-text-4)]">{formatDate(pts.expiresAt)}까지</span>}
                    </div>
                    <button onClick={() => setPtsOpen((v) => !v)} className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-[var(--c-border)] hover:bg-[var(--c-subtle)] text-[var(--c-text-1)]">{ptsOpen ? '접기' : `사용·내역 ${pts.rows.length > 0 ? `(${pts.rows.length})` : ''}`}</button>
                  </div>
                  {ptsOpen && (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-xs text-[var(--c-text-3)] mb-1.5">쓸 수 있는 항목 (전부 공임 서비스, 필름값만)</div>
                        <ul className="space-y-1.5">
                          {POINTS.menu.map((m) => {
                            const ok = pts.balance >= m.cost;
                            return (
                              <li key={m.cost} className="flex items-start gap-2">
                                <button disabled={!ok} onClick={async () => { if (!confirm(`"${m.label}" 에 ${m.cost}점을 오늘 사용한 것으로 기록할까요?\n(지금 ${pts.balance}점 → ${pts.balance - m.cost}점)`)) return; const e = await usePoints(customer.id, m.cost, m.label); if (e) alert(e); else fetchData(); }} className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${ok ? 'border-[var(--c-text-1)] text-[var(--c-text-1)] hover:bg-[var(--c-subtle)]' : 'border-[var(--c-border)] text-[var(--c-text-4)] cursor-not-allowed'}`}>{m.cost}점 사용</button>
                                <div><div className="text-[var(--c-text-1)]">{m.label}</div><div className="text-[11px] text-[var(--c-text-4)]">{m.detail}</div></div>
                              </li>
                            );
                          })}
                        </ul>
                        <div className="text-[11px] text-[var(--c-text-4)] mt-2">{POINTS.conditions.join(' · ')}</div>
                      </div>
                      <div>
                        <div className="text-xs text-[var(--c-text-3)] mb-1.5">내역</div>
                        {pts.rows.length === 0 ? <div className="text-[var(--c-text-3)]">아직 없습니다. 소개받은 분이 시공을 마치면 자동으로 1점 쌓입니다.</div> : (
                          <ul className="space-y-1">
                            {pts.rows.map((p) => (
                              <li key={p.id} className="flex items-center gap-2 text-xs">
                                <span className={`font-bold tabular-nums w-8 ${p.delta > 0 ? 'text-ok' : 'text-[var(--c-text-1)]'}`}>{p.delta > 0 ? `+${p.delta}` : p.delta}</span>
                                <span className="text-[var(--c-text-3)] w-20 shrink-0">{formatDate(p.created_at)}</span>
                                <span className="text-[var(--c-text-1)] flex-1">{p.reason}</span>
                                <button onClick={async () => { if (confirm('이 줄을 지울까요? (잘못 누른 적립·사용 취소)')) { await deletePointRow(p.id); fetchData(); } }} className="text-[var(--c-text-4)] hover:text-danger">✕</button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Detail Tabs */}
        <div className="border-b border-[var(--c-border)] flex gap-0 mb-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === tab.key ? 'text-gold' : 'text-[var(--c-text-3)] hover:text-[var(--c-text-2)]'
              }`}
            >
              {tab.label} <span className="text-xs ml-1 opacity-60">{tab.count}</span>
              {activeTab === tab.key && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gold" />}
            </button>
          ))}
        </div>

        {/* Services Tab */}
        {activeTab === 'services' && (
          <div className="space-y-2">
            {services.map((s) => (
              <div key={s.id} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4 group">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--c-text-1)]">{s.service_type}</span>
                    {vehicles.length > 1 && s.vehicle_id && <span className="text-xs text-[var(--c-text-3)]">{vehicleLabel(vehicles.find((v) => v.id === s.vehicle_id))}</span>}
                    {s.amount != null && s.amount > 0 && <span className="text-xs text-gold">{s.amount.toLocaleString()}원</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--c-text-3)]">{formatDate(s.service_date)}{s.completion_date && ` → ${formatDate(s.completion_date)}`}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      <button onClick={() => handleEditService(s)} className="w-6 h-6 rounded flex items-center justify-center text-[var(--c-text-3)] hover:text-gold hover:bg-gold/10 transition-all text-xs" title="수정">✎</button>
                      <button onClick={() => handleDeleteService(s.id)} className="w-6 h-6 rounded flex items-center justify-center text-[var(--c-text-3)] hover:text-danger hover:bg-danger/10 transition-all text-xs" title="삭제">✕</button>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-[var(--c-text-3)]">
                  {s.film_used && <span>필름: {s.film_used}</span>}
                  {s.service_area && <span>부위: {s.service_area}</span>}
                  {s.memo && (() => {
                    try {
                      const wo = JSON.parse(s.memo);
                      if (wo && typeof wo === 'object' && 'car_number' in wo) {
                        const items: string[] = [];
                        if (wo.car_number) items.push(`차량번호: ${wo.car_number}`);
                        const allChecked: string[] = [];
                        if (wo.tinting) {
                          for (const [k, v] of Object.entries(wo.tinting) as [string, { selected?: string[]; density?: string }][]) {
                            if (v?.selected?.length) allChecked.push(`${k}(${v.selected.join(',')}${v.density ? ' ' + v.density : ''})`);
                          }
                        }
                        for (const key of ['ppf', 'wrapping', 'coating', 'electrical', 'polish', 'package_options'] as const) {
                          const arr = wo[key];
                          if (Array.isArray(arr) && arr.length) allChecked.push(...arr);
                        }
                        if (wo.electrical_etc) allChecked.push(wo.electrical_etc);
                        if (wo.polish_etc) allChecked.push(wo.polish_etc);
                        if (wo.ppf_etc) allChecked.push(wo.ppf_etc);
                        if (wo.wrapping_etc) allChecked.push(wo.wrapping_etc);
                        if (allChecked.length) items.push(`시공: ${allChecked.join(', ')}`);
                        if (wo.notes) items.push(`특이사항: ${wo.notes}`);
                        return <span>{items.join(' | ')}</span>;
                      }
                    } catch { /* not JSON */ }
                    return <span>메모: {s.memo}</span>;
                  })()}
                </div>
              </div>
            ))}
            {services.length === 0 && <Empty text="시공 이력이 없습니다" />}
          </div>
        )}

        {/* Consultations Tab */}
        {activeTab === 'consultations' && (
          <div className="space-y-2">
            {consultations.map((c) => (
              <div key={c.id} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[var(--c-text-3)]">{formatDate(c.consultation_date)}</span>
                  {c.estimate && <span className="text-xs text-gold">견적: {c.estimate}</span>}
                </div>
                {c.content && <p className="text-sm text-[var(--c-text-2)] mb-2">{c.content}</p>}
                <div className="flex gap-3 text-xs text-[var(--c-text-3)]">
                  {c.interested_services && <span>관심 시공: {c.interested_services}</span>}
                  {c.memo && <span>메모: {c.memo.replace(/\s*\[ref:[0-9a-f-]{36}\]/g, '')}</span>}
                </div>
              </div>
            ))}
            {consultations.length === 0 && <Empty text="상담 기록이 없습니다" />}
          </div>
        )}

        {/* Follow-ups Tab */}
        {activeTab === 'followups' && (
          <div className="space-y-2">
            {followUps.map((f) => {
              const today = todaySeoul();
              const isOverdue = !f.is_completed && f.scheduled_date < today;
              return (
                <div key={f.id} className={`bg-[var(--c-card)] border rounded-xl p-4 ${
                  isOverdue ? 'border-danger/30' : 'border-[var(--c-border)]'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        f.follow_up_type === 'QC점검'
                          ? 'bg-info/20 text-info'
                          : 'bg-violet/20 text-violet'
                      }`}>{f.follow_up_type}</span>
                      <span className="text-xs text-[var(--c-text-3)]">{f.service?.service_type || ''}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--c-text-3)]">{formatDate(f.scheduled_date)}</span>
                      {f.is_completed
                        ? <span className="text-xs text-ok">완료</span>
                        : isOverdue
                          ? <span className="text-xs text-danger">지남</span>
                          : <span className="text-xs text-gold">예정</span>
                      }
                    </div>
                  </div>
                  {f.memo && <p className="text-xs text-[var(--c-text-3)] mt-1">{f.memo}</p>}
                </div>
              );
            })}
            {followUps.length === 0 && <Empty text="사후관리 내역이 없습니다" />}
          </div>
        )}

        {activeTab === 'discounts' && (
          <div>
            {/* 할인 기록 추가 폼 */}
            <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4 mb-4">
              <h4 className="text-xs text-gold font-semibold mb-3">할인 기록 추가</h4>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <input type="date" value={discountForm.discount_date} onChange={(e) => setDiscountForm({ ...discountForm, discount_date: e.target.value })} className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" />
                <select value={discountForm.discount_type} onChange={(e) => setDiscountForm({ ...discountForm, discount_type: e.target.value })} className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50">
                  {['재방문', '프로모션', '소개 할인', '시즌 할인', '기타'].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input type="text" value={discountForm.discount_value} onChange={(e) => setDiscountForm({ ...discountForm, discount_value: e.target.value })} className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="10% 또는 50,000원" />
                <button
                  onClick={async () => {
                    if (!discountForm.discount_date) { alert('날짜를 입력해주세요.'); return; }
                    await fetch('/api/discounts', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ customer_id: id, ...discountForm }),
                    });
                    setDiscountForm({ discount_date: '', discount_type: '재방문', discount_value: '', memo: '' });
                    fetchData();
                  }}
                  className="bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors"
                >추가</button>
              </div>
              <input type="text" value={discountForm.memo} onChange={(e) => setDiscountForm({ ...discountForm, memo: e.target.value })} className="w-full mt-2 bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="메모 (선택)" />
            </div>
            {/* 할인 이력 목록 */}
            <div className="space-y-2">
              {discounts.map((d) => (
                <div key={d.id} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-gold/20 text-gold px-2 py-0.5 rounded">{d.discount_type}</span>
                      {d.discount_value && <span className="text-sm font-medium text-[var(--c-text-1)]">{d.discount_value}</span>}
                    </div>
                    <div className="text-xs text-[var(--c-text-3)] mt-1">
                      {formatDate(d.discount_date)}
                      {d.memo && <span className="ml-2">· {d.memo}</span>}
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm('이 할인 기록을 삭제하시겠습니까?')) return;
                      await fetch(`/api/discounts?id=${d.id}`, { method: 'DELETE' });
                      fetchData();
                    }}
                    className="text-xs text-[var(--c-text-3)] hover:text-danger transition-colors"
                  >삭제</button>
                </div>
              ))}
              {discounts.length === 0 && <Empty text="할인 이력이 없습니다" />}
            </div>
          </div>
        )}
      </div>

      {/* Service Edit Modal */}
      {editService && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={() => setEditService(null)}>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--c-text-1)] font-semibold text-base mb-4">시공 이력 수정</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">시공 종류</label>
                <select value={serviceForm.service_type} onChange={(e) => setServiceForm({ ...serviceForm, service_type: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50">
                  <option value="">선택...</option>
                  {SERVICE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--c-text-3)] mb-1 block">시공일</label>
                  <input type="date" value={serviceForm.service_date} onChange={(e) => setServiceForm({ ...serviceForm, service_date: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-text-3)] mb-1 block">완료일</label>
                  <input type="date" value={serviceForm.completion_date} onChange={(e) => setServiceForm({ ...serviceForm, completion_date: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">금액</label>
                <input type="number" value={serviceForm.amount} onChange={(e) => setServiceForm({ ...serviceForm, amount: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="0" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">메모</label>
                <textarea value={serviceForm.memo} onChange={(e) => setServiceForm({ ...serviceForm, memo: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50 resize-none h-20" placeholder="특이사항" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditService(null)} className="px-4 py-2 text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-2)] transition-colors">취소</button>
              <button onClick={handleUpdateService} className="bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--c-text-3)] mb-0.5">{label}</div>
      <div className="text-sm text-[var(--c-text-1)]">{value}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-center py-12 text-sm text-[var(--c-text-3)]">{text}</div>;
}
