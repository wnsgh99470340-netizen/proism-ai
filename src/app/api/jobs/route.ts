import { NextRequest, after } from 'next/server';
import { createJob, listJobs, deleteJob, getJob, updateJob, kickJob, reviveStalledJobs } from '@/lib/jobs';
import { dispatchRender } from '@/lib/video';
import type { BlogRequest } from '@/config/blog-options';
import { resolveTarget, isAutoBlogService } from '@/lib/blog-research';

export const maxDuration = 60;

/** GET /api/jobs?limit=20 — 최근 작업 목록 (멈춘 작업은 다시 깨운다) */
export async function GET(request: NextRequest) {
  const limit = Number(request.nextUrl.searchParams.get('limit') || 20);
  const jobs = await listJobs(Math.min(Math.max(limit, 1), 50));
  const revived = await reviveStalledJobs(request.nextUrl.origin, jobs);
  return Response.json({ jobs: revived });
}

/** POST /api/jobs { message, request } — 접수 후 즉시 반환, 조사 단계는 서버가 이어서 실행 */
export async function POST(request: NextRequest) {
  try {
    const { message = '', request: blogRequest = null } = await request.json() as { message?: string; request?: BlogRequest | null };
    if (!message.trim()) return Response.json({ error: '메시지가 필요합니다.' }, { status: 400 });
    // 폼·CRM 버튼(자동 생성)은 PPF·컬러PPF·랩핑·크롬죽이기만. 채팅으로 직접 쓴 요청은 모든 시공 허용 (2026-11-05 사장님 결정)
    const target = resolveTarget(message, blogRequest);
    if (blogRequest && !isAutoBlogService(target.serviceType)) {
      return Response.json({
        excluded: true,
        error: `${target.serviceType === '시공' ? '시공 종류를 알 수 없는 요청은' : `${target.serviceType} 시공기는`} 자동 생성 대상이 아닙니다. 자동 생성은 PPF·컬러PPF·랩핑·크롬죽이기만 됩니다.`,
      }, { status: 400 });
    }

    const { job, error } = await createJob(message.trim(), blogRequest);
    if (!job) {
      return Response.json({ error: `작업 접수 실패: ${error || '알 수 없는 오류'} (Supabase에 blog_jobs 테이블이 있는지 확인)` }, { status: 500 });
    }
    const origin = request.nextUrl.origin;
    after(async () => { await kickJob(origin, job.id); });
    return Response.json({ job }, { status: 202 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '알 수 없는 오류' }, { status: 500 });
  }
}

/**
 * PATCH /api/jobs?id=...&action=retry — 실패한 작업 다시 시작 (조사 결과가 있으면 작성부터)
 * PATCH /api/jobs?id=...&action=dispatch — 대기 중인 영상 작업의 깃허브 액션만 바로 깨운다 (렌더 설정은 그대로, 2026-11-13 토큰 연결 확인용)
 */
export async function PATCH(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  const action = request.nextUrl.searchParams.get('action');
  if (!id || (action !== 'retry' && action !== 'dispatch')) return Response.json({ error: 'id와 action=retry|dispatch가 필요합니다.' }, { status: 400 });
  const job = await getJob(id);
  if (!job) return Response.json({ error: '작업을 찾을 수 없습니다.' }, { status: 404 });
  if (action === 'dispatch') {
    const hasToken = Boolean(process.env.GITHUB_DISPATCH_TOKEN);
    const dispatched = hasToken ? await dispatchRender(id) : false;
    return Response.json({ ok: dispatched, hasToken, dispatched, note: dispatched ? '깃허브 액션을 깨웠습니다' : hasToken ? '토큰은 있지만 깃허브가 거부했습니다 (권한 확인)' : 'GITHUB_DISPATCH_TOKEN 이 없습니다' });
  }
  const status = job.research ? 'writing' : 'queued';
  await updateJob(id, { status, error: null, attempts: 0 });
  const origin = request.nextUrl.origin;
  after(async () => { await kickJob(origin, id); });
  return Response.json({ ok: true, status });
}

/** DELETE /api/jobs?id=... */
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'id가 필요합니다.' }, { status: 400 });
  return Response.json({ ok: await deleteJob(id) });
}
