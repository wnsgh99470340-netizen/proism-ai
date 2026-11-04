import { NextRequest } from 'next/server';
import {
  isBlogWriteRequest,
  extractCarModel,
  extractServiceType,
  researchForBlogPost,
} from '@/lib/blog-research';

// 웹 검색 리서치는 수 분 걸릴 수 있어 글 작성(/api/chat)과 분리해 실행시간을 나눈다
export const maxDuration = 300;

/**
 * 블로그 글 작성 전 사전 조사 전용 엔드포인트
 * 입력: { message }
 * 출력: { needed, carModel, serviceType, research: { context, summary } | null }
 */
export async function POST(request: NextRequest) {
  try {
    const { message = '' } = await request.json() as { message?: string };

    if (!isBlogWriteRequest(message)) {
      return Response.json({ needed: false, research: null });
    }

    const carModel = extractCarModel(message);
    if (!carModel) {
      return Response.json({ needed: false, research: null });
    }

    const serviceType = extractServiceType(message);
    const research = await researchForBlogPost(message, carModel, serviceType);

    return Response.json({ needed: true, carModel, serviceType, research });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    return Response.json({ error: msg }, { status: 500 });
  }
}
