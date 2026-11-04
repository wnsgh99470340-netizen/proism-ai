import { NextRequest } from 'next/server';
import { savePost, listPosts, deletePost, type PostKind } from '@/lib/posts';

/** GET /api/posts?kind=owner|draft|final&limit=20 */
export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get('kind') as PostKind | null;
  const limit = Number(request.nextUrl.searchParams.get('limit') || 20);
  const posts = await listPosts(kind || undefined, Math.min(Math.max(limit, 1), 100));
  return Response.json({ posts });
}

/** POST /api/posts  { kind, title, body, feedback?, car_model?, service_type?, product?, region?, draft_id? } */
export async function POST(request: NextRequest) {
  try {
    const input = await request.json();
    if (!input?.kind || !['owner', 'draft', 'final'].includes(input.kind)) {
      return Response.json({ error: 'kind는 owner/draft/final 중 하나여야 합니다.' }, { status: 400 });
    }
    if (!input.title?.trim() || !input.body?.trim()) {
      return Response.json({ error: '제목과 본문이 필요합니다.' }, { status: 400 });
    }
    const post = await savePost({
      kind: input.kind,
      title: String(input.title).trim(),
      body: String(input.body).trim(),
      feedback: input.feedback ? String(input.feedback).trim() : null,
      car_model: input.car_model || null,
      service_type: input.service_type || null,
      product: input.product || null,
      region: input.region || null,
      draft_id: input.draft_id || null,
    });
    if (!post) return Response.json({ error: 'DB 저장 실패. Supabase에 blog_posts 테이블이 있는지 확인해주세요 (supabase-schema.sql 6번).' }, { status: 500 });
    return Response.json({ post });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '알 수 없는 오류';
    return Response.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/posts?id=... */
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'id가 필요합니다.' }, { status: 400 });
  const ok = await deletePost(id);
  return Response.json({ ok });
}
