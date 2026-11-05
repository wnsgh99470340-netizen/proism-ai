import { NextRequest } from 'next/server';
import { reviseBlogPost, type Target } from '@/lib/blog-generate';

export const maxDuration = 300;

/**
 * POST /api/revise { title, content, instruction, target, parentDraftId }
 * 미리보기에 열린 글을 채팅 지시대로 고쳐 새 초안 버전으로 저장
 */
export async function POST(request: NextRequest) {
  try {
    const { title, content, instruction, target, parentDraftId = null } = await request.json() as {
      title: string; content: string; instruction: string; target: Partial<Target> | null; parentDraftId?: string | null;
    };
    if (!title || !content) return Response.json({ error: '열린 글이 없습니다.' }, { status: 400 });
    if (!instruction?.trim()) return Response.json({ error: '어떻게 고칠지 적어주세요.' }, { status: 400 });
    const t: Target = {
      carModel: target?.carModel ?? null,
      serviceType: target?.serviceType || 'PPF',
      product: target?.product ?? null,
      region: target?.region ?? null,
    };
    const result = await reviseBlogPost({ title, content, instruction: instruction.trim(), target: t, parentDraftId });
    return Response.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : '알 수 없는 오류';
    return Response.json({ error: msg }, { status: 500 });
  }
}
