import { NextRequest } from 'next/server';
import { answerInquiry } from '@/lib/inquiry';

export const maxDuration = 60;

/** POST /api/inquiry { text } — 고객 문의 글 → 시장 평균가 기준 답변 초안 (로그인 쿠키는 미들웨어가 확인) */
export async function POST(request: NextRequest) {
  try {
    const { text } = (await request.json()) as { text?: string };
    if (!text || text.trim().length < 5) return Response.json({ error: '문의 글을 붙여 넣어 주세요' }, { status: 400 });
    const answer = await answerInquiry(text.slice(0, 4000));
    return Response.json(answer);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
