import { NextRequest } from 'next/server';
import { isBlogWriteRequest, resolveTarget, researchForBlogPost } from '@/lib/blog-research';
import type { BlogRequest } from '@/config/blog-options';
import { findPhotosUrl } from '@/lib/video';
import { inspectPhotos } from '@/lib/photo-check';

// 웹 검색 리서치는 수 분 걸릴 수 있어 글 작성(/api/chat)과 분리해 실행시간을 나눈다
export const maxDuration = 300;

/**
 * 블로그 글 작성 전 사전 조사 전용 엔드포인트
 * 입력: { message }
 * 출력: { needed, carModel, serviceType, research: { context, summary } | null }
 */
export async function POST(request: NextRequest) {
  try {
    const { message = '', request: blogRequest = null } = await request.json() as { message?: string; request?: BlogRequest | null };

    if (!blogRequest && !isBlogWriteRequest(message)) {
      return Response.json({ needed: false, research: null });
    }

    const { carModel, serviceType } = resolveTarget(message, blogRequest);
    if (!carModel) {
      return Response.json({ needed: false, research: null });
    }

    let research = await researchForBlogPost(message, carModel, serviceType);
    // 사진 폴더 링크가 있으면 글 쓰기 전에 사진부터 확인
    const photosUrl = findPhotosUrl(message, blogRequest);
    if (photosUrl) {
      try {
        const pf = await inspectPhotos(photosUrl, { carModel, serviceType });
        research = { context: [research.context, pf.context].filter(Boolean).join('\n\n'), summary: [research.summary, pf.summary].filter(Boolean).join('\n') };
      } catch (e) {
        research = { ...research, summary: [research.summary, `⚠️ 사진 확인 실패: ${e instanceof Error ? e.message : String(e)}`].filter(Boolean).join('\n') };
      }
    }

    return Response.json({ needed: true, carModel, serviceType, research });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    return Response.json({ error: msg }, { status: 500 });
  }
}
