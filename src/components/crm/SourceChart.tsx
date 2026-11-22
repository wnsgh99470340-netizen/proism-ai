'use client';

import type { SourceTable } from '@/lib/weekly-stats';

/**
 * 유입경로 한눈에 보기 (2026-11-18 사장님: 시트의 "카넥트 유입경로 분석" 도넛·합계·비율처럼)
 * - 왼쪽: 도넛 차트(SVG, 라이브러리 없음). 2026-11-23 사장님 "색 안에 글씨 넣어서 어떤 유입인지 한눈에": 조각 안에 경로 이름, 바깥에 선으로 이름·비율
 * - 오른쪽: 경로별 건수·비율 두 줄 표 (머리글은 시트처럼 빨간 바탕)
 * 색은 globals.css 변수만 (라이트·다크 둘 다)
 */
const COLORS = ['var(--c-info)', 'var(--c-brand)', 'var(--c-warn)', 'var(--c-ok)', 'var(--c-violet)', 'var(--c-text-3)', 'var(--c-text-4)'];

const CX = 190, CY = 125, R = 88, r = 50;
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
  // 바깥 라벨: 오른쪽(cos≥0)·왼쪽으로 나눠 위에서 아래로 겹치지 않게 줄 간격 확보
  const place = (side: Seg[]) => {
    const sorted = [...side].sort((p, q) => Math.sin(p.mid) - Math.sin(q.mid));
    const ys: number[] = [];
    for (const s of sorted) { let y = CY + Math.sin(s.mid) * (R + 22); if (ys.length && y < ys[ys.length - 1] + 16) y = ys[ys.length - 1] + 16; ys.push(y); }
    return new Map(sorted.map((s, k) => [s.i, ys[k]]));
  };
  const right = segs.filter((s) => Math.cos(s.mid) >= 0), left = segs.filter((s) => Math.cos(s.mid) < 0);
  const yRight = place(right), yLeft = place(left);
  const single = segs.length === 1;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] gap-5 items-center">
      <div className="flex items-center justify-center">
        <svg viewBox="0 0 380 250" className="w-full max-w-[380px] h-auto" role="img" aria-label="유입경로 비율">
          {total === 0 ? <circle cx={CX} cy={CY} r={(R + r) / 2} fill="none" stroke="var(--c-border)" strokeWidth={R - r} /> : segs.map((s) => (
            <g key={s.i}>
              {single ? <circle cx={CX} cy={CY} r={(R + r) / 2} fill="none" stroke={COLORS[s.i]} strokeWidth={R - r} /> : <path d={arcPath(s.a0, s.a1)} fill={COLORS[s.i]} stroke="var(--c-card)" strokeWidth={1.5} />}
              {/* 조각 안 이름: 조각이 충분히 클 때만 (8% 이상) */}
              {s.frac >= 0.08 && (() => { const [x, y] = pt(s.mid, (R + r) / 2); return <text x={x} y={y + 4} textAnchor="middle" fill="#fff" style={{ fontSize: s.frac >= 0.15 ? 12 : 10, fontWeight: 700, paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.25)', strokeWidth: 2 }}>{s.label}</text>; })()}
              {/* 바깥 선 + 이름·비율 */}
              {(() => {
                const rightSide = Math.cos(s.mid) >= 0;
                const [ax, ay] = pt(s.mid, R + 2);
                const ly = (rightSide ? yRight : yLeft).get(s.i) ?? ay;
                const lx = rightSide ? CX + R + 30 : CX - R - 30;
                const tx = rightSide ? lx + 4 : lx - 4;
                return (
                  <g>
                    <polyline points={`${ax},${ay} ${rightSide ? lx - 8 : lx + 8},${ly} ${lx},${ly}`} fill="none" stroke="var(--c-text-4)" strokeWidth={1} />
                    <circle cx={ax} cy={ay} r={2} fill="var(--c-text-4)" />
                    <text x={tx} y={ly - 2} textAnchor={rightSide ? 'start' : 'end'} className="fill-[var(--c-text-2)]" style={{ fontSize: 11, fontWeight: 600 }}>{s.label}</text>
                    <text x={tx} y={ly + 10} textAnchor={rightSide ? 'start' : 'end'} className="fill-[var(--c-text-3)]" style={{ fontSize: 10 }}>{s.v}건 · {(s.frac * 100).toFixed(1)}%</text>
                  </g>
                );
              })()}
            </g>
          ))}
          <text x={CX} y={CY - 4} textAnchor="middle" className="fill-[var(--c-text-1)]" style={{ fontSize: 26, fontWeight: 700 }}>{total}</text>
          <text x={CX} y={CY + 14} textAnchor="middle" className="fill-[var(--c-text-3)]" style={{ fontSize: 11 }}>이달 새 고객</text>
        </svg>
      </div>
      <div className="min-w-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums whitespace-nowrap border-collapse">
            <thead>
              <tr>
                <th className="text-left py-1.5 px-2 text-[11px] font-medium text-[var(--c-text-3)]"></th>
                {table.labels.map((l, i) => (
                  <th key={l} className="py-1.5 px-2 text-center text-xs font-bold text-white border border-[var(--c-card)]" style={{ background: COLORS[i] }}>
                    {l}
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
