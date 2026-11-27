import { NextRequest } from 'next/server';
import { findFoldersForVehicle } from '@/lib/drive-sync';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/drive/find?vehicle_id= — 차량 카드 '폴더 찾기' (2026-11-27). 로그인 필요(미들웨어 기본 보호)
 * 그 손님의 시공·예약 달의 드라이브 폴더를 읽어(읽기만) 날짜·차종(·성함)이 맞는 폴더 후보를 돌려준다. 붙이기는 화면에서 사장님이 고른다
 */
export async function GET(request: NextRequest) {
  const id = (request.nextUrl.searchParams.get('vehicle_id') || '').trim();
  if (!/^[0-9a-f-]{8,}$/i.test(id)) return Response.json({ error: '차량 id 가 아닙니다' }, { status: 400 });
  try {
    const r = await findFoldersForVehicle(id);
    return Response.json(r, { status: r.error && !r.folders.length && r.error.includes('찾지 못') ? 404 : 200 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '드라이브를 읽지 못했습니다', folders: [] }, { status: 500 });
  }
}
