'use client';

import type { SourceTable } from '@/lib/weekly-stats';

/**
 * 유입경로 한눈에 보기 (2026-11-18 사장님: 시트의 "카넥트 유입경로 분석" 도넛·합계·비율처럼)
 * - 왼쪽: 도넛 차트(SVG, 라이브러리 없음), 가운데 합계
 * - 오른쪽: 경로별 건수·비율 두 줄 표 (머리글은 시트처럼 빨간 바탕)
 * 색은 globals.css 변수만 (라이트·다크 둘 다)
 */
const COLORS = ['var(--c-info)', 'var(--c-brand)', 'var(--c-warn)', 'var(--c-ok)', 'var(--c-violet)', 'var(--c-text-3)', 'var(--c-text-4)'];

export default function SourceChart({ table }: { table: SourceTable }) {
  const total = table.total;
  const R = 70, r = 42, C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = table.totals.map((v, i) => {
    const frac = total ? v / total : 0;
    const dash = frac * C;
    const el = (
      <circle key={i} cx="90" cy="90" r={R} fill="none" stroke={COLORS[i]} strokeWidth={R - r} strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc * C} transform="rotate(-90 90 90)" />
    );
    acc += frac;
    return v > 0 ? el : null;
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5 items-center">
      <div className="flex items-center justify-center">
        <svg viewBox="0 0 180 180" className="w-[180px] h-[180px]" role="img" aria-label="유입경로 비율">
          {total === 0 ? <circle cx="90" cy="90" r={R} fill="none" stroke="var(--c-border)" strokeWidth={R - r} /> : arcs}
          <text x="90" y="84" textAnchor="middle" className="fill-[var(--c-text-1)]" style={{ fontSize: 26, fontWeight: 700 }}>{total}</text>
          <text x="90" y="104" textAnchor="middle" className="fill-[var(--c-text-3)]" style={{ fontSize: 11 }}>이달 새 고객</text>
        </svg>
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
