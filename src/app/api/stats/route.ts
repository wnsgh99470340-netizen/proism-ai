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
    const [weekly, table] = await Promise.all([buildWeeklyStats(to, days), buildSourceTable(month)]);
    return Response.json({ weekly, table, tsv: sourceTableTsv(table) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
