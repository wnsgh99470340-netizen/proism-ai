import { NextRequest } from 'next/server';
import { staffToken } from '@/lib/staff-page';

export const runtime = 'nodejs';

/** GET /api/staff/manifest?token= — 직원 폰 홈 화면 추가용 매니페스트 (2026-11-27) */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') || '';
  const expected = staffToken();
  if (!expected || token !== expected) return Response.json({ error: 'not found' }, { status: 404 });
  return new Response(JSON.stringify({
    name: '프로이즘 예약',
    short_name: '예약',
    description: '3M 프로이즘 강남서초점 예약 일정 (읽기 전용)',
    lang: 'ko',
    id: `/s/${token}`,
    start_url: `/s/${token}`,
    scope: `/s/${token}`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f5f5f6',
    theme_color: '#E4002B',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }), { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-store' } });
}
