/**
 * 시공기 영상 자동 제작 — 앱 쪽 (2026-11-11)
 * - 글이 완성되면 요청에 든 구글 드라이브 폴더에서 사진 목록을 읽어 blog_jobs.result.video 에 "queued" 로 적는다
 * - 실제 렌더링은 깃허브 액션(.github/workflows/render-video.yml)이 한다. GITHUB_DISPATCH_TOKEN 이 있으면 바로 깨우고,
 *   없으면 10분 주기 스케줄이 집어간다
 * - 결과(mp4 주소·자막 계획·제외 사진)는 액션이 같은 자리에 적고, 화면은 /api/jobs 폴링으로 본다
 */
import { listDriveFolder, type DriveFile } from './drive';
import { extractDriveUrl } from './blog-generate';
import type { BlogRequest } from '@/config/blog-options';

export type VideoStatus = 'queued' | 'rendering' | 'done' | 'failed';

export interface VideoPlanSummary {
  title?: string;
  subtitle?: string;
  chapters?: string[];
  photos?: number;
  clips?: number;
  excluded?: { name: string; reason: string }[];
}

export interface VideoState {
  status: VideoStatus;
  folder?: string;
  photos?: { id: string; name: string; url: string; kind: 'photo' | 'video' }[];
  vertical?: boolean;
  bgm?: { name: string; url: string };
  plan?: VideoPlanSummary;
  url?: string | null;
  vertical_url?: string | null;
  contact_sheet?: string | null;
  /** 첫 장면(완성 사진+제목) 이미지. 네이버 대표 이미지·앱 포스터용 */
  thumbnail?: string | null;
  duration?: number | null;
  photos_used?: number | null;
  excluded?: { name: string; reason: string }[];
  error?: string | null;
  queued_at?: string;
  started_at?: string;
  finished_at?: string;
  /** 바로 깨우기(디스패치)가 됐는지. false 면 10분 주기 스케줄을 기다림 */
  dispatched?: boolean;
}

const REPO = process.env.GITHUB_REPO || 'wnsgh99470340-netizen/proism-ai';

/** 요청(폼 또는 채팅 문장)에서 사진 폴더 링크 찾기 */
export function findPhotosUrl(message: string, request: BlogRequest | null): string | null {
  return request?.photosUrl?.trim() || extractDriveUrl(message);
}

/** 드라이브 폴더를 읽어 queued 상태의 video 객체를 만든다. 사진이 없으면 에러를 던진다 */
export async function buildQueuedVideo(photosUrl: string, vertical: boolean): Promise<VideoState> {
  const { folderId, files } = await listDriveFolder(photosUrl);
  const photos = files.map((f: DriveFile) => ({ id: f.id, name: f.name, url: f.url, kind: f.kind === 'video' ? 'video' as const : 'photo' as const }));
  return { status: 'queued', folder: folderId, photos, vertical, queued_at: new Date().toISOString(), dispatched: false };
}

/** 깃허브 액션을 바로 깨운다. 토큰이 없거나 실패하면 false (스케줄이 대신 처리) */
export async function dispatchRender(jobId: string): Promise<boolean> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_type: 'render-video', client_payload: { job_id: jobId } }),
    });
    if (res.status === 204) return true;
    console.warn('[video] dispatch failed:', res.status, await res.text());
    return false;
  } catch (e) {
    console.warn('[video] dispatch error:', e);
    return false;
  }
}

/** 상태를 사람이 읽는 한 줄로 */
export function describeVideo(v: VideoState | undefined | null): string {
  if (!v) return '';
  switch (v.status) {
    case 'queued': return v.dispatched ? '영상 제작 대기 중 (곧 시작)' : '영상 제작 대기 중 (10분 안에 시작)';
    case 'rendering': return '영상 만드는 중 (3~6분)';
    case 'done': return `영상 완성${v.duration ? ` · ${Math.round(v.duration)}초` : ''}${v.photos_used ? ` · 사진 ${v.photos_used}장` : ''}`;
    case 'failed': return `영상 제작 실패: ${v.error || '원인 미상'}`;
    default: return '';
  }
}
