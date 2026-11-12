import { NextRequest } from 'next/server';
import { INSTAGRAM_VIDEO_PAUSED, INSTAGRAM_PAUSED_NOTE } from '@/config/features';
import { supabase } from '@/lib/supabase';
import { getJob, updateJob } from '@/lib/jobs';
import { dispatchRender, type TalkState, type TalkCue } from '@/lib/video';

/**
 * 사장님이 말하는 30초 (2026-11-11)
 * POST /api/talk { url, name }         — 업로드된(Vercel Blob) 폰 영상으로 자막·세로·연락처 카드 영상 작업을 만든다
 * PATCH /api/talk?id=JOB { cues? }      — 자막을 고쳐 다시 만들기(cues 없으면 음성 인식부터 다시)
 * GET /api/talk                          — 최근 말하기 작업 목록
 */
export async function POST(request: NextRequest) {
  if (INSTAGRAM_VIDEO_PAUSED) return Response.json({ error: INSTAGRAM_PAUSED_NOTE }, { status: 423 });
  try {
    const body = await request.json() as { url?: string; name?: string };
    const url = (body.url || '').trim();
    if (!/^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//.test(url)) {
      return Response.json({ error: '업로드된 영상 주소가 올바르지 않습니다.' }, { status: 400 });
    }
    const name = (body.name || '').trim() || '폰 영상';
    const talk: TalkState = { status: 'queued', source_url: url, source_name: name, queued_at: new Date().toISOString(), dispatched: false, error: null };
    const result = {
      reply: '🎤 말하기 영상 작업',
      draft: { title: `🎤 말하기 영상 — ${name}`, content: '', tags: [] as string[], category: '' },
      checks: null, draftId: null, target: null, talk,
    };
    const { data, error } = await supabase
      .from('blog_jobs')
      .insert({ status: 'done', message: `🎤 말하기 영상: ${name}`, request: null, result })
      .select()
      .single();
    if (error || !data) return Response.json({ error: `작업 저장 실패: ${error?.message || '알 수 없는 오류'}` }, { status: 500 });
    const dispatched = await dispatchRender(data.id);
    if (dispatched) await updateJob(data.id, { result: { ...result, talk: { ...talk, dispatched: true } } }).catch(() => {});
    return Response.json({ job: { ...data, result }, dispatched }, { status: 202 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '알 수 없는 오류' }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  if (INSTAGRAM_VIDEO_PAUSED) return Response.json({ error: INSTAGRAM_PAUSED_NOTE }, { status: 423 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'id가 필요합니다.' }, { status: 400 });
  const job = await getJob(id);
  const talk = job?.result?.talk;
  if (!job || !talk) return Response.json({ error: '말하기 영상 작업을 찾을 수 없습니다.' }, { status: 404 });
  let cues: TalkCue[] | undefined;
  try {
    const body = await request.json() as { cues?: TalkCue[] };
    if (Array.isArray(body.cues)) {
      cues = body.cues
        .map((c) => ({ start: Number(c.start), end: Number(c.end), text: String(c.text || '').trim() }))
        .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.text);
    }
  } catch { /* 본문 없으면 음성 인식부터 다시 */ }
  const next: TalkState = { ...talk, status: 'queued', error: null, url: null, thumbnail: null, queued_at: new Date().toISOString(), dispatched: false };
  if (cues) next.cues = cues; else delete next.cues;
  await updateJob(id, { result: { ...job.result!, talk: next } });
  const dispatched = await dispatchRender(id);
  if (dispatched) await updateJob(id, { result: { ...job.result!, talk: { ...next, dispatched: true } } }).catch(() => {});
  return Response.json({ ok: true, dispatched });
}
