import { NextRequest } from 'next/server';
import { put } from '@vercel/blob';
import { analyzeImageWithClaude } from '@/lib/claude-client';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 상담 기록 사진 첨부 (2026-11-11 사장님: "고객 전화번호 캡처해서 올리는 게 더 편함")
 * - 브라우저가 줄인 이미지를 base64 로 보내면 Vercel Blob(uploads/consult/)에 저장하고
 * - Claude 비전으로 캡처 속 이름·전화번호·차종을 읽어 돌려준다 (못 읽으면 빈 값)
 * 로그인 쿠키는 미들웨어가 확인한다.
 */
export async function POST(request: NextRequest) {
  try {
    const { data, mediaType, name } = (await request.json()) as { data?: string; mediaType?: string; name?: string };
    if (!data || !mediaType || !/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
      return Response.json({ error: '이미지 파일만 올릴 수 있습니다.' }, { status: 400 });
    }
    const buf = Buffer.from(data, 'base64');
    if (buf.length > 4 * 1024 * 1024) return Response.json({ error: '4MB 이하 이미지만 올릴 수 있습니다.' }, { status: 400 });

    const ext = mediaType === 'image/png' ? 'png' : mediaType === 'image/webp' ? 'webp' : mediaType === 'image/gif' ? 'gif' : 'jpg';
    const safe = (name || 'photo').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'photo';
    const blob = await put(`uploads/consult/${Date.now()}_${safe}.${ext}`, buf, { access: 'public', contentType: mediaType, addRandomSuffix: true });

    // 캡처에서 연락처 읽기 (실패해도 사진 첨부는 성공으로)
    let extracted: { name: string; phone: string; car: string } = { name: '', phone: '', car: '' };
    try {
      const raw = await analyzeImageWithClaude(
        data,
        mediaType,
        '이 이미지는 자동차 시공점 사장님이 고객 상담 기록용으로 올린 캡처입니다(통화 기록·문자·카톡·명함 등). ' +
          '이미지에서 고객 이름, 휴대폰 번호(010으로 시작하는 한국 번호), 차종을 찾아 JSON 한 개로만 답하세요. ' +
          '형식: {"name":"","phone":"","car":""}. 없는 항목은 빈 문자열. 번호는 숫자와 하이픈만. 설명 문장 금지.',
      );
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const j = JSON.parse(m[0]) as Partial<typeof extracted>;
        const digits = String(j.phone || '').replace(/[^\d]/g, '');
        extracted = {
          name: String(j.name || '').trim().slice(0, 20),
          phone: digits.length === 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}` : digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : '',
          car: String(j.car || '').trim().slice(0, 30),
        };
      }
    } catch (e) {
      console.warn('[consult/photo] 연락처 추출 실패:', e instanceof Error ? e.message : e);
    }

    return Response.json({ url: blob.url, ...extracted });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '업로드 실패' }, { status: 500 });
  }
}
