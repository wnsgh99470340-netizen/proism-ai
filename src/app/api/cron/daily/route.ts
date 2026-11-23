import { NextRequest } from 'next/server';
import { put } from '@vercel/blob';
import { buildDailyBrief, saveTeamLog } from '@/lib/team';
import { advanceAppointmentsForToday } from '@/lib/appointments-flow';
import { sendPushToAll as sendPush } from '@/lib/push';
import { missedPushBody, urgentSummaryLine } from '@/lib/checkups';
import { buildMonthlyReport, monthlySummaryLines } from '@/lib/weekly-stats';
import { addDaysISO } from '@/lib/local-date';

export const maxDuration = 120;

/**
 * 매일 07:00 KST (vercel.json: 0 22 * * * UTC) — 마케팅팀 아침 준비 (2026-11-12)
 * 사후관리·상담 담당이 오늘 보낼 문자를 준비해 기록을 남기고, 사장님께 푸시 한 번.
 * Vercel 이 CRON_SECRET 을 Authorization: Bearer 로 붙여 호출한다.
 *
 * 요일·날짜별 추가 일 (2026-11-19 사장님 "내가 널 찾지 않아도 돌아갈 수 있는 시스템". Hobby 크론 2개 한도라 여기서 분기):
 *   월요일  → 지난주 숫자 한 줄(기존) + /api/cron/weekly-learn 깨우기(내 블로그 새 글 가져와 글 기준 갱신)
 *   금요일  → 빠진 것 알림 푸시(회원 링크 안 보낸 분·멈춘 예약·후기 답 없는 분). 홈 카드에는 매일 보인다
 *   매달 1일 → 지난달 숫자·유입경로 표를 Blob stats/YYYY-MM.json 에 남기고 푸시
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // 테스트용: ?as=YYYY-MM-DD 로 다른 날짜처럼 돌려 볼 수 있다 (크론 시크릿이 있어야 함)
  const asDate = request.nextUrl.searchParams.get('as') || undefined;
  // ?dry=1 이면 푸시·기록·학습 깨우기 없이 계산만 (테스트용)
  const dry = request.nextUrl.searchParams.get('dry') === '1';
  const sendPushToAll = dry ? async (_p: unknown) => ({ sent: 0, removed: 0, dry: true }) : sendPush;
  try {
    if (!dry) await advanceAppointmentsForToday(asDate).catch(() => 0); // 시작일이 된 예약확정 → 시공중 (2026-11-22)
    const brief = await buildDailyBrief(asDate);
    const logUrl = dry ? null : await saveTeamLog(brief).catch(() => null);
    const after = brief.lines.find(l => l.key === 'aftercare');
    const consult = brief.lines.find(l => l.key === 'consult');
    const parts = [
      after && after.status === 'ready' ? after.summary : '',
      consult && consult.status === 'ready' ? consult.summary : '',
      brief.weeklyLine || '',
      brief.missed ? urgentSummaryLine(brief.missed) : '', // 급한 점검(중복·지난 QC·끝난 예약)은 매일 (2026-11-23 "먼저 말 걸어 줘")
    ].filter(Boolean);
    const body = parts.length ? parts.join('\n') : '오늘 보낼 문자가 없습니다. 좋은 하루 되세요';
    const push = await sendPushToAll({ title: '☀️ 마케팅팀이 오늘 준비한 일', body, url: '/crm', tag: `team-${brief.date}` }).catch(() => ({ sent: 0, removed: 0 }));

    const weekday = new Date(`${brief.date}T12:00:00+09:00`).getUTCDay(); // 0 일 … 5 금
    const extras: Record<string, unknown> = {};

    // 금요일: 빠진 것 알림
    if (weekday === 5 && brief.missed && brief.missed.total > 0) {
      extras.missedPush = await sendPushToAll({ title: `🔎 이번 주 빠진 것 ${brief.missed.total}건`, body: missedPushBody(brief.missed), url: '/crm', tag: `missed-${brief.date}` }).catch(() => ({ sent: 0, removed: 0 }));
    }

    // 월요일: 내 블로그 글 자동 학습 (별도 함수가 after() 로 처리, 여기서는 깨우기만)
    if (weekday === 1 && dry) extras.weeklyLearn = 'dry: 깨우지 않음';
    if (weekday === 1 && !dry) {
      try {
        const res = await fetch(`${request.nextUrl.origin}/api/cron/weekly-learn`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-job-secret': secret }, body: '{}' });
        extras.weeklyLearn = res.status;
      } catch (e) { extras.weeklyLearn = e instanceof Error ? e.message : String(e); }
    }

    // 매달 1일: 지난달 숫자 정리
    if (brief.date.endsWith('-01')) {
      try {
        const month = addDaysISO(brief.date, -1).slice(0, 7);
        const report = await buildMonthlyReport(month);
        let url: string | null = null;
        if (process.env.BLOB_READ_WRITE_TOKEN && !dry) {
          const b = await put(`stats/${month}.json`, JSON.stringify(report), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
          url = b.url;
        }
        const lines = monthlySummaryLines(report);
        extras.monthly = { month, url, lines, push: await sendPushToAll({ title: `📊 ${Number(month.slice(5))}월 숫자 정리`, body: `${lines.join('\n')}\n홈 '이번 주 숫자' 카드에서 ‹ 로 지난달 표 복사`, url: '/crm', tag: `monthly-${month}` }).catch(() => ({ sent: 0, removed: 0 })) };
      } catch (e) { extras.monthly = { error: e instanceof Error ? e.message : String(e) }; }
    }

    return Response.json({ ok: true, date: brief.date, totals: brief.totals, lines: brief.lines.map(l => ({ key: l.key, status: l.status, summary: l.summary })), missed: brief.missed ? { total: brief.missed.total, groups: brief.missed.groups.map(g => ({ label: g.label, count: g.count })) } : null, logUrl, push, ...extras });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
