import { NextRequest, after } from 'next/server';
import { runNextStep, kickJob } from '@/lib/jobs';

// 단계 하나(조사 / 작성 / 채널)를 이 함수 안에서 끝까지 실행
export const maxDuration = 300;

/**
 * POST /api/jobs/run { id }
 * 서버 내부 호출(x-job-secret) 또는 로그인 쿠키로만 허용. 즉시 202를 돌려주고 after()에서 단계를 실행한 뒤
 * 남은 단계가 있으면 자기 자신을 다시 호출한다.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const secretOk = Boolean(secret) && request.headers.get('x-job-secret') === secret;
  const cookieOk = request.cookies.get('crm_auth')?.value === 'authenticated';
  if (!secretOk && !cookieOk) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let id = '';
  try { id = String((await request.json()).id || ''); } catch { /* fallthrough */ }
  if (!id) return Response.json({ error: 'id가 필요합니다.' }, { status: 400 });

  const origin = request.nextUrl.origin;
  after(async () => {
    const next = await runNextStep(id);
    if (next !== 'done' && next !== 'failed') await kickJob(origin, id);
  });

  return Response.json({ accepted: true, id }, { status: 202 });
}
