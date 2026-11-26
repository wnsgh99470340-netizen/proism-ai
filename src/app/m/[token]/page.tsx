'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { LINKS } from '@/config/links';
import { LIFT_PROMISE_LINE, liftPromiseApplies, reviewLinkFor } from '@/config/sms-templates';

/**
 * 손님용 회원 페이지 (2026-11-18 사장님: "사진 한 장이 아니라 앱처럼 눌러 보며 구경")
 * - /m/<개인코드>. 전화 뒷자리 4개로 확인(sessionStorage 에 기억) → 시공 증명서·관리 일정·혜택·소개·기록
 * - 2026-11-18 사장님 "보증서를 보고 '제대로 시공 받았구나' 느꼈으면, 더 세련되게" → 맨 위를 회원 카드 대신 시공 증명서로.
 *   작업 내역서(PPF·썬팅·코팅 항목)를 줄로 보여 주고, 증명 번호·시공 기간·3M 프리퍼드 인스톨러 인장·시공 기준 3줄
 * - 공개 페이지라 명함 페이지처럼 어두운 톤 고정. 프리퍼드 인스톨러 인증서 이미지는 트랙(랩핑)이 적혀 있어 쓰지 않음
 */
interface Data {
  /** CRM 로그인 기기(사장님)가 열어 본 경우 — 뒷자리 없이 열리고 방문 수에 안 들어감 */
  owner?: boolean;
  customer: { name: string; car: string; color: string | null; memberSince: string | null; registered: string };
  membership: { name: string; common: string[]; referrerReward: string; referredRewardOptions: string[]; referredCondition: string };
  services: { id?: string; type: string; date: string | null; done: string | null; area: string | null; film: string | null; vehicle?: string | null }[];
  vehicles?: { id: string; label: string; year: string | null; color: string | null; plate: string | null; primary: boolean }[];
  care: { type: string; date: string; done: boolean; skipped?: boolean; visitDate?: string | null; doneAt: string | null; serviceId?: string | null; note?: string | null; photos?: string[] }[];
  upcoming: { date: string; end: string | null; service: string | null; status: string }[];
  careYears?: number | null;
  careGuide?: { guides: { key: string; title: string; after: string[]; daily: string[]; contact: string[] }[]; common: string };
  warranties: { date: string; end: string | null; work: string; period: string; url: string | null; items: { group: string; text: string; product?: string }[]; certNo: string; vehicle?: string | null; photos?: string[] }[];
  referrals: { gave: { name: string; date: string; state: string; reward: string | null; rewardAt: string | null }[]; received: { from: string; date: string; reward: string | null; rewardAt: string | null } | null };
  points: { balance: number; expiresAt: string | null; expired: boolean; history: { date: string; delta: number; reason: string }[]; unit: string; earnRule: string; menu: { cost: number; label: string; detail: string }[]; conditions: string[] };
  shop: { name: string; phone: string; address: string; card: string; map: string; talk: string };
}
const toDate = (d: string | null | undefined) => { if (!d) return null; const x = new Date(d); return Number.isNaN(x.getTime()) ? null : x; };
const fmt = (d: string | null | undefined) => { const x = toDate(d); return x ? x.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '-'; };
const daysUntil = (d: string | null | undefined) => { const x = toDate(d); if (!x) return null; const now = new Date(); now.setHours(0, 0, 0, 0); x.setHours(0, 0, 0, 0); return Math.round((x.getTime() - now.getTime()) / 86400000); };
const fmtDot = (d: string | null | undefined) => {
  const x = toDate(d);
  if (!x) return '-';
  return `${x.getFullYear()}.${String(x.getMonth() + 1).padStart(2, '0')}.${String(x.getDate()).padStart(2, '0')}`;
};
const box = 'rounded-2xl bg-white/[0.04] border border-white/10 p-4';
const btn = 'flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors';
const micro = 'text-[10px] tracking-[0.22em] uppercase text-white/40';
const careName = (t: string) => (t === 'QC점검' ? 'QC 점검' : t);
/** 방문이 잡히기 전의 예정일은 '연락드릴 때'다 — 손님이 방문일로 읽지 않게 "12월 초에 연락드립니다"로 (2026-11-22) */
const roughWhen = (d: string | null | undefined) => { const x = toDate(d); if (!x) return ''; const day = x.getDate(); return `${x.getMonth() + 1}월 ${day <= 10 ? '초' : day <= 20 ? '중순' : '말'}`; };

/** 시공 증명서 아래 "이 시공의 기준" — 확인된 사실만, 짧게 (differentiators.ts confirmed 항목 기준) */
function standardsFor(hasPpf: boolean) {
  // 2026-11-19 사장님: "안쪽 마감 진행" 같은 말보다 어떤 제품으로 시공했는지 → 제품은 증명서 항목 아래 줄로, 여기는 매장 약속만
  // 2026-11-26: PPF 계열 시공이 있으면 들뜸 1년 약속 한 줄 (sms-templates LIFT_PROMISE_LINE, 견적 문자와 같은 문장)
  return ['3M 공인 프리퍼드 인스톨러 매장에서 시공했습니다', 'PPF는 2주 뒤 QC 점검, 6개월마다 메인터넌스로 관리합니다', ...(hasPpf ? [LIFT_PROMISE_LINE] : []), '시공 기록과 보증서는 매장에서 보관합니다'];
}

function Seal() {
  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0">
      <div className="relative w-14 h-14 rounded-full border border-[#E4002B]/60 flex items-center justify-center">
        <div className="absolute inset-[3px] rounded-full border border-[#E4002B]/25" />
        <div className="w-9 h-9 rounded-full bg-[#E4002B] flex items-center justify-center font-black text-[13px] tracking-tight shadow-[0_0_24px_rgba(228,0,43,0.35)]">3M</div>
      </div>
      <div className="text-[8.5px] tracking-[0.18em] uppercase text-white/50 text-center leading-tight">Preferred<br />Installer</div>
    </div>
  );
}

export default function MemberPage() {
  const params = useParams();
  const token = params.token as string;
  const [pin, setPin] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [maskedName, setMaskedName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'cert' | 'care' | 'benefit' | 'referral' | 'history'>('cert');

  const load = useCallback(async (p: string) => {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/member/${token}`, { cache: 'no-store', headers: p ? { 'x-member-pin': p } : undefined });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || '불러오지 못했습니다'); if (res.status === 401) sessionStorage.removeItem(`m_pin_${token}`); return; }
      if (j.needPin) { setMaskedName(j.name || ''); return; }
      setData(j as Data);
      sessionStorage.setItem(`m_pin_${token}`, p);
    } catch { setErr('연결이 원활하지 않습니다. 잠시 뒤 다시 열어 주세요'); } finally { setBusy(false); }
  }, [token]);

  useEffect(() => { const saved = sessionStorage.getItem(`m_pin_${token}`) || ''; load(saved); }, [load, token]);

  // 매장 연락처 전달 (2026-11-19 사장님: 정해진 소개 문구를 보낼 일은 거의 없어 버튼을 빼고, 실제로 쓰는 전화·명함만 넘기게)
  const shareShop = () => {
    if (!data) return;
    const text = `3M 프로이즘 강남서초점 ${data.shop.phone}\n${data.shop.card}`;
    if (navigator.share) navigator.share({ title: '3M 프로이즘 강남서초점', text }).catch(() => {});
    else { navigator.clipboard?.writeText(text); alert('매장 연락처를 복사했습니다.'); }
  };

  if (!data) {
    return (
      <main className="h-dvh overflow-y-auto bg-[#0b0c0f] text-white flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-7">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#E4002B] font-black text-lg mb-4 shadow-[0_0_30px_rgba(228,0,43,0.3)]">3M</div>
            <div className={micro}>Preferred Installer</div>
            <div className="text-lg font-bold mt-1">3M 프로이즘 강남서초점</div>
            <div className="text-sm text-white/55 mt-1">{maskedName ? `${maskedName} 고객님의 3M 프로이즘 회원 페이지` : '3M 프로이즘 회원 페이지'}</div>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (pin.length === 4) load(pin); }} className={box}>
            <label className="text-xs text-white/60 block mb-2">본인 확인을 위해 전화번호 뒷자리 4개를 넣어 주세요</label>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="one-time-code" placeholder="0000" className="w-full text-center tracking-[0.5em] text-2xl font-bold bg-white/[0.07] border border-white/15 rounded-xl py-3 outline-none focus:border-[#E4002B]" />
            {err && <div className="text-xs text-[#ff6b81] mt-2">{err}</div>}
            <button type="submit" disabled={busy || pin.length !== 4} className={`${btn} w-full mt-3 bg-[#E4002B] hover:bg-[#c60026] disabled:opacity-40`}>{busy ? '확인 중…' : '들어가기'}</button>
          </form>
          <div className="text-[11px] text-white/35 text-center mt-4">이 주소는 고객님 개인용입니다. 다른 분께는 공유하지 말아 주세요.</div>
        </div>
      </main>
    );
  }

  const c = data.customer;
  const nextCare = data.care.find((f) => !f.done);
  const doneCare = data.care.filter((f) => f.done && !f.skipped); // 미방문은 받은 관리에 안 센다
  const nextDays = nextCare ? daysUntil(nextCare.visitDate || nextCare.date) : null;
  // 최근 것이 위로: 완료는 완료일, 예정은 예정일 기준
  const careSorted = [...data.care].sort((a, b) => ((b.done ? b.doneAt || b.date : b.date) || '').localeCompare((a.done ? a.doneAt || a.date : a.date) || ''));
  // 시공 건별로 묶기 (2026-11-19 사장님 "기존 작업과 새 작업은 같은 분이 맡겼어도 따로 분류"): 시공이 2건 이상일 때만 건마다 머리줄
  const careGroups = (() => {
    const svcs = [...data.services].sort((x, y) => (y.date || '').localeCompare(x.date || ''));
    const multiCar = (data.vehicles?.length || 0) > 1;
    const groups = svcs.map((sv) => ({ key: sv.id || '', title: `${fmtDot(sv.date)} ${sv.type}${multiCar && sv.vehicle ? ` · ${sv.vehicle}` : ''}${sv.area ? ` · ${sv.area}` : ''}`, rows: careSorted.filter((f) => f.serviceId && f.serviceId === sv.id) }));
    const rest = careSorted.filter((f) => !f.serviceId || !svcs.some((sv) => sv.id === f.serviceId));
    if (rest.length) groups.push({ key: 'rest', title: '그 외', rows: rest });
    return groups.filter((g) => g.rows.length > 0);
  })();
  const cert = data.warranties[0] || null; // 가장 최근 발급분이 맨 위 증명서
  const latestService = data.services[0] || null;
  const tabs = [['cert', '증명서'], ['care', '관리'], ['benefit', '회원 혜택'], ['referral', '소개'], ['history', '기록·보증']] as const;

  return (
    <main className="h-dvh overflow-y-auto overscroll-contain bg-[#0b0c0f] text-white">
      <div className="max-w-md mx-auto px-4 pt-5 pb-10 space-y-4">
        {data.owner && (
          <div className="-mx-4 -mt-5 mb-1 px-4 py-1.5 bg-[#E4002B]/15 border-b border-[#E4002B]/40 text-[11px] text-white/85 text-center">
            사장님 보기 · {c.name} 고객님이 보는 화면 그대로입니다 (방문 수에 넣지 않음)
          </div>
        )}
        {/* 상단 서명 */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#E4002B] flex items-center justify-center font-black text-[12px]">3M</div>
            <div>
              <div className="text-[13px] font-bold leading-tight">3M 프로이즘 강남서초점</div>
              <div className={micro}>Preferred Installer</div>
            </div>
          </div>
          <div className="text-right">
            <div className={micro}>Member since</div>
            <div className="text-xs font-semibold text-white/80 tabular-nums">{c.memberSince ? fmtDot(c.memberSince) : '첫 시공 뒤'}</div>
          </div>
        </div>

        {/* 회원 카드 — 증명서 위에 얇게. 2026-11-19 사장님 "어디에도 멤버십 이야기가 없어서 보증서인 줄 알 수 있다" → 이게 회원 페이지라는 걸 먼저 보여 준다. 숫자는 포인트 수와 가입일만 */}
        <section className="rounded-2xl border border-white/10 bg-gradient-to-r from-[#E4002B]/25 via-[#1a1b20] to-[#1a1b20] px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className={micro}>{data.membership.name}</div>
              <div className="text-base font-bold leading-tight mt-0.5 truncate">{c.name} 고객님</div>
              <div className="text-[11px] text-white/50 mt-0.5 truncate">{c.car || '차량 미등록'}{c.color ? ` · ${c.color}` : ''}</div>
            </div>
            <button onClick={() => setTab('referral')} className="shrink-0 text-right rounded-xl bg-white/[0.06] px-3 py-2 hover:bg-white/10">
              <div className={micro}>소개 포인트</div>
              <div className="text-lg font-black leading-tight tabular-nums">{data.points?.balance ?? 0}<span className="text-xs font-semibold text-white/60 ml-0.5">점</span></div>
            </button>
          </div>
          <div className="mt-2.5 pt-2.5 border-t border-white/10 text-[11px] text-white/55 leading-relaxed">
            시공하신 분은 회원으로 관리해 드립니다 · 2주 QC 점검 · 6개월 메인터넌스 · 리터치 우선 예약 · 지인 소개 혜택
          </div>
        </section>

        {/* 탭 — 상단 고정. 2026-11-19 사장님 "모바일에서 잘림 → 스크롤되게, 탭도 각각 보이게": 증명서도 탭 하나 */}
        <div className="sticky top-0 z-10 -mx-4 px-4 pt-1 pb-2 bg-[#0b0c0f]/90 backdrop-blur">
          <div className="grid grid-cols-5 gap-1 rounded-xl bg-white/[0.06] p-1">
            {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`rounded-lg py-2 text-xs font-semibold transition-colors ${tab === k ? 'bg-white text-black' : 'text-white/65 hover:text-white'}`}>{l}</button>)}
          </div>
        </div>

        {tab === 'cert' && (<>
        {/* 시공 증명서 */}
        <section className="relative rounded-[28px] p-[1px] bg-gradient-to-b from-white/20 via-white/5 to-white/10">
          <div className="relative rounded-[27px] bg-[radial-gradient(120%_80%_at_0%_0%,#23262d_0%,#121317_55%,#0e0f12_100%)] overflow-hidden">
            <div className="absolute inset-[10px] rounded-[20px] border border-white/[0.07] pointer-events-none" />
            <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full bg-[#E4002B]/10 blur-3xl pointer-events-none" />
            <div className="relative p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[9.5px] tracking-[0.2em] uppercase text-[#d8c7a1]/80 whitespace-nowrap">Certificate of Installation</div>
                  <div className="text-[11px] text-white/45 mt-0.5">시공 증명</div>
                </div>
                {cert && <div className="text-[10px] tracking-[0.1em] text-white/40 tabular-nums mt-0.5 whitespace-nowrap">No. {cert.certNo}</div>}
              </div>

              <div className="mt-6">
                <div className="text-[28px] leading-none font-bold tracking-tight">{c.name} <span className="text-[17px] font-medium text-white/60">고객님</span></div>
                <div className="text-sm text-white/65 mt-2.5">{(cert && cert.vehicle) || c.car || '차량 미등록'}{c.color ? <span className="text-white/40"> · {c.color}</span> : null}</div>
              </div>

              <div className="my-5 h-px bg-gradient-to-r from-white/20 via-white/10 to-transparent" />

              {cert ? (
                <>
                  <div className={micro}>시공 내역</div>
                  {cert.items.length > 0 ? (
                    <ul className="mt-2.5 space-y-2.5">
                      {cert.items.map((it, i) => (
                        <li key={i} className="flex gap-3 items-baseline">
                          <span className="shrink-0 w-11 text-[11px] font-semibold tracking-wide text-[#ff5c78]">{it.group}</span>
                          <span className="min-w-0"><span className="block text-[15px] font-medium leading-snug">{it.text}</span>{it.product && <span className="block text-[12px] text-white/55 mt-0.5 leading-snug break-keep">{it.product}</span>}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-2 text-[15px] font-medium">{cert.work || '시공'}</div>
                  )}
                  <div className="mt-5 flex items-end justify-between gap-4">
                    <div className="flex flex-col gap-3">
                      <div><div className={micro}>시공 기간</div><div className="text-sm font-semibold tabular-nums mt-1 whitespace-nowrap">{fmtDot(cert.date)}{cert.end && cert.end !== cert.date ? <span className="text-white/50"> – {fmtDot(cert.end).slice(5)}</span> : null}</div></div>
                      <div><div className={micro}>시공 매장</div><div className="text-sm font-semibold mt-1">3M 프로이즘 강남서초점</div></div>{/* 매장 보증 칸은 뺌 (2026-11-22 사장님). 보증은 3M 전자 보증서 안내만 */}
                    </div>
                    <Seal />
                  </div>
                </>
              ) : (
                <>
                  <div className={micro}>시공 기록</div>
                  {latestService ? (
                    <div className="mt-2 flex items-end justify-between gap-4">
                      <div>
                        <div className="text-[15px] font-medium">{latestService.type}{latestService.area ? <span className="text-white/50 text-sm"> · {latestService.area}</span> : null}</div>
                        <div className="text-sm text-white/55 tabular-nums mt-1">{fmtDot(latestService.date)}</div>
                      </div>
                      <Seal />
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-white/60">시공이 끝나면 증명서가 여기에 발급됩니다.</div>
                  )}
                </>
              )}
            </div>
            <div className="relative px-6 py-3 border-t border-white/[0.07] bg-black/20 flex items-center justify-between text-[11px] text-white/45">
              <span>발급 · {data.shop.name}</span>
              <span>대표 진준호</span>
            </div>
          </div>
        </section>

        {/* 이 시공의 기준 */}
        <ul className="px-2 space-y-1.5">
          {standardsFor(data.services.some((s) => liftPromiseApplies(s.type)) || data.warranties.some((w) => liftPromiseApplies(w.work))).map((t) => (
            <li key={t} className="flex gap-2.5 text-[12.5px] text-white/65 leading-snug break-keep"><span className="text-[#E4002B] mt-[1px]">—</span><span>{t}</span></li>
          ))}
        </ul>

        {/* 후기 남기기 (2026-11-26 사장님 "적용시켜": 회원 문자는 다 나갔는데 손님이 들어오는 페이지에 후기 입구가 없었음) */}
        {data.services.length > 0 && (
          <a href={reviewLinkFor(data.customer.car)} target="_blank" rel="noreferrer" className="block rounded-2xl border border-[#E4002B]/45 bg-[#E4002B]/10 hover:bg-[#E4002B]/20 transition-colors px-4 py-3 text-center">
            <div className="text-sm font-semibold">후기 남기기</div>
            <div className="text-[11px] text-white/55 mt-0.5">고객님의 한 줄이 저희에게 가장 큰 힘입니다</div>
          </a>
        )}

        {/* 다음 일정 요약 */}
        {(nextCare || data.upcoming.length > 0) && (
          <div className="grid grid-cols-1 gap-2">
            {nextCare && <div className="rounded-2xl bg-white/[0.04] border border-white/10 px-4 py-3 flex items-center justify-between"><div><div className={micro}>다음 관리</div><div className="text-sm font-semibold mt-0.5">{careName(nextCare.type)}</div></div><div className="text-right"><div className="text-sm text-white/75 tabular-nums">{nextCare.visitDate ? fmt(nextCare.visitDate) : roughWhen(nextCare.date)}</div><div className="text-[10px] text-white/40">{nextCare.visitDate ? '방문 예정' : '연락드립니다'}</div></div></div>}
            {data.upcoming.length > 0 && <div className="rounded-2xl bg-white/[0.04] border border-white/10 px-4 py-3 flex items-center justify-between"><div><div className={micro}>예약</div><div className="text-sm font-semibold mt-0.5">{data.upcoming[0].service || '시공'}</div></div><div className="text-sm text-white/75 tabular-nums">{fmt(data.upcoming[0].date)} · {data.upcoming[0].status}</div></div>}
          </div>
        )}
        </>)}

        {tab === 'care' && (
          <div className="space-y-3">
            {/* 받은 관리 한눈에 (2026-11-19 사장님: 손님이 몇 번 관리 받았는지 보이게) */}
            <div className="grid grid-cols-3 gap-2">
              <div className={`${box} text-center`}><div className="text-[22px] font-bold leading-none tabular-nums pt-0.5">{doneCare.length}<span className="text-sm font-medium text-white/60 ml-0.5">회</span></div><div className={`${micro} mt-2`}>받으신 관리</div></div>
              <div className={`${box} text-center`}><div className={`font-bold leading-none tabular-nums whitespace-nowrap pt-0.5 ${nextCare && !nextCare.visitDate ? 'text-[15px]' : 'text-[22px]'}`}>{nextDays === null ? '-' : nextCare && !nextCare.visitDate ? roughWhen(nextCare.date) : nextDays <= 0 ? '오늘' : <>D-{nextDays}</>}</div><div className={`${micro} mt-2`}>{nextCare && !nextCare.visitDate ? '다음 연락' : '다음 방문'}</div></div>
              <div className={`${box} text-center`}><div className="text-[22px] font-bold leading-none tabular-nums pt-0.5">{data.services.length}<span className="text-sm font-medium text-white/60 ml-0.5">건</span></div><div className={`${micro} mt-2`}>시공</div></div>
            </div>
            <div className={box}>
              <div className="text-sm font-bold mb-3">관리 기록</div>
              {data.care.length === 0 ? <div className="text-sm text-white/60">시공이 끝나면 6개월 메인터넌스(PPF·컬러PPF는 2주 QC도) 일정이 여기에 잡힙니다.</div> : (
                <div className="space-y-4">
                  {careGroups.map((g) => (
                    <div key={g.key}>
                      {careGroups.length > 1 && <div className={`${micro} mb-2 pb-1.5 border-b border-white/10`}>{g.title} 시공</div>}
                      <ul className="space-y-3">
                        {g.rows.map((f, i) => (
                          <li key={i} className="text-sm">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2.5">
                                <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] ${f.done && !f.skipped ? 'bg-[#22c55e]/15 text-[#22c55e]' : f.skipped ? 'border border-white/15 text-white/30' : 'border border-white/20 text-white/40'}`}>{f.done && !f.skipped ? '✓' : f.skipped ? '–' : g.rows.length - i}</span>
                                <span className={f.done ? '' : 'text-white/80'}>{careName(f.type)}</span>
                              </div>
                              <div className="text-right">
                                <div className="text-white/75 tabular-nums">{f.done ? fmt(f.doneAt || f.date) : f.visitDate ? fmt(f.visitDate) : roughWhen(f.date)}</div>
                                <div className={`text-[10px] ${f.done && !f.skipped ? 'text-[#22c55e]' : 'text-white/40'}`}>{f.skipped ? '미방문' : f.done ? '받으셨습니다' : f.visitDate ? '방문 예정' : '연락 예정'}</div>
                              </div>
                            </div>
                            {/* 점검 기록 (2026-11-22): 그날 무엇을 봤는지 한 줄 + 사진. "받으셨습니다"보다 이게 관리의 증거 */}
                            {f.done && !f.skipped && (f.note || (f.photos && f.photos.length > 0)) && (
                              <div className="ml-[30px] mt-1.5 rounded-xl bg-white/[0.05] px-3 py-2">
                                {f.note && <div className="text-[12px] text-white/80 leading-relaxed break-keep">{f.note}</div>}
                                {f.photos && f.photos.length > 0 && (
                                  <div className="flex gap-1.5 mt-1.5 overflow-x-auto">
                                    {f.photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="shrink-0"><img src={u} alt="점검 사진" className="w-16 h-16 object-cover rounded-lg border border-white/10" /></a>)}
                                  </div>
                                )}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[11px] text-white/40 mt-3 leading-relaxed">QC 점검은 끝단·표면·물기포를 보고, 메인터넌스는 필름 전용 코팅과 끝단 점검을 합니다.{data.careYears ? ` 메인터넌스는 시공일로부터 ${data.careYears}년 동안 6개월마다 이어집니다.` : ''} 날짜가 가까워지면 연락드립니다.</div>
            </div>
            {/* 내 차 관리법 (2026-11-22): 시공 종류별 출고 직후 / 평소 / 이럴 때 연락. 문구는 src/config/care-guide.ts */}
            {data.careGuide && data.careGuide.guides.length > 0 && (
              <div className={box}>
                <div className="text-sm font-bold mb-1">내 차 관리법</div>
                <div className="text-[11px] text-white/45 mb-3">받으신 시공에 맞는 안내만 모았습니다</div>
                <div className="space-y-2">
                  {data.careGuide.guides.map((g, gi) => (
                    <details key={g.key} open={gi === 0} className="rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 group">
                      <summary className="cursor-pointer list-none flex items-center justify-between text-sm font-semibold">
                        <span>{g.title}</span><span className="text-white/40 text-xs group-open:rotate-180 transition-transform">▾</span>
                      </summary>
                      <div className="mt-3 space-y-3">
                        {[['출고 직후', g.after], ['평소 관리', g.daily], ['이럴 때 연락 주세요', g.contact]].map(([label, lines]) => (lines as string[]).length > 0 && (
                          <div key={label as string}>
                            <div className={micro}>{label as string}</div>
                            <ul className="mt-1.5 space-y-1.5">
                              {(lines as string[]).map((t) => <li key={t} className="flex gap-2 text-[13px] leading-relaxed text-white/85 break-keep"><span className="text-[#E4002B] shrink-0">·</span><span>{t}</span></li>)}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
                <div className="text-[12px] text-white/60 mt-3 leading-relaxed break-keep">{data.careGuide.common}</div>
              </div>
            )}
          </div>
        )}

        {tab === 'benefit' && (
          <div className="space-y-3">
            <div className={box}>
              <div className="text-sm font-bold mb-2">{data.membership.name} 혜택</div>
              <ul className="space-y-1.5 text-sm">{data.membership.common.map((t) => <li key={t} className="flex gap-2.5"><span className="text-[#E4002B]">✓</span><span>{t}</span></li>)}</ul>
            </div>
            <div className={box}>
              <div className="text-sm font-bold mb-2">소개 혜택</div>
              <div className="text-sm"><div className={micro}>소개해 주신 분</div><div className="mt-1">{data.membership.referrerReward}</div>{data.points && <div className="text-[11px] text-white/50 mt-0.5">소개 1건마다 포인트 1점이 쌓입니다. 소개 탭에서 쓸 수 있는 항목을 보실 수 있습니다.</div>}</div>
              <div className="text-sm mt-3"><div className={micro}>소개받고 연락 주신 분</div><div className="text-[11px] text-white/40 mt-0.5">{data.membership.referredCondition}</div>
                <ul className="mt-1 space-y-0.5">{data.membership.referredRewardOptions.map((o) => <li key={o}>· {o}</li>)}</ul></div>
              {data.referrals.received && (
                <div className="mt-3 rounded-xl bg-white/[0.05] px-3 py-2 text-sm">
                  <span className="text-white/60">{data.referrals.received.from} 님 소개로 오셨습니다.</span>{' '}
                  {data.referrals.received.rewardAt ? <span className="text-[#22c55e]">혜택 적용 {fmt(data.referrals.received.rewardAt)} · {(data.referrals.received.reward || '').split('(')[0].trim()}</span> : <span>소개 혜택은 시공 때 적용해 드립니다.</span>}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'referral' && (
          <div className="space-y-3">
            <div className={box}>
              <div className="text-sm font-bold mb-1">지인 소개하기</div>
              <div className="text-sm text-white/70 leading-relaxed break-keep">지인이 연락하실 때 <span className="text-white font-semibold">{c.name}</span> 고객님 성함만 말씀해 주시면 됩니다. 그분과 고객님 모두에게 소개 혜택이 적용됩니다.</div>
              <button onClick={shareShop} className={`${btn} w-full mt-3 bg-white/10 hover:bg-white/15`}>매장 연락처 전달하기</button>
            </div>
            {/* 소개 포인트 (2026-11-19 사장님 결정): 소개 1건 = 1점, 쓰는 항목은 전부 공임 서비스(필름값만). 금액 숫자 없음 */}
            {data.points && (
              <div className={box}>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold">소개 포인트</div>
                    <div className="text-[11px] text-white/50 mt-0.5 break-keep">{data.points.earnRule}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[28px] font-black leading-none tabular-nums">{data.points.balance}<span className="text-sm font-bold ml-0.5">점</span></div>
                    {data.points.expiresAt && !data.points.expired && <div className="text-[10px] text-white/40 mt-1">{fmtDot(data.points.expiresAt)}까지</div>}
                  </div>
                </div>
                <ul className="mt-3 space-y-2">
                  {data.points.menu.map((m) => {
                    const ok = data.points.balance >= m.cost;
                    return (
                      <li key={m.cost} className={`flex items-start gap-2.5 rounded-xl px-3 py-2 ${ok ? 'bg-[#E4002B]/12 border border-[#E4002B]/40' : 'bg-white/[0.04]'}`}>
                        <span className={`shrink-0 mt-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-md tabular-nums ${ok ? 'bg-[#E4002B] text-white' : 'bg-white/10 text-white/60'}`}>{m.cost}점</span>
                        <div className="min-w-0">
                          <div className={`text-sm break-keep ${ok ? 'text-white font-semibold' : 'text-white/75'}`}>{m.label}{ok && <span className="ml-1.5 text-[10px] text-[#ff5c78] font-bold">지금 쓸 수 있음</span>}</div>
                          <div className="text-[11px] text-white/45 break-keep">{m.detail}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {data.points.history.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <div className={micro}>내역</div>
                    <ul className="mt-1 space-y-1 text-xs">
                      {data.points.history.map((h, i) => <li key={i} className="flex gap-2"><span className={`font-bold tabular-nums w-6 ${h.delta > 0 ? 'text-[#22c55e]' : 'text-white'}`}>{h.delta > 0 ? `+${h.delta}` : h.delta}</span><span className="text-white/45 w-20 shrink-0">{fmtDot(h.date)}</span><span className="text-white/80">{h.reason}</span></li>)}
                    </ul>
                  </div>
                )}
                <div className="mt-3 text-[11px] text-white/40 leading-relaxed break-keep">{data.points.conditions.map((t) => <div key={t}>· {t}</div>)}</div>
              </div>
            )}
            <div className={box}>
              <div className="text-sm font-bold mb-2">내가 소개한 분 {data.referrals.gave.length > 0 && <span className="text-white/60 font-medium">{data.referrals.gave.length}명</span>}</div>
              {data.referrals.gave.length === 0 ? <div className="text-sm text-white/60">아직 없습니다.</div> : (
                <ul className="space-y-2">
                  {data.referrals.gave.map((g, i) => (
                    <li key={i} className="flex items-center justify-between text-sm">
                      <div>{g.name} <span className="text-white/50 text-xs ml-1">{fmt(g.date)}</span></div>
                      <div className="text-right">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${g.state === '시공 완료' ? 'bg-[#22c55e]/15 text-[#22c55e]' : 'bg-white/10 text-white/70'}`}>{g.state}</span>
                        {g.rewardAt && <div className="text-[11px] text-[#22c55e] mt-0.5">내 혜택 적용 {fmt(g.rewardAt)}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div className="space-y-3">
            <div className={box}>
              <div className="text-sm font-bold mb-2">시공 기록</div>
              {data.services.length === 0 ? <div className="text-sm text-white/60">아직 시공 기록이 없습니다.</div> : (
                <ul className="space-y-2">{data.services.map((s, i) => <li key={i} className="text-sm flex items-center justify-between"><div>{s.type}{(data.vehicles?.length || 0) > 1 && s.vehicle ? <span className="text-white/60 text-xs ml-1">{s.vehicle}</span> : null}{s.area ? <span className="text-white/50 text-xs ml-1">{s.area}</span> : null}</div><div className="text-white/70 tabular-nums">{fmt(s.date)}</div></li>)}</ul>
              )}
            </div>
            <div className={box}>
              <div className="text-sm font-bold mb-2">시공 증명</div>
              {data.warranties.length === 0 ? <div className="text-sm text-white/60">발급된 시공 증명서가 없습니다.</div> : (
                <ul className="space-y-2.5">
                  {data.warranties.map((w, i) => (
                    <li key={i} className="text-sm">
                      <div className="flex items-center justify-between"><div className="font-medium">{w.work || '시공 보증서'}</div><div className="text-white/70 tabular-nums">{fmt(w.date)}</div></div>
                      <div className="text-[11px] text-white/45 mt-0.5 tabular-nums">No. {w.certNo}</div>
                      {w.items.length > 0 && <ul className="mt-1.5 space-y-0.5">{w.items.map((it, k) => <li key={k} className="text-[12px] text-white/60 break-keep"><span className="text-[#ff5c78] font-semibold mr-1.5">{it.group}</span>{it.text}{it.product ? <span className="text-white/40"> · {it.product}</span> : null}</li>)}</ul>}
                      {w.photos && w.photos.length > 0 && (
                        <div className="mt-2">
                          <div className="text-[11px] text-white/45 mb-1">작업 사진</div>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <div className="flex gap-1.5 overflow-x-auto pb-1">{w.photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="shrink-0"><img src={u} alt="작업 사진" className="w-20 h-20 object-cover rounded-lg border border-white/10" /></a>)}</div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {/* 3M 전자 보증서 안내는 3M 제품으로 한 시공이 있을 때만 (2026-11-26 오벨 필름도 씀) */}
              {data.warranties.some((w) => w.items.some((it) => /^3M/i.test(it.product || ''))) && (<>
              <a href={LINKS.threeMWarrantyCheck} target="_blank" rel="noopener noreferrer" className={`${btn} w-full mt-3 bg-white/[0.08] hover:bg-white/[0.14]`}>3M 소비자 보증서 확인 ↗</a>
              <div className="text-[11px] text-white/40 mt-2 leading-relaxed">3M 필름 보증은 한국쓰리엠 전자 보증서로 별도 발급됩니다. 보증 청구는 저희 매장으로 먼저 연락 주세요.</div>
              </>)}
            </div>
          </div>
        )}

        {/* 연락 */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <a href={`tel:${data.shop.phone}`} className={`${btn} bg-white/[0.08] hover:bg-white/[0.14]`}>전화</a>
          <a href={`sms:${data.shop.phone.replace(/-/g, '')}`} className={`${btn} bg-[#E4002B] hover:bg-[#c60026]`}>문자 보내기</a>
          <a href={data.shop.map} className={`${btn} bg-white/[0.08] hover:bg-white/[0.14]`}>길찾기</a>
          <a href={data.shop.card} className={`${btn} bg-white/[0.08] hover:bg-white/[0.14]`}>연락처 저장</a>
        </div>
        <div className="text-center text-[11px] text-white/30 pt-2 leading-relaxed">{data.shop.name}<br />{data.shop.address}</div>
      </div>
    </main>
  );
}
