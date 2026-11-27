import { NextRequest } from 'next/server';
import { parseDriveFolderId, listDrivePhotosRecent, type DrivePhotoThumb } from '@/lib/drive';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** 5분 캐시 (서버 메모리, 폴더 id 키) */
const CACHE = new Map<string, { at: number; photos: DrivePhotoThumb[] }>();
const TTL = 5 * 60 * 1000;

/**
 * GET /api/drive/photos?folder=<url|id>&limit=12 — 차량 카드 드라이브 썸네일 (2026-11-27)
 * - 로그인 필요(미들웨어 기본 보호). 공유 폴더를 읽기만 하고 복사·쓰기 없음
 */
export async function GET(request: NextRequest) {
  const raw = (request.nextUrl.searchParams.get('folder') || '').trim();
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit')) || 12, 1), 30);
  const id = parseDriveFolderId(raw) || (/^[A-Za-z0-9_-]{10,}$/.test(raw) ? raw : null);
  if (!id) return Response.json({ error: '구글 드라이브 폴더 링크가 아닙니다' }, { status: 400 });
  const hit = CACHE.get(id);
  if (hit && Date.now() - hit.at < TTL) return Response.json({ photos: hit.photos.slice(0, limit), cached: true });
  try {
    const photos = await listDrivePhotosRecent(id, 30);
    CACHE.set(id, { at: Date.now(), photos });
    return Response.json({ photos: photos.slice(0, limit) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '폴더를 읽지 못했습니다', private: true }, { status: 403 });
  }
}
