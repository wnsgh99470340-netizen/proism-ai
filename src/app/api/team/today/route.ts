import { NextRequest } from 'next/server';
import { buildDailyBrief, listTeamLogs } from '@/lib/team';

export const maxDuration = 30;

/** GET /api/team/today[?date=YYYY-MM-DD] — 홈 "오늘 AI가 한 일" 실시간 계산본 (로그인 쿠키는 미들웨어가 확인) */
export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date') || undefined;
    const [brief, logs] = await Promise.all([buildDailyBrief(date), listTeamLogs(7).catch(() => [])]);
    return Response.json({ brief, logs });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
