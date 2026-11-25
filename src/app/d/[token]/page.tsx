'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

/**
 * 딜러용 현황 페이지 (2026-11-25 사장님 "딜러 현황 페이지부터 가자")
 * - /d/<코드>. 딜러 전화 뒷자리 4개로 확인(sessionStorage) → 넣어 준 차들의 입고 예정·작업 중·출고 완료
 * - 밝은 톤(CRM 과 같은 변수). 손님 전화·금액은 안 보임. 딜러는 자기 손님에게 "지금 이렇게 되고 있다"를 바로 보여 줄 수 있다
 */
interface Car { id: string; name: string; car: string | null; state: { tone: 'soon' | 'working' | 'done' | 'talk' | 'none'; label: string; detail: string; service: string | null }; history: { date: string; end: string | null; service: string | null; status: string }[] }
interface Data { owner?: boolean; dealer: { name: string; org: string | null }; today: string; cars: Car[]; shop: { name: string; phone: string; address: string; card: string } }

const toneCls: Record<Car['state']['tone'], string> = {
  soon: 'bg-info/10 text-info',
  working: 'bg-[var(--c-text-1)] text-[var(--c-card)]',
  done: 'bg-ok/10 text-ok',
  talk: 'bg-[var(--c-subtle)] text-[var(--c-text-2)]',
  none: 'bg-[var(--c-subtle)] text-[var(--c-text-3)]',
};
const md = (iso: string | null | undefined) => { if (!iso) return ''; const [, m, d] = iso.slice(0, 10).split('-').map(Number); return `${m}/${d}`; };

export default function DealerPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [needPin, setNeedPin] = useState<{ name: string } | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/dealer/${token}`, { cache: 'no-store', headers: p ? { 'x-member-pin': p } : undefined });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || '불러오지 못했습니다'); if (res.status === 401) sessionStorage.removeItem(`d_pin_${token}`); return; }
      if (j.needPin) { setNeedPin({ name: j.name }); return; }
      setData(j); setNeedPin(null);
      if (p) sessionStorage.setItem(`d_pin_${token}`, p);
    } catch { setErr('네트워크 오류입니다. 잠시 뒤 다시 열어 주세요'); } finally { setBusy(false); }
  }, [token]);
  useEffect(() => { const saved = sessionStorage.getItem(`d_pin_${token}`) || ''; load(saved); }, [load, token]);

  const card = 'bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl';

  if (!data) {
    return (
      <main className="h-dvh overflow-y-auto bg-[var(--c-page)] text-[var(--c-text-1)]">
        <div className="max-w-md mx-auto px-5 py-10">
          <Brand />
          {needPin ? (
            <form onSubmit={(e) => { e.preventDefault(); if (pin.length === 4) load(pin); }} className={`${card} p-5 mt-6`}>
              <div className="text-sm font-semibold mb-1">{needPin.name} 님 작업 현황</div>
              <label className="text-xs text-[var(--c-text-3)] block mb-3">본인 확인을 위해 전화번호 뒷자리 4개를 넣어 주세요</label>
              <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="one-time-code" placeholder="0000" className="w-full text-center tracking-[0.5em] text-2xl font-bold bg-[var(--c-input)] border border-[var(--c-border)] rounded-xl py-3 outline-none focus:border-[var(--c-text-1)]" />
              {err && <div className="text-xs text-danger mt-2">{err}</div>}
              <button type="submit" disabled={busy || pin.length !== 4} className="w-full mt-3 rounded-full bg-brand hover:bg-brand-dark disabled:opacity-40 text-white text-sm font-semibold py-3">{busy ? '확인 중…' : '들어가기'}</button>
            </form>
          ) : (
            <div className={`${card} p-5 mt-6 text-sm text-[var(--c-text-3)]`}>{err || '불러오는 중…'}</div>
          )}
        </div>
      </main>
    );
  }

  const active = data.cars.filter((c) => c.state.tone === 'soon' || c.state.tone === 'working' || c.state.tone === 'talk');
  const done = data.cars.filter((c) => c.state.tone === 'done' || c.state.tone === 'none');
  const Row = ({ c }: { c: Car }) => (
    <li className="py-3">
      <button type="button" onClick={() => setOpen(open === c.id ? null : c.id)} className="w-full text-left flex items-start gap-3">
        <span className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${toneCls[c.state.tone]}`}>{c.state.label}</span>
        <span className="min-w-0 flex-1">
          {/* "X7 고객" 같은 임시 이름(손님 성함 없이 차종으로 등록한 기록)은 차종만 보여 준다 */}
          <span className="block text-[15px] font-semibold leading-snug">{/\s고객$/.test(c.name) && c.car ? c.car : <>{c.name}{c.car && <span className="text-[var(--c-text-3)] font-normal ml-1.5">{c.car}</span>}</>}</span>
          <span className="block text-xs text-[var(--c-text-3)] mt-0.5">{[c.state.service, c.state.detail].filter(Boolean).join(' · ') || '예약 기록이 아직 없습니다'}</span>
        </span>
      </button>
      {open === c.id && c.history.length > 1 && (
        <ul className="mt-2 ml-1 border-l border-[var(--c-border)] pl-3 space-y-1">
          {c.history.map((h, i) => <li key={i} className="text-xs text-[var(--c-text-3)]">{md(h.date)}{h.end && h.end !== h.date ? `~${md(h.end)}` : ''} · {h.service || '시공'} · {h.status}</li>)}
        </ul>
      )}
    </li>
  );

  return (
    <main className="h-dvh overflow-y-auto bg-[var(--c-page)] text-[var(--c-text-1)]">
      {data.owner && <div className="bg-brand text-white text-xs text-center py-1.5">사장님 보기 — 딜러에게는 뒷자리 확인 뒤 이 화면이 보입니다</div>}
      <div className="max-w-md mx-auto px-5 py-8 pb-16">
        <Brand />
        <div className="mt-6 mb-5">
          <h1 className="text-xl font-bold tracking-tight">{data.dealer.name} 님이 넣어 주신 차</h1>
          <p className="text-sm text-[var(--c-text-3)] mt-1">{data.dealer.org ? `${data.dealer.org} · ` : ''}진행 중 {active.length}대 · 출고 완료 {done.length}대</p>
        </div>

        <section className={`${card} px-5 py-2 mb-4`}>
          <div className="text-xs font-semibold text-[var(--c-text-3)] pt-3 pb-1">진행 중</div>
          {active.length === 0 ? <div className="text-sm text-[var(--c-text-3)] py-3">지금 진행 중인 차가 없습니다</div> : <ul className="divide-y divide-[var(--c-border)]">{active.map((c) => <Row key={c.id} c={c} />)}</ul>}
        </section>
        {done.length > 0 && (
          <section className={`${card} px-5 py-2 mb-4`}>
            <div className="text-xs font-semibold text-[var(--c-text-3)] pt-3 pb-1">출고 완료</div>
            <ul className="divide-y divide-[var(--c-border)]">{done.map((c) => <Row key={c.id} c={c} />)}</ul>
          </section>
        )}

        <section className={`${card} p-5`}>
          <div className="text-sm font-semibold mb-1">{data.shop.name}</div>
          <div className="text-xs text-[var(--c-text-3)] leading-relaxed">{data.shop.address}<br />입고 전날 안내와 출고 안내는 문자로 따로 드립니다. 손님께 가는 보증서와 관리 안내는 손님 번호로 보냅니다.</div>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <a href={`tel:${data.shop.phone}`} className="rounded-full border border-[var(--c-border)] py-2.5 text-center text-sm font-semibold hover:bg-[var(--c-subtle)]">전화</a>
            <a href={`sms:${data.shop.phone}`} className="rounded-full bg-[var(--c-text-1)] text-[var(--c-card)] py-2.5 text-center text-sm font-semibold">문자</a>
          </div>
        </section>
        <p className="text-[11px] text-[var(--c-text-4)] text-center mt-6">이 페이지는 {data.dealer.name} 님만 보는 주소입니다 · 기준 {md(data.today)}</p>
      </div>
    </main>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-9 h-9 rounded-lg bg-brand text-white font-extrabold text-[13px] tracking-tight flex items-center justify-center">3M</span>
      <span className="font-bold text-[15px]">프로이즘 강남 서초점 <span className="text-[var(--c-text-3)] font-medium">딜러 현황</span></span>
    </div>
  );
}
