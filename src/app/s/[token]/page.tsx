'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import WorkSheet, { type WorkSheetHead } from '@/components/WorkSheet';

/**
 * 직원용 예약 페이지 (2026-11-27 사장님 "예약/일정 탭만 직원들이 볼 수 있게 공유, 핸드폰 앱으로")
 * - /s/<코드>. 번호 4자리(STAFF_PIN)로 확인(sessionStorage) → 작은 달력 + 날짜별 예약 목록
 * - 읽기 전용. 전화·금액 없음. 밝은 톤(딜러 현황 페이지와 같은 변수). 60초마다·앱이 앞으로 올 때 다시 읽음
 */
interface Car { id: string; name: string; car: string | null; service_type: string | null; appointment_date: string; end_date: string | null; status: string; note: string | null; plate?: string | null; work?: string[]; sheet?: { workOrder: Record<string, unknown>; head: WorkSheetHead } | null }
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
                        <div className="flex items-start gap-2">
                          <button type="button" onClick={() => setOpen(k)} className="min-w-0 flex-1 text-left">
                            <span className="block text-[15px] font-semibold leading-snug break-keep">{/\s고객$/.test(c.name) && c.car ? c.car : <>{c.name}{c.car && <span className="text-[var(--c-text-3)] font-normal ml-1.5">{c.car}</span>}</>}{c.plate && <span className="text-[var(--c-text-4)] font-normal text-xs ml-1.5">{c.plate}</span>}</span>
                            <span className="block text-xs text-[var(--c-text-3)] mt-0.5">{[c.service_type, `${md(c.appointment_date)}${c.end_date && c.end_date !== c.appointment_date ? `~${md(c.end_date)}` : ''}`].filter(Boolean).join(' · ')}</span>
                            {/* 작업 내역 — 접지 않고 바로 (2026-11-27 사장님 "무슨 작업인지 확인할 수 있으면") */}
                            {(c.work?.length || 0) > 0 && (
                              <span className="block mt-1.5 space-y-0.5">
                                {c.work!.slice(0, 4).map((w, i) => <span key={i} className="block text-[12px] leading-snug text-[var(--c-text-2)] break-keep">{w}</span>)}
                                {c.work!.length > 4 && <span className="block text-[11px] text-[var(--c-text-4)]">+{c.work!.length - 4}</span>}
                              </span>
                            )}
                            {c.note && <span className="block text-[11px] text-[var(--c-text-4)] mt-1 truncate">{c.note.split('\n')[0]}</span>}
                          </button>
                          <span className="shrink-0 flex flex-col items-end gap-1.5">
                            <span className={`text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${chipCls(c)}`}>{chipLabel(c)}</span>
                            <button type="button" onClick={() => setOpen(k)} className={`text-[11px] font-semibold underline underline-offset-2 ${c.sheet ? 'text-brand' : 'text-[var(--c-text-4)]'}`}>시트</button>
                          </span>
                        </div>
                        {open === k && <SheetOverlay c={c} onClose={() => setOpen(null)} />}
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

/** 작업 리스트 시트 오버레이 (2026-11-27 사장님 "이런 식으로 PNG 볼 수 있게") — CRM 작업 내역서 PDF 와 같은 WorkSheet, 연락처 숨김 */
function SheetOverlay({ c, onClose }: { c: Car; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const shotRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(360);
  const [h, setH] = useState(0);
  const [big, setBig] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const fit = () => setW(boxRef.current?.clientWidth || Math.min(window.innerWidth - 32, 448));
    fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit);
  }, []);
  useEffect(() => { setH(shotRef.current?.offsetHeight || 0); }, [c, w]);
  const scale = Math.min(1, w / 800);
  const savePng = async () => {
    if (!shotRef.current) return;
    setBusy(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(shotRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('그림을 만들지 못했습니다');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `작업리스트-${c.name}-${c.appointment_date}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { alert(e instanceof Error ? e.message : '저장하지 못했습니다'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 overflow-y-auto" onClick={onClose}>
      <div className="max-w-md mx-auto px-4 py-6" onClick={(e) => e.stopPropagation()}>
        <div className="bg-[var(--c-card)] rounded-2xl p-4">
          <div className="flex items-start gap-2 mb-3">
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold break-keep">{c.name}{c.car && <span className="text-[var(--c-text-3)] font-normal ml-1.5">{c.car}</span>}</div>
              <div className="text-xs text-[var(--c-text-3)] mt-0.5">{[c.service_type, `${md(c.appointment_date)}${c.end_date && c.end_date !== c.appointment_date ? `~${md(c.end_date)}` : ''}`, c.status].filter(Boolean).join(' · ')}</div>
            </div>
            <button type="button" onClick={onClose} aria-label="닫기" className="shrink-0 w-8 h-8 rounded-full border border-[var(--c-border)] flex items-center justify-center text-[var(--c-text-2)] text-lg leading-none">×</button>
          </div>
          {c.note && <div className="mb-3 border-l-2 border-[var(--c-border)] pl-3 text-xs text-[var(--c-text-2)] whitespace-pre-line break-keep">{c.note}</div>}
          <div ref={boxRef} className="w-full">
            {!c.sheet ? (
              <div className="text-sm text-[var(--c-text-3)] bg-[var(--c-subtle)] rounded-xl px-3 py-3 break-keep">작업 내역서가 아직 없어요 — 사장님이 예약 줄에서 작업 내역서를 &apos;저장만 하기&apos; 하면 여기 보여요</div>
            ) : big ? (
              <div className="overflow-x-auto border border-[var(--c-border)] rounded-lg"><WorkSheet workOrder={c.sheet.workOrder} head={c.sheet.head} hidePhone /></div>
            ) : (
              <div className="border border-[var(--c-border)] rounded-lg overflow-hidden" style={{ height: h ? h * scale : undefined }}>
                <div style={{ width: 800, transform: `scale(${scale})`, transformOrigin: 'top left' }}><WorkSheet workOrder={c.sheet.workOrder} head={c.sheet.head} hidePhone /></div>
              </div>
            )}
          </div>
          {c.sheet && (
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={() => setBig((v) => !v)} className="flex-1 rounded-full border border-[var(--c-border)] py-2.5 text-sm font-semibold">{big ? '한눈에 보기' : '크게 보기'}</button>
              <button type="button" onClick={savePng} disabled={busy} className="flex-1 rounded-full bg-[var(--c-text-1)] text-[var(--c-card)] py-2.5 text-sm font-semibold disabled:opacity-50">{busy ? '만드는 중…' : '이미지로 저장'}</button>
            </div>
          )}
        </div>
      </div>
      {/* 저장용 원본 크기 사본 (화면 밖) */}
      {c.sheet && <div style={{ position: 'absolute', left: '-9999px', top: 0 }} aria-hidden><WorkSheet ref={shotRef} workOrder={c.sheet.workOrder} head={c.sheet.head} hidePhone /></div>}
    </div>
  );
}
