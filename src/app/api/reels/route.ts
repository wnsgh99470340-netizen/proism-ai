import { NextRequest } from 'next/server';
import { getJob, updateJob } from '@/lib/jobs';
import { dispatchRender, buildQueuedVideo, type ReelsState } from '@/lib/video';

/**
 * 정보 릴스 (2026-11-11)
 * POST /api/reels { jobId, count?, photosUrl? }
 *   — 그 글의 사진(블로그 영상용으로 연결된 폴더)으로 릴스 대본 2~3개를 뽑고 전부 렌더하도록 queued 로 적는다.
 *     사진이 아직 없으면 photosUrl(구글 드라이브 폴더)로 사진 목록을 먼저 만든다.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { jobId?: string; count?: number; photosUrl?: string };
    if (!body.jobId) return Response.json({ error: 'jobId가 필요합니다.' }, { status: 400 });
    const job = await getJob(body.jobId);
    if (!job?.result?.draft) return Response.json({ error: '글 작업을 찾을 수 없습니다.' }, { status: 404 });

    let result = job.result;
    const hasPhotos = (result.video?.photos?.length ?? 0) > 0;
    if (!hasPhotos) {
      const photosUrl = (body.photosUrl || '').trim();
      if (!photosUrl) return Response.json({ error: '이 글에 연결된 사진이 없습니다. 구글 드라이브 폴더 링크를 넣어 주세요.' }, { status: 400 });
      const video = await buildQueuedVideo(photosUrl, false);
      // 블로그 영상은 만들지 않고 사진 목록만 쓴다 (status 는 skipped 가 아니라 failed 로 두지 않도록 별도 표시)
      result = { ...result, video: { ...video, status: result.video?.status === 'done' ? 'done' : 'failed', error: result.video?.error ?? '릴스용 사진만 연결됨', url: result.video?.url ?? null } };
    }
    const count = Math.max(1, Math.min(4, Number(body.count) || 3));
    const reels: ReelsState = { status: 'queued', count, items: [], queued_at: new Date().toISOString(), dispatched: false, error: null };
    result = { ...result, reels };
    await updateJob(job.id, { result });
    const dispatched = await dispatchRender(job.id);
    if (dispatched) await updateJob(job.id, { result: { ...result, reels: { ...reels, dispatched: true } } }).catch(() => {});
    return Response.json({ ok: true, dispatched, photos: result.video?.photos?.length ?? 0 }, { status: 202 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '알 수 없는 오류' }, { status: 400 });
  }
}
