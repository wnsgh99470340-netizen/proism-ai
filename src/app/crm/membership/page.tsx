'use client';

import { openSmsApp } from '@/lib/crm-shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import Btn from '@/components/ui/Btn';
import { memberMissing } from '@/lib/member-ready';
import { todaySeoul } from '@/lib/local-date';
import { MEMBERSHIP } from '@/config/membership';
import { markThanksSent, updateReferral, type Referral } from '@/lib/referrals';

/**
 * 회원 한눈에 보기 (2026-11-18 사장님 "멤버십 한눈에 보이게, 페이지 하나 따로")
 * - 회원 = 시공 완료 기록(services)이 있는 고객. 가입일 = 첫 시공일
 * - 위: 숫자 타일(회원·이달 가입·소개 건수·소개 성사·처리할 일) + 혜택 규칙
 * - 가운데: 소개 현황 표(소개한 분 → 소개받은 분, 시공 상태, 양쪽 혜택, 감사 문자) — 여기서 바로 처리
 * - 아래: 소개 많이 한 회원, 회원 목록(검색)
 * 등급제는 기준이 정해지면 이 페이지에 배지로 붙인다
 */
interface Cust { id: string; name: string; phone: string | null; car_brand: string | null; car_model: string | null; source: string | null; created_at: string }
interface Svc { customer_id: string; service_type: string; service_date: string | null; completion_date: string | null; amount: number | null }
interface Appt { customer_id: string; appointment_date: string; status: string; service_type: string | null }

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '-');
const card = 'bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl';
const pill = 'text-[11px] font-medium px-2.5 py-1 rounded-full border border-[var(--c-border)] hover:bg-[var(--c-subtle)] text-[var(--c-text-1)] whitespace-nowrap';

export default function MembershipPage() {
  const [customers, setCustomers] = useState<Cust[]>([]);
  const [services, setServices] = useState<Svc[]>([]);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [tableMissing, setTableMissing] = useState(false);
  // 회원 페이지 링크 보낸 분 (2026-11-19 사장님: 62명 중 3명만 링크가 있어 "안 보낸 분" 필터 + 줄마다 문자). 보냄 = 상담 기록 "[회원 문자] 회원 페이지 링크", 열어 봄 = member_links.visits
  const [linkSent, setLinkSent] = useState<Map<string, string>>(new Map());
  const [linkVisits, setLinkVisits] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: c }, { data: s }, { data: a }, { data: r, error: re }] = await Promise.all([
      supabase.from('customers').select('id, name, phone, car_brand, car_model, source, created_at').neq('kind', '딜러').order('name'), // 딜러는 회원 아님 (2026-11-23)
      supabase.from('services').select('customer_id, service_type, service_date, completion_date, amount'),
      supabase.from('appointments').select('customer_id, appointment_date, status, service_type').neq('status', '취소'),
      supabase.from('referrals').select('*, referrer:customers!referrals_referrer_id_fkey(name, phone), referred:customers!referrals_referred_id_fkey(name, phone)').order('created_at', { ascending: false }),
    ]);
    setCustomers((c || []) as Cust[]); setServices((s || []) as Svc[]); setAppts((a || []) as Appt[]);
    const [{ data: sent }, { data: links }] = await Promise.all([
      supabase.from('consultations').select('customer_id, consultation_date').eq('memo', '회원 문자').like('content', '[회원 문자] 회원 페이지 링크%').order('consultation_date', { ascending: false }),
      supabase.from('member_links').select('customer_id, visits'),
    ]);
    const sm = new Map<string, string>(); for (const x of sent || []) if (x.customer_id && !sm.has(x.customer_id)) sm.set(x.customer_id, x.consultation_date); setLinkSent(sm);
    setLinkVisits(new Map((links || []).map((l) => [l.customer_id as string, (l.visits as number | null) || 0])));
    if (re) setTableMissing(true); else setReferrals((r || []) as Referral[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const byCust = useMemo(() => {
    const svc = new Map<string, Svc[]>();
    for (const s of services) { if (!svc.has(s.customer_id)) svc.set(s.customer_id, []); svc.get(s.customer_id)!.push(s); }
    const gave = new Map<string, number>();
    for (const r of referrals) if (r.referrer_id) gave.set(r.referrer_id, (gave.get(r.referrer_id) || 0) + 1);
    const nextAppt = new Map<string, Appt>();
    for (const a of [...appts].sort((x, y) => y.appointment_date.localeCompare(x.appointment_date))) if (!nextAppt.has(a.customer_id)) nextAppt.set(a.customer_id, a);
    return { svc, gave, nextAppt };
  }, [services, referrals, appts]);

  const joinedAt = (id: string) => { const list = byCust.svc.get(id) || []; const dates = list.map((s) => s.service_date || s.completion_date || '').filter(Boolean).sort(); return dates[0] || null; };
  // 회원 = 시공 기록 + 성함·전화·차종이 다 있는 분 (2026-11-23 사장님 "다 갖춘 64명만"). 빠진 분은 '조건 미충족'으로 따로 보여 주고 회원 수·링크 대상에서 뺀다
  const missingOf = useCallback((c: Cust) => memberMissing({ name: c.name, phone: c.phone, car: [c.car_brand, c.car_model].filter(Boolean).join(' '), workCount: (byCust.svc.get(c.id) || []).length }), [byCust]);
  const members = useMemo(() => customers.filter((c) => (byCust.svc.get(c.id) || []).length > 0 && missingOf(c).length === 0), [customers, byCust, missingOf]);
  const incomplete = useMemo(() => customers.filter((c) => (byCust.svc.get(c.id) || []).length > 0 && missingOf(c).length > 0).map((c) => ({ c, miss: missingOf(c) })), [customers, byCust, missingOf]);
  const today = todaySeoul();
  const thisMonth = today.slice(0, 7);
  const joinedThisMonth = members.filter((c) => (joinedAt(c.id) || '').startsWith(thisMonth)).length;
  /** 소개받은 분 상태: 완료(시공 기록 있음) / 예약 / 아직 */
  const referredState = (r: Referral) => {
    if ((byCust.svc.get(r.referred_id) || []).length > 0) return '완료' as const;
    const a = byCust.nextAppt.get(r.referred_id);
    if (a) return (a.status === '완료' ? '완료' : '예약') as '완료' | '예약';
    return '아직' as const;
  };
  const succeeded = referrals.filter((r) => referredState(r) === '완료');
  const todo = {
    referredReward: succeeded.filter((r) => !r.referred_reward_used_at).length,
    referrerReward: succeeded.filter((r) => r.referrer_id && !r.referrer_reward_used_at).length,
    thanks: referrals.filter((r) => r.referrer_id && !r.thanks_sms_sent_at && r.referrer?.phone).length,
  };
  const topReferrers = [...byCust.gave.entries()].map(([id, n]) => ({ c: customers.find((x) => x.id === id), n })).filter((x) => x.c).sort((a, b) => b.n - a.n).slice(0, 5);

  const sms = (phone: string, msg: string) => openSmsApp(phone, msg);

  // 보낸 것으로 치는 기준: 상담 기록에 링크 문자가 있거나, 손님이 한 번이라도 열어 봤으면(기록 없이 보낸 경우)
  const linkDelivered = (id: string) => linkSent.has(id) || (linkVisits.get(id) || 0) > 0;
  const unsentMembers = members.filter((c) => !linkDelivered(c.id));

  return (
    <div className="h-dvh flex flex-col bg-[var(--c-page)]">
      <div className="h-14 border-b border-[var(--c-border)] bg-[var(--c-card)] flex items-center px-4 justify-between shrink-0 pt-[env(safe-area-inset-top)] box-content">
        <div className="flex items-center gap-3">
          <Link href="/crm" className="text-[var(--c-text-3)] hover:text-[var(--c-text-1)] transition-colors text-sm">← CRM</Link>
          <span className="text-[var(--c-border)]">|</span>
          <span className="text-[var(--c-text-1)] font-semibold text-sm">{MEMBERSHIP.name} · 소개 현황</span>
        </div>
        <Btn size="sm" variant="ghost" icon="refresh" onClick={load}>새로고침</Btn>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 max-w-[1360px] w-full mx-auto">
        {loading ? <div className="py-20 text-center text-sm text-[var(--c-text-3)]">불러오는 중…</div> : (
          <>
            {/* 숫자 타일 */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 mb-5">
              {[
                { k: '회원', v: members.length, sub: `전체 고객 ${customers.length}명 중${incomplete.length ? ` · 조건 미충족 ${incomplete.length}` : ''}` },
                { k: '이달 가입', v: joinedThisMonth, sub: `${Number(thisMonth.slice(5))}월 첫 시공` },
                { k: '소개 연결', v: referrals.length, sub: `성사 ${succeeded.length}건` },
                { k: '혜택 줄 차례', v: todo.referredReward + todo.referrerReward, sub: `소개받은 분 ${todo.referredReward} · 소개한 분 ${todo.referrerReward}` },
                { k: '감사 문자 전', v: todo.thanks, sub: '소개한 분께' },
                { k: '회원 링크 안 보낸 분', v: unsentMembers.length, sub: `보낸 분 ${members.length - unsentMembers.length}명 · 열어 본 분 ${[...linkVisits.values()].filter((n) => n > 0).length}명`, href: '/crm?tab=customers' },
              ].map((t) => {
                const href = 'href' in t ? String(t.href) : null;
                return (
                <div key={t.k} onClick={href ? () => { window.location.href = href; } : undefined} className={`${card} px-4 py-3 ${href ? 'cursor-pointer hover:bg-[var(--c-subtle)]' : ''}`}>
                  <div className="text-[11px] text-[var(--c-text-3)]">{t.k}</div>
                  <div className="text-2xl font-bold text-[var(--c-text-1)] tabular-nums leading-tight mt-0.5">{t.v}</div>
                  <div className="text-[11px] text-[var(--c-text-4)] truncate mt-0.5">{t.sub}</div>
                </div>
                );
              })}
            </div>

            {/* 규칙 */}
            <div className={`${card} p-4 md:p-5 mb-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm`}>
              <div><div className="text-xs font-semibold text-[var(--c-text-3)] mb-1.5">회원 공통</div>{MEMBERSHIP.common.map((c) => <div key={c} className="text-[var(--c-text-1)]">· {c}</div>)}</div>
              <div><div className="text-xs font-semibold text-[var(--c-text-3)] mb-1.5">소개한 분</div><div className="text-[var(--c-text-1)]">{MEMBERSHIP.referrerReward}</div></div>
              <div><div className="text-xs font-semibold text-[var(--c-text-3)] mb-1.5">소개받고 연락한 분 <span className="font-normal text-[var(--c-text-4)]">({MEMBERSHIP.referredCondition})</span></div>{MEMBERSHIP.referredRewardOptions.map((o) => <div key={o} className="text-[var(--c-text-1)]">· {o}</div>)}</div>
            </div>

            {/* 소개 현황 */}
            <section className={`${card} p-4 md:p-5 mb-5`}>
              <h2 className="text-base font-bold text-[var(--c-text-1)] mb-3">소개 현황 <span className="text-sm font-medium text-[var(--c-text-3)]">{referrals.length}건</span></h2>
              {tableMissing ? <div className="text-xs text-warn">소개 기록 표(referrals)가 아직 없습니다.</div> : referrals.length === 0 ? (
                <div className="py-8 text-center text-sm text-[var(--c-text-3)]">아직 소개 연결이 없습니다. 소개로 온 손님을 등록할 때 유입경로를 소개/재방문으로 두고 소개한 분을 고르면 여기에 쌓입니다.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead><tr className="text-[11px] text-[var(--c-text-3)] text-left"><th className="py-1.5 pr-3 font-medium">소개한 분</th><th className="py-1.5 pr-3 font-medium">소개받은 분</th><th className="py-1.5 pr-3 font-medium">연결일</th><th className="py-1.5 pr-3 font-medium">시공</th><th className="py-1.5 pr-3 font-medium">소개받은 분 혜택</th><th className="py-1.5 pr-3 font-medium">소개한 분 혜택</th><th className="py-1.5 font-medium">감사 문자</th></tr></thead>
                    <tbody>
                      {referrals.map((r) => {
                        const st = referredState(r);
                        return (
                          <tr key={r.id} className="border-t border-[var(--c-border)] align-middle">
                            <td className="py-2 pr-3">{r.referrer_id ? <Link href={`/crm/${r.referrer_id}`} className="font-semibold text-[var(--c-text-1)] hover:underline">{r.referrer?.name || '-'}</Link> : <span className="text-[var(--c-text-4)]">(삭제됨)</span>}</td>
                            <td className="py-2 pr-3"><Link href={`/crm/${r.referred_id}`} className="font-semibold text-[var(--c-text-1)] hover:underline">{r.referred?.name || '-'}</Link></td>
                            <td className="py-2 pr-3 text-[var(--c-text-3)]">{fmt(r.created_at)}</td>
                            <td className="py-2 pr-3"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${st === '완료' ? 'bg-ok/10 text-ok' : st === '예약' ? 'bg-info/10 text-info' : 'bg-[var(--c-subtle)] text-[var(--c-text-3)]'}`}>{st}</span></td>
                            <td className="py-2 pr-3">
                              {r.referred_reward_used_at ? <span className="text-ok text-xs">✓ {fmt(r.referred_reward_used_at)} · {(r.referred_reward || '').split('(')[0].trim()}</span>
                                : st === '완료' ? <div className="flex gap-1">{MEMBERSHIP.referredRewardOptions.map((opt) => <button key={opt} className={pill} onClick={async () => { if (!confirm(`${r.referred?.name} 님께 "${opt}" 을 오늘 적용한 것으로 기록할까요?`)) return; const e = await updateReferral(r.id, { referred_reward: opt, referred_reward_used_at: todaySeoul() }); if (e) alert(e); else load(); }}>{opt.split('(')[0].trim()}</button>)}</div>
                                : <span className="text-[11px] text-[var(--c-text-4)]">시공 완료 뒤</span>}
                            </td>
                            <td className="py-2 pr-3">
                              {!r.referrer_id ? '-' : r.referrer_reward_used_at ? <span className="text-ok text-xs">✓ {fmt(r.referrer_reward_used_at)}</span>
                                : st === '완료' ? <button className={pill} onClick={async () => { if (!confirm(`${r.referrer?.name} 님께 소개 혜택(${MEMBERSHIP.referrerReward})을 오늘 적용한 것으로 기록할까요?`)) return; const e = await updateReferral(r.id, { referrer_reward: MEMBERSHIP.referrerReward, referrer_reward_used_at: todaySeoul() }); if (e) alert(e); else load(); }}>혜택 적용</button>
                                : <span className="text-[11px] text-[var(--c-text-4)]">성사 뒤</span>}
                            </td>
                            <td className="py-2">
                              {!r.referrer_id ? '-' : r.thanks_sms_sent_at ? <span className="text-ok text-xs">✓ 보냄</span>
                                : r.referrer?.phone ? <button className={pill} onClick={() => { sms(r.referrer!.phone!, MEMBERSHIP.thanksSms(r.referrer!.name, r.referred?.name || '고객')); markThanksSent(r.referred_id).then(load); }}>감사 문자</button>
                                : <span className="text-[11px] text-[var(--c-text-4)]">전화 없음</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
              {/* 소개 많이 한 회원 */}
              <section className={`${card} p-4 md:p-5 h-fit`}>
                <h2 className="text-base font-bold text-[var(--c-text-1)] mb-3">소개 많이 한 회원</h2>
                {topReferrers.length === 0 ? <div className="text-sm text-[var(--c-text-3)]">아직 없습니다</div> : (
                  <ol className="space-y-2">
                    {topReferrers.map(({ c, n }, i) => (
                      <li key={c!.id} className="flex items-center justify-between text-sm">
                        <span><span className="text-[var(--c-text-4)] mr-2">{i + 1}</span><Link href={`/crm/${c!.id}`} className="font-semibold text-[var(--c-text-1)] hover:underline">{c!.name}</Link> <span className="text-[var(--c-text-3)] text-xs">{c!.car_model || ''}</span></span>
                        <span className="font-bold text-[var(--c-text-1)] tabular-nums">{n}건</span>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="text-[11px] text-[var(--c-text-4)] mt-3">등급 기준이 정해지면 여기에 등급 배지가 붙습니다.</div>
              </section>

              {/* 회원 목록은 고객 목록 탭의 '회원' 필터로 옮김 (2026-11-26) */}
              <section className={`${card} p-4 md:p-5`}>
                <h2 className="text-base font-bold text-[var(--c-text-1)] mb-2">회원 목록</h2>
                <p className="text-sm text-[var(--c-text-3)]">회원 {members.length}명의 목록·회원 페이지 상태·문자는 <Link href="/crm?tab=customers" className="underline text-[var(--c-text-1)]">고객 목록</Link>의 &lsquo;회원&rsquo; 필터에서 봅니다.{incomplete.length ? ` 조건 미충족 ${incomplete.length}명은 그 목록에 배지로 표시됩니다.` : ''}</p>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
