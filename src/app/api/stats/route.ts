import { NextRequest } from 'next/server';
import { buildWeeklyStats, buildSourceTable, sourceTableTsv } from '@/lib/weekly-stats';

export const maxDuration = 30;

/**
 * GET /api/stats[?to=YYYY-MM-DD&days=7&month=YYYY-MM] — 홈 "이번 주 숫자" 카드 (2026-11-18)
 * weekly: 지난 N일 숫자 / table: 그 달 날짜×유입경로 표 / tsv: 시트에 붙일 텍스트. 로그인 쿠키는 미들웨어가 확인
 */
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams;
    const to = q.get('to') || undefined;
    const days = Math.min(31, Math.max(1, Number(q.get('days') || 7)));
    const month = q.get('month') || undefined;
    // range=month (2026-11-23 사장님 "주간이 아니라 월간으로"): 그 달 1일 ~ (이번 달이면 오늘, 지난 달이면 말일)
    let weeklyP = buildWeeklyStats(to, days);
    if (q.get('range') === 'month' && month && /^\d{4}-\d{2}$/.test(month)) {
      const today = new Date(new Date().getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const [y, m] = month.split('-').map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;
      const end = monthEnd < today ? monthEnd : (today.slice(0, 7) === month ? today : monthEnd);
      weeklyP = buildWeeklyStats(end, 31, `${month}-01`);
    }
    const [weekly, table] = await Promise.all([weeklyP, buildSourceTable(month)]);
    return Response.json({ weekly, table, tsv: sourceTableTsv(table) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
