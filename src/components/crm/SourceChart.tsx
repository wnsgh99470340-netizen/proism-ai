'use client';

import type { SourceTable } from '@/lib/weekly-stats';

/**
 * 유입경로 한눈에 보기 (2026-11-18 사장님: 시트의 "카넥트 유입경로 분석" 도넛·합계·비율처럼)
 * - 왼쪽: 도넛 차트(SVG, 라이브러리 없음). 2026-11-23 사장님 "색 안에 글씨 넣어서 어떤 유입인지 한눈에": 조각 안에 경로 이름, 바깥에 선으로 이름·비율
 * - 오른쪽: 경로별 건수·비율 두 줄 표 (머리글은 시트처럼 빨간 바탕)
 * 색은 globals.css 변수만 (라이트·다크 둘 다)
 */
const COLORS = ['var(--c-info)', 'var(--c-brand)', 'var(--c-warn)', 'var(--c-ok)', 'var(--c-violet)', 'var(--c-text-3)', 'var(--c-text-4)'];

const CX = 125, CY = 125, R = 110, r = 62;
const pt = (a: number, rad: number) => [CX + rad * Math.cos(a), CY + rad * Math.sin(a)] as const;
/** 도넛 조각 path: 시작각 a0 → 끝각 a1 (라디안, 12시 = -π/2) */
function arcPath(a0: number, a1: number) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R), [x2, y2] = pt(a1, r), [x3, y3] = pt(a0, r);
  return `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
}

export default function SourceChart({ table }: { table: SourceTable }) {
  const total = table.total;
  type Seg = { i: number; label: string; v: number; frac: number; a0: number; a1: number; mid: number };
  const segs: Seg[] = [];
  let a = -Math.PI / 2;
  table.totals.forEach((v, i) => {
    if (!v || !total) return;
    const frac = v / total, a1 = a + frac * 2 * Math.PI;
    segs.push({ i, label: table.labels[i], v, frac, a0: a, a1, mid: (a + a1) / 2 });
    a = a1;
  });
  const single = segs.length === 1;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 items-center">
      {/* 도넛 + 범례: 선 없이 조각 안에 이름·비율, 옆에 색 네모 범례 (2026-11-23 사장님 "너무 난해, 깔끔하게") */}
      <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5 justify-center">
        <svg viewBox="0 0 250 250" className="w-[210px] h-[210px] shrink-0" role="img" aria-label="유입경로 비율">
          {total === 0 ? <circle cx={CX} cy={CY} r={(R + r) / 2} fill="none" stroke="var(--c-border)" strokeWidth={R - r} /> : segs.map((s) => (
            <g key={s.i}>
              {single ? <circle cx={CX} cy={CY} r={(R + r) / 2} fill="none" stroke={COLORS[s.i]} strokeWidth={R - r} /> : <path d={arcPath(s.a0, s.a1)} fill={COLORS[s.i]} stroke="var(--c-card)" strokeWidth={2} />}
              {s.frac >= 0.12 && (() => { const [x, y] = pt(s.mid, (R + r) / 2); return (
                <g style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.22)', strokeWidth: 2 }}>
                  <text x={x} y={y - 2} textAnchor="middle" fill="#fff" style={{ fontSize: 12, fontWeight: 700 }}>{s.label}</text>
                  <text x={x} y={y + 12} textAnchor="middle" fill="#fff" style={{ fontSize: 11, fontWeight: 600 }}>{Math.round(s.frac * 100)}%</text>
                </g>
              ); })()}
            </g>
          ))}
          <text x={CX} y={CY - 4} textAnchor="middle" className="fill-[var(--c-text-1)]" style={{ fontSize: 28, fontWeight: 700 }}>{total}</text>
          <text x={CX} y={CY + 14} textAnchor="middle" className="fill-[var(--c-text-3)]" style={{ fontSize: 11 }}>이달 새 고객</text>
        </svg>
        <ul className="space-y-1.5 text-sm shrink-0">
          {table.labels.map((l, i) => {
            const v = table.totals[i];
            return (
              <li key={l} className={`flex items-center gap-2 ${v ? 'text-[var(--c-text-1)]' : 'text-[var(--c-text-4)]'}`}>
                <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: v ? COLORS[i] : 'var(--c-border)' }} />
                <span className="w-[4.6rem] whitespace-nowrap">{l}</span>
                <span className="tabular-nums font-semibold w-8 text-right">{v}</span>
                <span className="tabular-nums text-xs text-[var(--c-text-3)] w-12 text-right">{table.ratios[i].toFixed(1)}%</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="min-w-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums whitespace-nowrap border-collapse">
            <thead>
              <tr>
                <th className="text-left py-1.5 px-2 text-[11px] font-medium text-[var(--c-text-3)]"></th>
                {table.labels.map((l, i) => (
                  <th key={l} className="py-1.5 px-2 text-center text-xs font-bold text-white bg-brand border border-[var(--c-card)]">
                    <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full ring-1 ring-white/70" style={{ background: COLORS[i] }} />{l}</span>
                  </th>
                ))}
                <th className="py-1.5 px-2 text-center text-xs font-bold text-white bg-[var(--c-text-1)] border border-[var(--c-card)]">합계</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--c-border)]">
                <td className="py-2 px-2 text-xs text-[var(--c-text-3)]">건수</td>
                {table.totals.map((c, i) => <td key={i} className={`py-2 px-2 text-center text-lg font-bold ${c ? 'text-[var(--c-text-1)]' : 'text-[var(--c-text-4)]'}`}>{c}</td>)}
                <td className="py-2 px-2 text-center text-lg font-bold text-[var(--c-text-1)]">{total}</td>
              </tr>
              <tr>
                <td className="py-1.5 px-2 text-xs text-[var(--c-text-3)]">비율</td>
                {table.ratios.map((p, i) => <td key={i} className={`py-1.5 px-2 text-center text-xs ${p ? 'text-[var(--c-text-2)] font-semibold' : 'text-[var(--c-text-4)]'}`}>{p.toFixed(1)}%</td>)}
                <td className="py-1.5 px-2 text-center text-xs text-[var(--c-text-3)]">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
