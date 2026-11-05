import { NextRequest, after } from 'next/server';
import { createJob, listJobs, deleteJob, getJob, updateJob, kickJob, reviveStalledJobs } from '@/lib/jobs';
import type { BlogRequest } from '@/config/blog-options';

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

/** PATCH /api/jobs?id=...&action=retry — 실패한 작업 다시 시작 (조사 결과가 있으면 작성부터) */
export async function PATCH(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  const action = request.nextUrl.searchParams.get('action');
  if (!id || action !== 'retry') return Response.json({ error: 'id와 action=retry가 필요합니다.' }, { status: 400 });
  const job = await getJob(id);
  if (!job) return Response.json({ error: '작업을 찾을 수 없습니다.' }, { status: 404 });
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
