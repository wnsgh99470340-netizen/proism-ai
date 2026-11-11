import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getJob, updateJob } from '@/lib/jobs';
import { buildQueuedVideo, dispatchRender } from '@/lib/video';
import { sendPushToAll } from '@/lib/push';

/**
 * 영상 전용 작업 (2026-11-11)
 * POST /api/video { draftId, title, content, photosUrl, vertical, target }
 *   — 이미 완성된(또는 불러온) 글에 사진 폴더 링크만 붙여 영상을 만든다. blog_jobs 에 status=done 행을 만들고 result.video=queued
 * PATCH /api/video?id=JOB_ID — 실패한 영상을 다시 만든다 (사진 목록은 그대로, BGM 도 유지)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      draftId?: string | null; title?: string; content?: string; photosUrl?: string; vertical?: boolean;
      target?: { carModel?: string | null; serviceType?: string | null; product?: string | null; region?: string | null } | null;
    };
    const photosUrl = (body.photosUrl || '').trim();
    if (!body.title || !body.content) return Response.json({ error: '글 제목과 본문이 필요합니다.' }, { status: 400 });
    if (!photosUrl) return Response.json({ error: '구글 드라이브 폴더 링크가 필요합니다.' }, { status: 400 });

    const video = await buildQueuedVideo(photosUrl, Boolean(body.vertical));
    const result = {
      reply: '🎬 영상 전용 작업',
      draft: { title: body.title, content: body.content, tags: [] as string[], category: '' },
      checks: null,
      draftId: body.draftId ?? null,
      target: body.target ? { carModel: body.target.carModel ?? null, serviceType: body.target.serviceType ?? '', product: body.target.product ?? null, region: body.target.region ?? null } : null,
      video,
    };
    const { data, error } = await supabase
      .from('blog_jobs')
      .insert({ status: 'done', message: `🎬 영상 만들기: ${body.title}`, request: null, result })
      .select()
      .single();
    if (error || !data) return Response.json({ error: `작업 저장 실패: ${error?.message || '알 수 없는 오류'}` }, { status: 500 });

    const dispatched = await dispatchRender(data.id);
    if (dispatched) await updateJob(data.id, { result: { ...result, video: { ...video, dispatched: true } } }).catch(() => {});
    return Response.json({ job: { ...data, result: { ...result, video: { ...video, dispatched } } }, photos: video.photos?.length ?? 0 }, { status: 202 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '알 수 없는 오류' }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'id가 필요합니다.' }, { status: 400 });
  const job = await getJob(id);
  const video = job?.result?.video;
  if (!job || !video) return Response.json({ error: '영상 작업을 찾을 수 없습니다.' }, { status: 404 });
  const next = { ...video, status: 'queued' as const, error: null, url: null, vertical_url: null, contact_sheet: null, queued_at: new Date().toISOString(), dispatched: false };
  await updateJob(id, { result: { ...job.result!, video: next } });
  const dispatched = await dispatchRender(id);
  if (dispatched) await updateJob(id, { result: { ...job.result!, video: { ...next, dispatched: true } } }).catch(() => {});
  await sendPushToAll({ title: '🎬 영상 다시 만드는 중', body: job.result?.draft?.title || '', url: '/', tag: `video-${id}` }).catch(() => {});
  return Response.json({ ok: true, dispatched });
}
