'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { LINKS } from '@/config/links';

/**
 * 손님용 회원 페이지 (2026-11-18 사장님: "사진 한 장이 아니라 앱처럼 눌러 보며 구경")
 * - /m/<개인코드>. 전화 뒷자리 4개로 확인(sessionStorage 에 기억) → 시공 증명서·관리 일정·혜택·소개·기록
 * - 2026-11-18 사장님 "보증서를 보고 '제대로 시공 받았구나' 느꼈으면, 더 세련되게" → 맨 위를 회원 카드 대신 시공 증명서로.
 *   작업 내역서(PPF·썬팅·코팅 항목)를 줄로 보여 주고, 증명 번호·시공 기간·3M 프리퍼드 인스톨러 인장·시공 기준 3줄
 * - 공개 페이지라 명함 페이지처럼 어두운 톤 고정. 프리퍼드 인스톨러 인증서 이미지는 트랙(랩핑)이 적혀 있어 쓰지 않음
 */
interface Data {
  customer: { name: string; car: string; color: string | null; memberSince: string | null; registered: string };
  membership: { name: string; common: string[]; referrerReward: string; referredRewardOptions: string[]; referredCondition: string };
  services: { type: string; date: string | null; done: string | null; area: string | null; film: string | null }[];
  care: { type: string; date: string; done: boolean; doneAt: string | null }[];
  upcoming: { date: string; end: string | null; service: string | null; status: string }[];
  warranties: { date: string; end: string | null; work: string; period: string; url: string | null; items: { group: string; text: string }[]; certNo: string }[];
  referrals: { gave: { name: string; date: string; state: string; reward: string | null; rewardAt: string | null }[]; received: { from: string; date: string; reward: string | null; rewardAt: string | null } | null };
  shop: { name: string; phone: string; address: string; card: string; map: string; talk: string };
}
const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '-');
const fmtDot = (d: string | null | undefined) => {
  if (!d) return '-';
  const x = new Date(d);
  return `${x.getFullYear()}.${String(x.getMonth() + 1).padStart(2, '0')}.${String(x.getDate()).padStart(2, '0')}`;
};
const box = 'rounded-2xl bg-white/[0.04] border border-white/10 p-4';
const btn = 'flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors';
const micro = 'text-[10px] tracking-[0.22em] uppercase text-white/40';
const careName = (t: string) => (t === 'QC점검' ? 'QC 점검' : t);

/** 시공 증명서 아래 "이 시공의 기준" — 확인된 사실만, 짧게 (differentiators.ts confirmed 항목 기준) */
function standardsFor(items: { group: string }[]) {
  const lines = ['3M 공인 프리퍼드 인스톨러 매장에서 시공했습니다'];
  if (items.some((i) => i.group === 'PPF')) lines.push('PPF 외부 패널은 판시공 핸드커팅, 끝단 안쪽 마감입니다');
  lines.push('2주 뒤 QC 점검, 6개월마다 메인터넌스로 관리합니다');
  lines.push('시공 기록과 보증서는 매장에서 보관합니다');
  return lines;
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
  const [tab, setTab] = useState<'care' | 'benefit' | 'referral' | 'history'>('care');

  const load = useCallback(async (p: string) => {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/member/${token}${p ? `?pin=${p}` : ''}`, { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || '불러오지 못했습니다'); if (res.status === 401) sessionStorage.removeItem(`m_pin_${token}`); return; }
      if (j.needPin) { setMaskedName(j.name || ''); return; }
      setData(j as Data);
      sessionStorage.setItem(`m_pin_${token}`, p);
    } catch { setErr('연결이 원활하지 않습니다. 잠시 뒤 다시 열어 주세요'); } finally { setBusy(false); }
  }, [token]);

  useEffect(() => { const saved = sessionStorage.getItem(`m_pin_${token}`) || ''; load(saved); }, [load, token]);

  const share = () => {
    if (!data) return;
    const text = `${data.customer.name}님 소개로 연락드립니다.\n3M 프로이즘 강남서초점 ${data.shop.phone}\n${data.shop.card}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else { navigator.clipboard?.writeText(text); alert('소개 문구를 복사했습니다. 지인에게 붙여 넣어 보내 주세요.'); }
  };

  if (!data) {
    return (
      <main className="min-h-dvh bg-[#0b0c0f] text-white flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-7">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#E4002B] font-black text-lg mb-4 shadow-[0_0_30px_rgba(228,0,43,0.3)]">3M</div>
            <div className={micro}>Preferred Installer</div>
            <div className="text-lg font-bold mt-1">3M 프로이즘 강남서초점</div>
            <div className="text-sm text-white/55 mt-1">{maskedName ? `${maskedName} 고객님 회원 페이지` : '회원 페이지'}</div>
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
  const cert = data.warranties[0] || null; // 가장 최근 발급분이 맨 위 증명서
  const latestService = data.services[0] || null;
  const tabs = [['care', '관리 일정'], ['benefit', '내 혜택'], ['referral', '소개'], ['history', '기록·보증']] as const;

  return (
    <main className="min-h-dvh bg-[#0b0c0f] text-white">
      <div className="max-w-md mx-auto px-4 pt-5 pb-10 space-y-4">
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
                <div className="text-sm text-white/65 mt-2.5">{c.car || '차량 미등록'}{c.color ? <span className="text-white/40"> · {c.color}</span> : null}</div>
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
                          <span className="text-[15px] font-medium leading-snug">{it.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-2 text-[15px] font-medium">{cert.work || '시공'}</div>
                  )}
                  <div className="mt-5 flex items-end justify-between gap-4">
                    <div className="flex flex-col gap-3">
                      <div><div className={micro}>시공 기간</div><div className="text-sm font-semibold tabular-nums mt-1 whitespace-nowrap">{fmtDot(cert.date)}{cert.end && cert.end !== cert.date ? <span className="text-white/50"> – {fmtDot(cert.end).slice(5)}</span> : null}</div></div>
                      <div><div className={micro}>{cert.period ? '매장 보증' : '시공 매장'}</div><div className="text-sm font-semibold mt-1">{cert.period || '강남서초점'}</div></div>
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
          {standardsFor(cert?.items || []).map((t) => (
            <li key={t} className="flex gap-2.5 text-[12.5px] text-white/65 leading-snug break-keep"><span className="text-[#E4002B] mt-[1px]">—</span><span>{t}</span></li>
          ))}
        </ul>

        {/* 다음 일정 요약 */}
        {(nextCare || data.upcoming.length > 0) && (
          <div className="grid grid-cols-1 gap-2">
            {nextCare && <div className="rounded-2xl bg-white/[0.04] border border-white/10 px-4 py-3 flex items-center justify-between"><div><div className={micro}>다음 관리</div><div className="text-sm font-semibold mt-0.5">{careName(nextCare.type)}</div></div><div className="text-sm text-white/75 tabular-nums">{fmt(nextCare.date)}</div></div>}
            {data.upcoming.length > 0 && <div className="rounded-2xl bg-white/[0.04] border border-white/10 px-4 py-3 flex items-center justify-between"><div><div className={micro}>예약</div><div className="text-sm font-semibold mt-0.5">{data.upcoming[0].service || '시공'}</div></div><div className="text-sm text-white/75 tabular-nums">{fmt(data.upcoming[0].date)} · {data.upcoming[0].status}</div></div>}
          </div>
        )}

        {/* 탭 */}
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-white/[0.05] p-1">
          {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`rounded-lg py-2 text-xs font-semibold transition-colors ${tab === k ? 'bg-white text-black' : 'text-white/65 hover:text-white'}`}>{l}</button>)}
        </div>

        {tab === 'care' && (
          <div className={box}>
            <div className="text-sm font-bold mb-3">관리 일정</div>
            {data.care.length === 0 ? <div className="text-sm text-white/60">시공이 끝나면 2주 QC와 6개월 메인터넌스 일정이 여기에 잡힙니다.</div> : (
              <ul className="space-y-2.5">
                {data.care.map((f, i) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2.5"><span className={`inline-block w-1.5 h-1.5 rounded-full ${f.done ? 'bg-[#22c55e]' : 'bg-[#E4002B]'}`} />{careName(f.type)}</div>
                    <div className="text-white/70 tabular-nums">{f.done ? `완료 ${fmt(f.doneAt || f.date)}` : fmt(f.date)}</div>
                  </li>
                ))}
              </ul>
            )}
            <div className="text-[11px] text-white/40 mt-3 leading-relaxed">QC 점검은 끝단·표면·물기포를 보고, 메인터넌스는 필름 전용 코팅과 끝단 점검을 합니다. 날짜가 가까워지면 연락드립니다.</div>
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
              <div className="text-sm"><div className={micro}>소개해 주신 분</div><div className="mt-1">{data.membership.referrerReward}</div></div>
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
              <div className="text-sm text-white/70 leading-relaxed">아래 버튼을 누르면 "{c.name}님 소개로 연락드립니다"가 적힌 문구가 열립니다. 지인에게 보내 주시면, 그분이 연락하실 때 소개하신 분으로 기록됩니다.</div>
              <button onClick={share} className={`${btn} w-full mt-3 bg-[#E4002B] hover:bg-[#c60026]`}>소개 문구 보내기</button>
            </div>
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
                <ul className="space-y-2">{data.services.map((s, i) => <li key={i} className="text-sm flex items-center justify-between"><div>{s.type}{s.area ? <span className="text-white/50 text-xs ml-1">{s.area}</span> : null}</div><div className="text-white/70 tabular-nums">{fmt(s.date)}</div></li>)}</ul>
              )}
            </div>
            <div className={box}>
              <div className="text-sm font-bold mb-2">보증</div>
              {data.warranties.length === 0 ? <div className="text-sm text-white/60">발급된 매장 보증서가 없습니다.</div> : (
                <ul className="space-y-2.5">
                  {data.warranties.map((w, i) => (
                    <li key={i} className="text-sm">
                      <div className="flex items-center justify-between"><div className="font-medium">{w.work || '시공 보증서'}</div><div className="text-white/70 tabular-nums">{fmt(w.date)}</div></div>
                      <div className="text-[11px] text-white/45 mt-0.5 tabular-nums">No. {w.certNo}{w.period ? ` · 매장 보증 ${w.period}` : ''}</div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="text-[12px] text-white/60 mt-3 leading-relaxed">매장 보증은 보증 기간 안에 시공 하자가 생기면 무상으로 다시 시공해 드리는 약속입니다. 외부 충격·사고·부주의로 인한 손상은 제외됩니다.</div>
              <a href={LINKS.threeMWarrantyCheck} target="_blank" rel="noopener noreferrer" className={`${btn} w-full mt-3 bg-white/[0.08] hover:bg-white/[0.14]`}>3M 소비자 보증서 확인 ↗</a>
              <div className="text-[11px] text-white/40 mt-2 leading-relaxed">3M 필름 보증은 한국쓰리엠 전자 보증서로 별도 발급됩니다. 보증 청구는 저희 매장으로 먼저 연락 주세요.</div>
            </div>
          </div>
        )}

        {/* 연락 */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <a href={`tel:${data.shop.phone}`} className={`${btn} bg-white/[0.08] hover:bg-white/[0.14]`}>전화</a>
          <a href={data.shop.talk} className={`${btn} bg-[#03C75A]/90 hover:bg-[#03C75A]`}>네이버 톡톡</a>
          <a href={data.shop.map} className={`${btn} bg-white/[0.08] hover:bg-white/[0.14]`}>길찾기</a>
          <a href={data.shop.card} className={`${btn} bg-white/[0.08] hover:bg-white/[0.14]`}>연락처 저장</a>
        </div>
        <div className="text-center text-[11px] text-white/30 pt-2 leading-relaxed">{data.shop.name}<br />{data.shop.address}</div>
      </div>
    </main>
  );
}
