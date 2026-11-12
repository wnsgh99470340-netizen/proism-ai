import { NextRequest } from 'next/server';
import { buildDailyBrief, saveTeamLog } from '@/lib/team';
import { sendPushToAll } from '@/lib/push';

export const maxDuration = 60;

/**
 * 매일 07:00 KST (vercel.json: 0 22 * * * UTC) — AI 팀 아침 준비 (2026-11-12)
 * 사후관리·상담 담당이 오늘 보낼 문자를 준비해 기록을 남기고, 사장님께 푸시 한 번.
 * Vercel 이 CRON_SECRET 을 Authorization: Bearer 로 붙여 호출한다.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const brief = await buildDailyBrief();
    const logUrl = await saveTeamLog(brief).catch(() => null);
    const after = brief.lines.find(l => l.key === 'aftercare');
    const consult = brief.lines.find(l => l.key === 'consult');
    const parts = [
      after && after.status === 'ready' ? after.summary : '',
      consult && consult.status === 'ready' ? consult.summary : '',
    ].filter(Boolean);
    const body = parts.length ? parts.join('\n') : '오늘 보낼 문자가 없습니다. 좋은 하루 되세요';
    const push = await sendPushToAll({ title: '☀️ 마케팅팀이 오늘 준비한 일', body, url: '/crm', tag: `team-${brief.date}` }).catch(() => ({ sent: 0, removed: 0 }));
    return Response.json({ ok: true, date: brief.date, totals: brief.totals, lines: brief.lines.map(l => ({ key: l.key, status: l.status, summary: l.summary })), logUrl, push });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
