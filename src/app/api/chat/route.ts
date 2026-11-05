import { NextRequest } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { analyzeImageWithClaude } from '@/lib/claude-client';
import { isBlogWriteRequest, resolveTarget, researchForBlogPost } from '@/lib/blog-research';
import type { BlogRequest } from '@/config/blog-options';
import { getActiveEmployee } from '@/config/team';
import { runWriter, buildBlogSystemPrompt, BLOG_WRITER_MODEL, type Target } from '@/lib/blog-generate';

// 글 작성 전 웹 검색 리서치 + 작성 + QA + 수정까지 여러 번 Claude를 호출하므로 넉넉히 잡음
export const maxDuration = 300;

interface ImageRef {
  url: string;
  filename: string;
}

/** 대표 사진 3장을 골라 인덱스를 반환 (첫 번째, 중간, 마지막) */
function pickRepresentativeIndices(total: number): number[] {
  if (total <= 3) return Array.from({ length: total }, (_, i) => i);
  const mid = Math.floor(total / 2);
  return [0, mid, total - 1];
}

/** 디스크에서 이미지를 읽어 Vision API용 base64로 변환 (600px, JPEG q40) */
async function readImageForVision(filename: string): Promise<string> {
  const filePath = path.join(process.cwd(), 'public', 'uploads', filename);
  const buffer = await readFile(filePath);
  const visionBuffer = await sharp(buffer).resize(600).jpeg({ quality: 40 }).toBuffer();
  return visionBuffer.toString('base64');
}

/**
 * 즉시 응답 경로. 블로그 요청은 보통 /api/jobs(백그라운드) 로 가고,
 * 이 경로는 일반 대화·사진 첨부 요청·작업 테이블이 없을 때의 폴백으로 쓰인다.
 */
export async function POST(request: NextRequest) {
  try {
    const { message, history = [], images = [], research = null, request: blogRequest = null } = await request.json() as {
      message: string;
      history: { role: string; content: string }[];
      images: ImageRef[];
      research?: { context: string; summary: string } | null;
      request?: BlogRequest | null;
    };
    const t = resolveTarget(message || '', blogRequest);
    const target: Target = { carModel: t.carModel, serviceType: t.serviceType, product: t.product, region: blogRequest?.region || null };

    if (!message && images.length === 0) {
      return Response.json({ error: '메시지를 입력해주세요.' }, { status: 400 });
    }

    const activeEmployee = getActiveEmployee(message || '');

    // 이미지가 있으면 대표 3장만 Vision 분석, 나머지는 URL만 전달
    let imageContext = '';
    if (images.length > 0) {
      const representativeIndices = pickRepresentativeIndices(images.length);
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

    const combinedMessage = [imageContext, message].filter(Boolean).join('\n\n');

    // 블로그 글 작성 요청이면 웹 검색으로 차량 구조 + 같은 차종 시공 사례 사전 조사
    let researchContext = '';
    let researchSummary = '';
    if (research && research.context) {
      researchContext = research.context;
      researchSummary = research.summary || '';
    } else if ((blogRequest || isBlogWriteRequest(message || '')) && target.carModel) {
      const done = await researchForBlogPost(message || '', target.carModel, target.serviceType);
      researchContext = done.context;
      researchSummary = done.summary;
    }

    const isBlog = Boolean(blogRequest) || isBlogWriteRequest(message || '');
    const systemPrompt = isBlog
      ? await buildBlogSystemPrompt(researchContext)
      : `${activeEmployee.systemPrompt}\n\n현재 담당: ${activeEmployee.emoji} ${activeEmployee.name}\n역할: ${activeEmployee.role}`;

    const result = await runWriter({
      systemPrompt,
      model: isBlog ? BLOG_WRITER_MODEL : activeEmployee.model,
      history,
      combinedMessage,
      target,
      researchSummary,
      save: true,
    });

    return Response.json({
      reply: result.reply,
      draft: result.draft,
      checks: result.checks,
      draftId: result.draftId,
      target: result.target,
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
