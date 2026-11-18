'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { LINKS } from '@/config/links';

/**
 * 손님용 회원 페이지 (2026-11-18 사장님: "사진 한 장이 아니라 앱처럼 눌러 보며 구경")
 * - /m/<개인코드>. 전화 뒷자리 4개로 확인(sessionStorage 에 기억) → 내 카드·관리 일정·혜택·내가 소개한 분·시공 기록·보증서·소개하기
 * - 공개 페이지라 명함 페이지처럼 어두운 톤 고정
 */
interface Data {
  customer: { name: string; car: string; color: string | null; memberSince: string | null; registered: string };
  membership: { name: string; common: string[]; referrerReward: string; referredRewardOptions: string[]; referredCondition: string };
  services: { type: string; date: string | null; done: string | null; area: string | null; film: string | null }[];
  care: { type: string; date: string; done: boolean; doneAt: string | null }[];
  upcoming: { date: string; end: string | null; service: string | null; status: string }[];
  warranties: { date: string; work: string; period: string; url: string | null }[];
  referrals: { gave: { name: string; date: string; state: string; reward: string | null; rewardAt: string | null }[]; received: { from: string; date: string; reward: string | null; rewardAt: string | null } | null };
  shop: { name: string; phone: string; address: string; card: string; map: string; talk: string };
}
const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '-');
const box = 'rounded-2xl bg-white/5 border border-white/10 p-4';
const btn = 'flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors';

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
      <main className="min-h-dvh bg-[#0f1013] text-white flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#E4002B] font-black text-lg mb-3">3M</div>
            <div className="text-lg font-bold">3M 프로이즘 강남서초점</div>
            <div className="text-sm text-white/60 mt-1">{maskedName ? `${maskedName} 고객님 회원 페이지` : '회원 페이지'}</div>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (pin.length === 4) load(pin); }} className={box}>
            <label className="text-xs text-white/60 block mb-2">본인 확인을 위해 전화번호 뒷자리 4개를 넣어 주세요</label>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="one-time-code" placeholder="0000" className="w-full text-center tracking-[0.5em] text-2xl font-bold bg-white/10 border border-white/15 rounded-xl py-3 outline-none focus:border-[#E4002B]" />
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
  const tabs = [['care', '관리 일정'], ['benefit', '내 혜택'], ['referral', '소개'], ['history', '시공·보증서']] as const;

  return (
    <main className="min-h-dvh bg-[#0f1013] text-white">
      <div className="max-w-md mx-auto p-4 pb-10 space-y-4">
        {/* 회원 카드 */}
        <div className="rounded-3xl p-5 bg-gradient-to-br from-[#1b1d24] to-[#101115] border border-white/10 relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#E4002B]" />
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] text-white/50">3M 프로이즘 강남서초점 · {data.membership.name}</div>
              <div className="text-2xl font-bold mt-1">{c.name} 고객님</div>
              <div className="text-sm text-white/70 mt-1">{c.car || '차량 미등록'}{c.color ? ` · ${c.color}` : ''}</div>
            </div>
            <div className="text-right text-[11px] text-white/50">회원 가입<br /><span className="text-white/80 font-semibold">{c.memberSince ? fmt(c.memberSince) : '첫 시공 뒤'}</span></div>
          </div>
          {nextCare && <div className="mt-4 rounded-xl bg-white/5 px-3 py-2 text-sm"><span className="text-white/60">다음 관리</span> <span className="font-semibold ml-1">{nextCare.type === 'QC점검' ? 'QC 점검' : nextCare.type}</span> <span className="text-white/70 ml-1">{fmt(nextCare.date)}</span></div>}
          {data.upcoming.length > 0 && <div className="mt-2 rounded-xl bg-white/5 px-3 py-2 text-sm"><span className="text-white/60">예약</span> <span className="font-semibold ml-1">{data.upcoming[0].service || '시공'}</span> <span className="text-white/70 ml-1">{fmt(data.upcoming[0].date)} · {data.upcoming[0].status}</span></div>}
        </div>

        {/* 탭 */}
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-white/5 p-1">
          {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`rounded-lg py-2 text-xs font-semibold transition-colors ${tab === k ? 'bg-white text-black' : 'text-white/70 hover:text-white'}`}>{l}</button>)}
        </div>

        {tab === 'care' && (
          <div className={box}>
            <div className="text-sm font-bold mb-3">관리 일정</div>
            {data.care.length === 0 ? <div className="text-sm text-white/60">시공이 끝나면 2주 QC와 6개월 메인터넌스 일정이 여기에 잡힙니다.</div> : (
              <ul className="space-y-2">
                {data.care.map((f, i) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <div><span className={`inline-block w-2 h-2 rounded-full mr-2 ${f.done ? 'bg-[#22c55e]' : 'bg-[#E4002B]'}`} />{f.type === 'QC점검' ? 'QC 점검' : f.type}</div>
                    <div className="text-white/70">{f.done ? `완료 ${fmt(f.doneAt || f.date)}` : fmt(f.date)}</div>
                  </li>
                ))}
              </ul>
            )}
            <div className="text-[11px] text-white/40 mt-3">QC 점검은 끝단·표면·물기포를 보고, 메인터넌스는 필름 전용 코팅과 끝단 점검을 합니다. 날짜가 가까워지면 연락드립니다.</div>
          </div>
        )}

        {tab === 'benefit' && (
          <div className="space-y-3">
            <div className={box}>
              <div className="text-sm font-bold mb-2">회원 혜택</div>
              <ul className="space-y-1.5 text-sm">{data.membership.common.map((t) => <li key={t} className="flex gap-2"><span className="text-[#E4002B]">✓</span><span>{t}</span></li>)}</ul>
            </div>
            <div className={box}>
              <div className="text-sm font-bold mb-2">소개 혜택</div>
              <div className="text-sm"><span className="text-white/60">소개해 주신 분</span><div className="mt-0.5">{data.membership.referrerReward}</div></div>
              <div className="text-sm mt-3"><span className="text-white/60">소개받고 연락 주신 분</span> <span className="text-[11px] text-white/40">({data.membership.referredCondition})</span>
                <ul className="mt-0.5 space-y-0.5">{data.membership.referredRewardOptions.map((o) => <li key={o}>· {o}</li>)}</ul></div>
              {data.referrals.received && (
                <div className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-sm">
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
              <div className="text-sm text-white/70">아래 버튼을 누르면 "{c.name}님 소개로 연락드립니다"가 적힌 문구가 열립니다. 지인에게 보내 주시면, 그분이 연락하실 때 소개하신 분으로 바로 기록됩니다.</div>
              <button onClick={share} className={`${btn} w-full mt-3 bg-[#E4002B] hover:bg-[#c60026]`}>📨 소개 문구 보내기</button>
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
                <ul className="space-y-2">{data.services.map((s, i) => <li key={i} className="text-sm flex items-center justify-between"><div>{s.type}{s.area ? <span className="text-white/50 text-xs ml-1">{s.area}</span> : null}</div><div className="text-white/70">{fmt(s.date)}</div></li>)}</ul>
              )}
            </div>
            <div className={box}>
              <div className="text-sm font-bold mb-2">보증서</div>
              {data.warranties.length === 0 ? <div className="text-sm text-white/60">발급된 매장 보증서가 없습니다.</div> : (
                <ul className="space-y-2">{data.warranties.map((w, i) => <li key={i} className="text-sm flex items-center justify-between"><div>{w.work || '시공 보증서'}{w.period ? <span className="text-white/50 text-xs ml-1">{w.period}</span> : null}</div><div className="text-white/70">{fmt(w.date)}</div></li>)}</ul>
              )}
              <a href={LINKS.threeMWarrantyCheck} target="_blank" rel="noopener noreferrer" className={`${btn} w-full mt-3 bg-white/10 hover:bg-white/15`}>3M 소비자 보증서 확인 ↗</a>
              <div className="text-[11px] text-white/40 mt-2">3M 필름 보증은 한국쓰리엠 전자 보증서로 별도 발급됩니다. 보증 청구는 저희 매장으로 먼저 연락 주세요.</div>
            </div>
          </div>
        )}

        {/* 연락 */}
        <div className="grid grid-cols-2 gap-2">
          <a href={`tel:${data.shop.phone}`} className={`${btn} bg-white/10 hover:bg-white/15`}>📞 전화</a>
          <a href={data.shop.talk} className={`${btn} bg-[#03C75A]/90 hover:bg-[#03C75A]`}>💬 네이버 톡톡</a>
          <a href={data.shop.map} className={`${btn} bg-white/10 hover:bg-white/15`}>📍 길찾기</a>
          <a href={data.shop.card} className={`${btn} bg-white/10 hover:bg-white/15`}>📇 연락처 저장</a>
        </div>
        <div className="text-center text-[11px] text-white/30 pt-2">{data.shop.name} · {data.shop.address}</div>
      </div>
    </main>
  );
}
