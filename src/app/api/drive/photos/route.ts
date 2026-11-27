import { NextRequest } from 'next/server';
import { parseDriveFolderId, listDrivePhotosOrdered, pickSpread, type DrivePhotoThumb } from '@/lib/drive';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** 5분 캐시 (서버 메모리, 폴더 id 키) — 정렬된 전체 목록을 담고, 고르기는 응답 때 */
const CACHE = new Map<string, { at: number; all: DrivePhotoThumb[] }>();
const TTL = 5 * 60 * 1000;

/**
 * GET /api/drive/photos?folder=<url|id>&limit=8 — 차량 카드 드라이브 썸네일 (2026-11-27)
 * - 로그인 필요(미들웨어 기본 보호). 공유 폴더를 읽기만 하고 복사·쓰기 없음
 * - 폴더 전체를 촬영 순서에 가깝게 정렬한 뒤 고르게 limit 장(첫 장·마지막 장 포함) — 사장님 "전면·측면·후면·작업·클로즈업이 섞이게"
 */
export async function GET(request: NextRequest) {
  const raw = (request.nextUrl.searchParams.get('folder') || '').trim();
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit')) || 8, 1), 30);
  const id = parseDriveFolderId(raw) || (/^[A-Za-z0-9_-]{10,}$/.test(raw) ? raw : null);
  if (!id) return Response.json({ error: '구글 드라이브 폴더 링크가 아닙니다' }, { status: 400 });
  let all: DrivePhotoThumb[];
  const hit = CACHE.get(id);
  if (hit && Date.now() - hit.at < TTL) all = hit.all;
  else {
    try { all = await listDrivePhotosOrdered(id); CACHE.set(id, { at: Date.now(), all }); }
    catch (e) { return Response.json({ error: e instanceof Error ? e.message : '폴더를 읽지 못했습니다', private: true }, { status: 403 }); }
  }
  return Response.json({ total: all.length, photos: pickSpread(all, limit) });
}
