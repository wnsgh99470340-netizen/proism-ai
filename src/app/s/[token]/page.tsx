'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

/**
 * 직원용 예약 페이지 (2026-11-27 사장님 "예약/일정 탭만 직원들이 볼 수 있게 공유, 핸드폰 앱으로")
 * - /s/<코드>. 번호 4자리(STAFF_PIN)로 확인(sessionStorage) → 작은 달력 + 날짜별 예약 목록
 * - 읽기 전용. 전화·금액 없음. 밝은 톤(딜러 현황 페이지와 같은 변수). 60초마다·앱이 앞으로 올 때 다시 읽음
 */
interface Car { id: string; name: string; car: string | null; service_type: string | null; appointment_date: string; end_date: string | null; status: string; note: string | null }
interface Data { owner?: boolean; today: string; range: { from: string; to: string }; cars: Car[] }

const VISIT_TYPES = ['QC점검', '메인터넌스'];
const chipCls = (c: Car) => {
  if (c.service_type && VISIT_TYPES.includes(c.service_type)) return 'bg-[var(--c-subtle)] text-[var(--c-text-2)]';
  switch (c.status) {
    case '완료': return 'bg-ok/10 text-ok';
    case '시공중': return 'bg-[var(--c-text-1)] text-[var(--c-card)]';
    case '예약확정': return 'bg-info/10 text-info';
    default: return 'bg-[var(--c-subtle)] text-[var(--c-text-2)]';
  }
};
const chipLabel = (c: Car) => (c.service_type && VISIT_TYPES.includes(c.service_type) ? '방문' : c.status);
const md = (iso: string | null | undefined) => { if (!iso) return ''; const [, m, d] = iso.slice(0, 10).split('-').map(Number); return `${m}/${d}`; };
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const dayHead = (d: string, today: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  const w = WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  return `${m}월 ${dd}일 (${w})${d === today ? ' · 오늘' : ''}`;
};
/** 그 날 걸쳐 있는 예약인가 (시작~끝) */
const onDay = (c: Car, d: string) => c.appointment_date <= d && (c.end_date || c.appointment_date) >= d;

export default function StaffPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [needPin, setNeedPin] = useState(false);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const key = `s_pin_${token}`;

  const load = useCallback(async (p: string, quiet = false) => {
    if (!quiet) { setBusy(true); setErr(''); }
    try {
      const res = await fetch(`/api/staff/${token}`, { cache: 'no-store', headers: p ? { 'x-staff-pin': p } : undefined });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || '불러오지 못했습니다'); if (res.status === 401) { sessionStorage.removeItem(key); setData(null); setNeedPin(true); } return; }
      if (j.needPin) { setNeedPin(true); setData(null); return; }
      setData(j); setNeedPin(false); setErr('');
      if (p) sessionStorage.setItem(key, p);
    } catch { if (!quiet) setErr('네트워크 오류입니다. 잠시 뒤 다시 열어 주세요'); } finally { if (!quiet) setBusy(false); }
  }, [token, key]);

  useEffect(() => { load(sessionStorage.getItem(key) || ''); }, [load, key]);
  // 60초마다, 그리고 앱이 앞으로 올 때 다시 읽기
  useEffect(() => {
    if (!data) return;
    const again = () => { if (document.visibilityState === 'visible') load(sessionStorage.getItem(key) || '', true); };
    const t = setInterval(again, 60_000);
    document.addEventListener('visibilitychange', again);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', again); };
  }, [data, load, key]);
  useEffect(() => { if (data && !month) { const [y, m] = data.today.split('-').map(Number); setMonth({ y, m: m - 1 }); } }, [data, month]);

  const card = 'bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl';

  const days = useMemo(() => {
    if (!data) return [] as { d: string; cars: Car[] }[];
    const map = new Map<string, Car[]>();
    if (picked) map.set(picked, data.cars.filter((c) => onDay(c, picked)));
    else {
      // 오늘부터: 오늘 걸쳐 있는 예약은 오늘 아래, 그 뒤는 시작일 아래
      for (const c of data.cars) {
        const d = onDay(c, data.today) ? data.today : c.appointment_date;
        if (d < data.today) continue;
        if (!map.has(d)) map.set(d, []);
        map.get(d)!.push(c);
      }
      if (!map.has(data.today)) map.set(data.today, []);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, cars]) => ({ d, cars }));
  }, [data, picked]);

  if (!data) {
    return (
      <main className="h-dvh overflow-y-auto bg-[var(--c-page)] text-[var(--c-text-1)]">
        <div className="max-w-md mx-auto px-5 py-10">
          <Brand />
          {needPin ? (
            <form onSubmit={(e) => { e.preventDefault(); if (pin.length === 4) load(pin); }} className={`${card} p-5 mt-6`}>
              <div className="text-sm font-semibold mb-1">예약 일정</div>
              <label className="text-xs text-[var(--c-text-3)] block mb-3">들어가는 번호 4자리를 넣어 주세요 (사장님께 받은 번호)</label>
              <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="one-time-code" placeholder="0000" aria-label="번호 4자리" className="w-full text-center tracking-[0.5em] text-2xl font-bold bg-[var(--c-input)] border border-[var(--c-border)] rounded-xl py-3 outline-none focus:border-[var(--c-text-1)]" />
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

  const mo = month || { y: Number(data.today.slice(0, 4)), m: Number(data.today.slice(5, 7)) - 1 };
  const first = new Date(Date.UTC(mo.y, mo.m, 1)).getUTCDay();
  const nDays = new Date(Date.UTC(mo.y, mo.m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: nDays }, (_, i) => iso(mo.y, mo.m, i + 1))];
  const countOn = (d: string) => data.cars.filter((c) => onDay(c, d)).length;
  const move = (n: number) => setMonth(() => { const d = new Date(Date.UTC(mo.y, mo.m + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });
  const goToday = () => { const [y, m] = data.today.split('-').map(Number); setMonth({ y, m: m - 1 }); setPicked(null); };
  const inRange = (d: string) => d >= data.range.from && d <= data.range.to;

  return (
    <main className="h-dvh overflow-y-auto bg-[var(--c-page)] text-[var(--c-text-1)]">
      {data.owner && <div className="bg-brand text-white text-xs text-center py-1.5">사장님 보기 — 직원에게는 번호 확인 뒤 이 화면이 보입니다</div>}
      <div className="max-w-md mx-auto px-4 py-6 pb-16">
        <Brand />

        <section className={`${card} p-4 mt-5`}>
          <div className="flex items-center gap-2 mb-3">
            <button type="button" onClick={() => move(-1)} aria-label="이전 달" className="w-8 h-8 rounded-full border border-[var(--c-border)] flex items-center justify-center text-[var(--c-text-2)] text-lg leading-none">‹</button>
            <h1 className="text-lg font-bold tracking-tight min-w-[100px] text-center">{mo.y}년 {mo.m + 1}월</h1>
            <button type="button" onClick={() => move(1)} aria-label="다음 달" className="w-8 h-8 rounded-full border border-[var(--c-border)] flex items-center justify-center text-[var(--c-text-2)] text-lg leading-none">›</button>
            <button type="button" onClick={goToday} className="ml-auto rounded-full border border-[var(--c-border)] px-3 py-1 text-xs font-semibold">오늘</button>
          </div>
          <div className="grid grid-cols-7 text-center text-[11px] text-[var(--c-text-3)] mb-1">{WD.map((w, i) => <div key={w} className={i === 0 ? 'text-danger' : i === 6 ? 'text-info' : ''}>{w}</div>)}</div>
          <div className="grid grid-cols-7 gap-y-1">
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} />;
              const n = countOn(d);
              const isToday = d === data.today, isPicked = d === picked;
              return (
                <button key={d} type="button" disabled={!inRange(d)} onClick={() => setPicked(isPicked ? null : d)} className={`h-10 flex flex-col items-center justify-center rounded-lg disabled:opacity-30 ${isPicked ? 'bg-[var(--c-subtle)]' : ''}`}>
                  <span className={`w-7 h-7 flex items-center justify-center rounded-full text-[13px] ${isToday ? 'bg-[var(--c-text-1)] text-[var(--c-card)] font-bold' : ''}`}>{Number(d.slice(8))}</span>
                  <span className="h-1.5 flex gap-0.5">{Array.from({ length: Math.min(n, 3) }).map((_, k) => <span key={k} className="w-1 h-1 rounded-full bg-brand" />)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="flex items-center justify-between mt-5 mb-2 px-1">
          <div className="text-sm font-semibold">{picked ? `${md(picked)} 예약` : '오늘부터'}</div>
          {picked && <button type="button" onClick={() => setPicked(null)} className="text-xs text-[var(--c-text-3)] underline">오늘부터 보기</button>}
        </div>

        <div className="space-y-3">
          {days.map(({ d, cars }) => (
            <section key={d} className={`${card} px-4 py-2`}>
              <div className="text-xs font-semibold text-[var(--c-text-3)] pt-2 pb-1">{dayHead(d, data.today)}</div>
              {cars.length === 0 ? <div className="text-sm text-[var(--c-text-3)] py-2">예약이 없습니다</div> : (
                <ul className="divide-y divide-[var(--c-border)]">
                  {cars.map((c) => {
                    const k = `${d}-${c.id}`;
                    return (
                      <li key={k} className="py-2.5">
                        <button type="button" onClick={() => setOpen(open === k ? null : k)} className="w-full text-left flex items-start gap-3">
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-semibold leading-snug">{/\s고객$/.test(c.name) && c.car ? c.car : <>{c.name}{c.car && <span className="text-[var(--c-text-3)] font-normal ml-1.5">{c.car}</span>}</>}</span>
                            <span className="block text-xs text-[var(--c-text-3)] mt-0.5">{[c.service_type, `${md(c.appointment_date)}${c.end_date && c.end_date !== c.appointment_date ? `~${md(c.end_date)}` : ''}`].filter(Boolean).join(' · ')}{c.note ? ' · 메모 있음' : ''}</span>
                          </span>
                          <span className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${chipCls(c)}`}>{chipLabel(c)}</span>
                        </button>
                        {open === k && c.note && <div className="mt-2 ml-1 border-l border-[var(--c-border)] pl-3 text-xs text-[var(--c-text-2)] whitespace-pre-line">{c.note}</div>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>

        <p className="text-[11px] text-[var(--c-text-4)] text-center mt-8">읽기 전용 · 변경은 사장님께 · {md(data.range.from)}~{md(data.range.to)} 일정</p>
      </div>
    </main>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-9 h-9 rounded-lg bg-brand text-white font-extrabold text-[13px] tracking-tight flex items-center justify-center">3M</span>
      <span className="font-bold text-[15px]">프로이즘 강남 서초점 <span className="text-[var(--c-text-3)] font-medium">예약 일정</span></span>
    </div>
  );
}
