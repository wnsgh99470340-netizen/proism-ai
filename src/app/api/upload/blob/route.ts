import { NextRequest } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

/**
 * 폰 영상 직접 업로드 토큰 (2026-11-11)
 * 브라우저가 Vercel Blob 으로 바로 올리므로(최대 500MB) 서버 함수 용량 제한을 타지 않는다.
 * 로그인 쿠키는 미들웨어가 확인한다.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith('uploads/talk/')) throw new Error('허용되지 않은 경로입니다.');
        return {
          allowedContentTypes: ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm'],
          maximumSizeInBytes: 500 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ kind: 'talk' }),
        };
      },
      onUploadCompleted: async () => { /* 작업 생성은 클라이언트가 /api/talk 로 요청 */ },
    });
    return Response.json(json);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '업로드 토큰 발급 실패' }, { status: 400 });
  }
}
