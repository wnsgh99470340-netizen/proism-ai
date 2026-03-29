import { NextRequest } from 'next/server';
import { callClaude, analyzeImageWithClaude } from '@/lib/claude-client';
import { getActiveEmployee } from '@/config/team';
import { BLOG_SYSTEM_PROMPT } from '@/config/prompts';

export async function POST(request: NextRequest) {
  try {
    const { message, history = [], images = [] } = await request.json();

    if (!message && images.length === 0) {
      return Response.json({ error: '메시지를 입력해주세요.' }, { status: 400 });
    }

    const activeEmployee = getActiveEmployee(message || '');

    // 이미지가 있으면 개별 분석 후 텍스트로 변환 (base64 원본을 채팅에 보내지 않음)
    let imageDescriptions = '';
    if (images.length > 0) {
      const BATCH_SIZE = 5;
      const descriptions: string[] = [];
      for (let i = 0; i < images.length; i += BATCH_SIZE) {
        const batch = images.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map((img: { data: string; mediaType?: string }, idx: number) =>
            analyzeImageWithClaude(
              img.data,
              img.mediaType || 'image/jpeg',
              `이 이미지를 자세히 분석해주세요. 블로그 글 작성에 활용할 수 있도록 내용, 분위기, 주요 요소를 설명해주세요. (이미지 ${i + idx + 1}/${images.length})`
            )
          )
        );
        descriptions.push(...results);
      }
      imageDescriptions = descriptions
        .map((desc, i) => `[이미지 ${i + 1}/${images.length} 분석 결과]\n${desc}`)
        .join('\n\n');
    }

    // 텍스트 메시지 구성 (이미지 분석 텍스트 + 유저 메시지)
    const textParts: string[] = [];
    if (imageDescriptions) {
      textParts.push(`첨부된 ${images.length}장의 사진 분석 결과:\n\n${imageDescriptions}`);
    }
    if (message) {
      textParts.push(message);
    }
    const combinedMessage = textParts.join('\n\n');

    const systemPrompt = `${BLOG_SYSTEM_PROMPT}\n\n현재 담당: ${activeEmployee.emoji} ${activeEmployee.name}\n역할: ${activeEmployee.role}\n\n${activeEmployee.systemPrompt}\n\n블로그 글을 완성했을 때는 반드시 다음 형식으로 출력하세요:\n---BLOG_DRAFT---\n{"title":"제목","content":"본문 내용","tags":["태그1","태그2"],"category":"프로이즘 작업기"}\n---END_DRAFT---`;

    // 히스토리 + 현재 메시지
    const messages = [
      ...history.map((h: { role: string; content: string }) => ({
        role: h.role,
        content: h.content,
      })),
      {
        role: 'user' as const,
        content: combinedMessage,
      },
    ];

    const reply = await callClaude(systemPrompt, messages);

    // 드래프트 감지
    let draft = null;
    const draftMatch = reply.match(/---BLOG_DRAFT---\s*([\s\S]*?)\s*---END_DRAFT---/);
    if (draftMatch) {
      try {
        draft = JSON.parse(draftMatch[1]);
      } catch {
        // 파싱 실패 무시
      }
    }

    return Response.json({
      reply: reply.replace(/---BLOG_DRAFT---[\s\S]*?---END_DRAFT---/, '').trim(),
      draft,
      activeEmployee: {
        id: activeEmployee.id,
        name: activeEmployee.name,
        emoji: activeEmployee.emoji,
        color: activeEmployee.color,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    return Response.json({ error: msg }, { status: 500 });
  }
}
