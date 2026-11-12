/**
 * 블로그 글 백그라운드 작업 (Supabase blog_jobs)
 * - 폰 화면을 꺼도 서버가 접수 → 조사 → 작성 → 채널 변환까지 스스로 이어간다
 * - 각 단계는 별도의 서버 함수 호출로 실행되고(단계당 최대 300초), 끝나면 다음 단계를 다시 호출한다
 */
import { supabase } from './supabase';
import { researchForBlogPost, resolveTarget } from './blog-research';
import { generateBlogPost, type WriterResult } from './blog-generate';
import { generateChannels, type Channels } from './channels';
import type { BlogRequest } from '@/config/blog-options';
import { sendPushToAll } from './push';
import { findPhotosUrl, buildQueuedVideo, dispatchRender, findReusableVideo, type VideoState } from './video';
import { inspectPhotos } from './photo-check';

export type JobStatus = 'queued' | 'researching' | 'writing' | 'channels' | 'done' | 'failed';

export interface BlogJob {
  id: string;
  status: JobStatus;
  message: string;
  request: BlogRequest | null;
  research: { context: string; summary: string } | null;
  result: WriterResult | null;
  channels: Channels | null;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export const ACTIVE_STATUSES: JobStatus[] = ['queued', 'researching', 'writing', 'channels'];
/** 이 시간 동안 갱신이 없으면 멈춘 것으로 보고 다시 깨운다 */
export const STALL_MS = 8 * 60 * 1000;
/** 멈춘 작업을 다시 깨우는 최대 횟수 */
export const MAX_RETRIES = 2;

export function isActive(job: BlogJob): boolean {
  return ACTIVE_STATUSES.includes(job.status);
}

export function isStalled(job: BlogJob): boolean {
  return isActive(job) && Date.now() - new Date(job.updated_at).getTime() > STALL_MS;
}

export async function createJob(message: string, request: BlogRequest | null): Promise<{ job: BlogJob | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('blog_jobs')
      .insert({ status: 'queued', message, request })
      .select()
      .single();
    if (error) return { job: null, error: error.message };
    return { job: data as BlogJob, error: null };
  } catch (e) {
    return { job: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getJob(id: string): Promise<BlogJob | null> {
  const { data, error } = await supabase.from('blog_jobs').select('*').eq('id', id).single();
  if (error) return null;
  return data as BlogJob;
}

export async function listJobs(limit = 20): Promise<BlogJob[]> {
  try {
    const { data, error } = await supabase
      .from('blog_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data || []) as BlogJob[];
  } catch {
    return [];
  }
}

export async function deleteJob(id: string): Promise<boolean> {
  const { error } = await supabase.from('blog_jobs').delete().eq('id', id);
  return !error;
}

export async function updateJob(id: string, patch: Partial<BlogJob>): Promise<void> {
  const { error } = await supabase
    .from('blog_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`작업 상태 저장 실패: ${error.message}`);
}

/** 다음 단계를 실행할 서버 함수를 호출한다 (응답은 즉시 202, 실제 작업은 그 함수 안에서) */
export async function kickJob(origin: string, id: string): Promise<void> {
  const base = origin || process.env.NEXT_PUBLIC_BASE_URL || '';
  try {
    await fetch(`${base}/api/jobs/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-job-secret': process.env.CRON_SECRET || '' },
      body: JSON.stringify({ id }),
    });
  } catch (e) {
    console.warn('[jobs] kick failed:', e);
  }
}

/**
 * 현재 상태에 맞는 단계 하나만 실행하고 다음 상태를 돌려준다.
 * queued/researching → 조사 → writing → 작성 → channels → 인스타·카페 → done
 */
export async function runNextStep(id: string): Promise<JobStatus> {
  const job = await getJob(id);
  if (!job) return 'failed';
  if (!isActive(job)) return job.status;

  try {
    if (job.status === 'queued' || job.status === 'researching') {
      await updateJob(id, { status: 'researching' });
      const t = resolveTarget(job.message, job.request);
      let research: BlogJob['research'] = null;
      if (t.carModel) research = await researchForBlogPost(job.message, t.carModel, t.serviceType);
      // 사진 폴더 링크가 있으면 글 쓰기 전에 사진부터 확인 (차량 색상·보이는 부위)
      const photosUrl = findPhotosUrl(job.message, job.request);
      if (photosUrl) {
        try {
          const pf = await inspectPhotos(photosUrl, { carModel: t.carModel, serviceType: t.serviceType });
          research = { context: [research?.context, pf.context].filter(Boolean).join('\n\n'), summary: [research?.summary, pf.summary].filter(Boolean).join('\n') };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          research = { context: research?.context || '', summary: [research?.summary, `⚠️ 사진 확인 실패: ${msg}`].filter(Boolean).join('\n') };
        }
      }
      await updateJob(id, { status: 'writing', research });
      return 'writing';
    }

    if (job.status === 'writing') {
      const result = await generateBlogPost({ message: job.message, request: job.request, research: job.research });
      if (!result.draft) throw new Error(`글 형식으로 완성되지 않았습니다: ${result.reply.slice(0, 200)}`);
      await updateJob(id, { status: 'channels', result });
      return 'channels';
    }

    if (job.status === 'channels') {
      let channels: Channels | null = null;
      const r = job.result;
      if (r?.draft) {
        try {
          channels = await generateChannels(r.draft.title, r.draft.content, r.target?.serviceType || '', r.target?.carModel || '');
        } catch (e) {
          console.warn('[jobs] channels failed:', e);
        }
      }
      // 사진 폴더 링크가 있으면 영상 작업을 result.video 에 queued 로 적고 깃허브 액션을 깨운다
      let result = r;
      let videoNote = '';
      const photosUrl = findPhotosUrl(job.message, job.request);
      if (r?.draft && photosUrl) {
        let video: VideoState;
        try {
          video = await buildQueuedVideo(photosUrl, Boolean(job.request?.vertical));
          // 같은 폴더로 이미 만든 영상이 있으면 그대로 쓴다(글만 다시 만든 경우). 새로 만들려면 영상 탭 '다시 만들기'
          const reusable = video.folder ? await findReusableVideo(video.folder, Boolean(job.request?.vertical), id).catch(() => null) : null;
          if (reusable) {
            video = { ...reusable, photos: video.photos, vertical: Boolean(job.request?.vertical) };
            videoNote = '\n🎬 같은 사진 폴더로 만든 영상을 그대로 씁니다.';
          } else {
            videoNote = `\n🎬 사진 ${video.photos?.length ?? 0}장으로 영상을 만듭니다.`;
          }
        } catch (e) {
          video = { status: 'failed', error: e instanceof Error ? e.message : String(e), queued_at: new Date().toISOString() };
          videoNote = `\n⚠️ 영상: ${video.error}`;
        }
        result = { ...r, video };
      }
      await updateJob(id, { status: 'done', channels, result });
      if (result?.video?.status === 'queued') {
        const dispatched = await dispatchRender(id);
        if (dispatched) await updateJob(id, { result: { ...result, video: { ...result.video, dispatched: true } } }).catch(() => {});
      }
      const title = r?.draft?.title || '블로그 글';
      await sendPushToAll({ title: '✅ 시공기 완성', body: `${title}${videoNote}\n앱에서 미리보기를 확인하세요.`, url: '/', tag: `job-${id}` }).catch(() => {});
      return 'done';
    }

    return job.status;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try { await updateJob(id, { status: 'failed', error: msg }); } catch { /* ignore */ }
    await sendPushToAll({ title: '⚠️ 시공기 생성 실패', body: `${msg.slice(0, 100)}\n앱에서 다시 시도할 수 있습니다.`, url: '/', tag: `job-${id}` }).catch(() => {});
    return 'failed';
  }
}

/** 멈춘 작업 점검: 재시도 횟수가 남았으면 다시 깨우고, 아니면 실패 처리 */
export async function reviveStalledJobs(origin: string, jobs: BlogJob[]): Promise<BlogJob[]> {
  const out: BlogJob[] = [];
  for (const job of jobs) {
    if (!isStalled(job)) { out.push(job); continue; }
    if (job.attempts >= MAX_RETRIES) {
      const error = '응답이 너무 오래 없어 중단했습니다. 다시 시도해주세요.';
      try { await updateJob(job.id, { status: 'failed', error }); } catch { /* ignore */ }
      out.push({ ...job, status: 'failed', error });
      continue;
    }
    try { await updateJob(job.id, { attempts: job.attempts + 1 }); } catch { /* ignore */ }
    await kickJob(origin, job.id);
    out.push({ ...job, attempts: job.attempts + 1, updated_at: new Date().toISOString() });
  }
  return out;
}
