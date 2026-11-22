import { NextRequest } from 'next/server';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * 점검 사진 올리기 (2026-11-22): QC·메인터넌스 완료 때 찍은 사진을 Blob uploads/care/ 에 저장
 * - 상담 사진(/api/consult/photo)과 달리 비전 읽기 없음. 로그인 쿠키는 미들웨어가 확인
 * - 주소는 손님 회원 페이지에도 보이므로 개인정보가 찍힌 사진(번호판 클로즈업 등)은 사장님이 가려 올린다
 */
export async function POST(request: NextRequest) {
  try {
    const { data, mediaType, name } = (await request.json()) as { data?: string; mediaType?: string; name?: string };
    if (!data || !mediaType || !/^image\/(jpeg|png|webp)$/.test(mediaType)) {
      return Response.json({ error: '이미지 파일만 올릴 수 있습니다.' }, { status: 400 });
    }
    const buf = Buffer.from(data, 'base64');
    if (buf.length > 4 * 1024 * 1024) return Response.json({ error: '4MB 이하 이미지만 올릴 수 있습니다.' }, { status: 400 });
    const ext = mediaType === 'image/png' ? 'png' : mediaType === 'image/webp' ? 'webp' : 'jpg';
    const safe = (name || 'care').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'care';
    const blob = await put(`uploads/care/${Date.now()}_${safe}.${ext}`, buf, { access: 'public', contentType: mediaType, addRandomSuffix: true });
    return Response.json({ url: blob.url });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '업로드 실패' }, { status: 500 });
  }
}
