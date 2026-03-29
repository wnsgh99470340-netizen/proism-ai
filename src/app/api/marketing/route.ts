import { NextRequest } from 'next/server';
import { callClaude } from '@/lib/claude-client';
import { BUSINESS_CONTEXT } from '@/config/prompts';

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query) {
      return Response.json({ error: '질문을 입력해주세요.' }, { status: 400 });
    }

    const systemPrompt = `${BUSINESS_CONTEXT}\n\n당신은 3M 프로이즘의 마케팅 인사이트 분석가입니다. 네이버 블로그 SEO, 키워드 전략, 발행 시간 최적화에 대한 전문 지식을 보유하고 있습니다.\n\n다음 형식으로 JSON 응답하세요:\n{\n  "seoScore": 0~100 사이 점수,\n  "keywords": ["추천 키워드 배열"],\n  "bestTime": "최적 발행 시간",\n  "tips": ["마케팅 팁 배열"],\n  "summary": "핵심 인사이트 1~2줄"\n}`;

    const reply = await callClaude(systemPrompt, [
      { role: 'user', content: query },
    ]);

    let insight;
    try {
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      insight = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: reply };
    } catch {
      insight = { summary: reply };
    }

    return Response.json({ insight });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '분석 실패';
    return Response.json({ error: msg }, { status: 500 });
  }
}
