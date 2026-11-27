import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/drive/file?id=<fileId>&name=<파일명> — 드라이브 사진 원본을 받아 그대로 넘김 (2026-11-27 사장님 "사진 저장 눌러서 바로 내 핸드폰 갤러리로")
 * - 로그인 필요(미들웨어 기본 보호). 공유 폴더 파일을 읽기만 함, 저장·복사 없음
 * - 폰에서 navigator.share({files}) 로 갤러리·카톡에 넘기려고 같은 주소(origin)에서 받는다
 */
export async function GET(request: NextRequest) {
  const id = (request.nextUrl.searchParams.get('id') || '').trim();
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return Response.json({ error: '파일 id 가 아닙니다' }, { status: 400 });
  const rawName = (request.nextUrl.searchParams.get('name') || `${id}.jpg`).replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120);
  const tries = [`https://lh3.googleusercontent.com/d/${id}=s0`, `https://drive.google.com/uc?export=download&id=${id}`];
  for (const url of tries) {
    try {
      const res = await fetch(url, { cache: 'no-store', redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !res.body || !type.startsWith('image/')) continue;
      return new Response(res.body, {
        headers: {
          'content-type': type,
          'content-disposition': `attachment; filename="${encodeURIComponent(rawName)}"; filename*=UTF-8''${encodeURIComponent(rawName)}`,
          'cache-control': 'private, max-age=300',
        },
      });
    } catch { /* 다음 주소 */ }
  }
  return Response.json({ error: '사진을 받지 못했습니다. 폴더 공유가 "링크가 있는 모든 사용자 보기"인지 확인해 주세요' }, { status: 502 });
}
