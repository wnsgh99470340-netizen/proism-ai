import { NextRequest } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { callClaude, analyzeImageWithClaude } from '@/lib/claude-client';
import { getActiveEmployee } from '@/config/team';
import { BLOG_SYSTEM_PROMPT } from '@/config/prompts';

interface ImageRef {
  url: string;
  filename: string;
}

/**
 * 대표 사진 3장을 골라 인덱스를 반환 (첫 번째, 중간, 마지막)
 */
function pickRepresentativeIndices(total: number): number[] {
  if (total <= 3) return Array.from({ length: total }, (_, i) => i);
  const mid = Math.floor(total / 2);
  return [0, mid, total - 1];
}

/**
 * 디스크에서 이미지를 읽어 Vision API용 base64로 변환 (600px, JPEG q40)
 */
async function readImageForVision(filename: string): Promise<string> {
  const filePath = path.join(process.cwd(), 'public', 'uploads', filename);
  const buffer = await readFile(filePath);
  const visionBuffer = await sharp(buffer)
    .resize(600)
    .jpeg({ quality: 40 })
    .toBuffer();
  return visionBuffer.toString('base64');
}

export async function POST(request: NextRequest) {
  try {
    const { message, history = [], images = [] } = await request.json() as {
      message: string;
      history: { role: string; content: string }[];
      images: ImageRef[];
    };

    if (!message && images.length === 0) {
      return Response.json({ error: '메시지를 입력해주세요.' }, { status: 400 });
    }

    const activeEmployee = getActiveEmployee(message || '');

    // 이미지가 있으면 대표 3장만 Vision 분석, 나머지는 URL만 전달
    let imageContext = '';
    if (images.length > 0) {
      const representativeIndices = pickRepresentativeIndices(images.length);

      // 대표 사진 Vision 분석 (병렬)
      const analyses = await Promise.all(
        representativeIndices.map(async (idx) => {
          try {
            const base64 = await readImageForVision(images[idx].filename);
            const analysis = await analyzeImageWithClaude(
              base64,
              'image/jpeg',
              `이 자동차 PPF/썬팅/랩핑 시공 사진을 분석해줘. 차종, 시공 단계(전처리/세척/시공중/마감/완성), 사진 내용을 간단히 설명해줘. 2~3줄로 짧게.`
            );
            return { idx, analysis };
          } catch {
            return { idx, analysis: '(분석 실패)' };
          }
        })
      );

      // 전체 이미지 목록 + 분석 결과를 텍스트로 구성
      const analysisMap = new Map(analyses.map(a => [a.idx, a.analysis]));
      const imageLines = images.map((img, i) => {
        const analysis = analysisMap.get(i);
        const label = `[사진 ${i + 1}/${images.length}] ${img.url}`;
        return analysis ? `${label}\n  분석: ${analysis}` : label;
      });

      imageContext = `첨부된 사진 ${images.length}장:\n${imageLines.join('\n')}\n\n` +
        `위 사진들을 블로그 글 본문에 순서대로 적절히 배치해주세요. ` +
        `분석된 사진의 내용을 참고하여 전체 사진의 흐름을 파악하고, ` +
        `각 사진 위치에 [사진 N] 태그를 넣어주세요.`;
    }

    // 텍스트 메시지 구성
    const textParts: string[] = [];
    if (imageContext) {
      textParts.push(imageContext);
    }
    if (message) {
      textParts.push(message);
    }
    const combinedMessage = textParts.join('\n\n');

    const systemPrompt = `${BLOG_SYSTEM_PROMPT}\n\n현재 담당: ${activeEmployee.emoji} ${activeEmployee.name}\n역할: ${activeEmployee.role}\n\n${activeEmployee.systemPrompt}\n\n블로그 글을 완성했을 때는 반드시 다음 형식으로 출력하세요:\n---BLOG_DRAFT---\n{"title":"제목","content":"본문 내용","tags":["태그1","태그2"],"category":"프로이즘 작업기"}\n---END_DRAFT---`;

    // 히스토리 + 현재 메시지
    const messages = [
      ...history.map((h: { role: string; content: string }) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      {
        role: 'user' as const,
        content: combinedMessage,
      },
    ];

    const reply = await callClaude(systemPrompt, messages, 4096, activeEmployee.model);

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
