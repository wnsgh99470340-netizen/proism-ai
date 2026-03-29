import { NextRequest } from 'next/server';
import { callClaude } from '@/lib/claude-client';
import { getActiveEmployee } from '@/config/team';
import { BLOG_SYSTEM_PROMPT } from '@/config/prompts';

export async function POST(request: NextRequest) {
  try {
    const { message, history = [], images = [] } = await request.json();

    if (!message && images.length === 0) {
      return Response.json({ error: '메시지를 입력해주세요.' }, { status: 400 });
    }

    const activeEmployee = getActiveEmployee(message || '');

    // 메시지 content 구성
    const userContent: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [];

    // 이미지가 있으면 추가
    for (const img of images) {
      userContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType || 'image/jpeg',
          data: img.data,
        },
      });
    }

    // 텍스트 메시지
    if (message) {
      userContent.push({ type: 'text', text: message });
    }

    const systemPrompt = `${BLOG_SYSTEM_PROMPT}\n\n현재 담당: ${activeEmployee.emoji} ${activeEmployee.name}\n역할: ${activeEmployee.role}\n\n${activeEmployee.systemPrompt}\n\n블로그 글을 완성했을 때는 반드시 다음 형식으로 출력하세요:\n---BLOG_DRAFT---\n{"title":"제목","content":"본문 내용","tags":["태그1","태그2"],"category":"프로이즘 작업기"}\n---END_DRAFT---`;

    // 히스토리 + 현재 메시지
    const messages = [
      ...history.map((h: { role: string; content: string }) => ({
        role: h.role,
        content: h.content,
      })),
      {
        role: 'user' as const,
        content: userContent.length === 1 && userContent[0].type === 'text'
          ? message
          : userContent,
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
