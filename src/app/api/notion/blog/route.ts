import { createBlogPage, queryBlogPosts } from '@/lib/notion';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.title) {
      return Response.json({ error: '제목은 필수입니다.' }, { status: 400 });
    }

    const page = await createBlogPage({
      title: body.title,
      carModel: body.carModel || null,
      service: body.service || null,
      published: body.published ?? false,
      naverUrl: body.naverUrl || null,
      preview: body.preview || null,
    });

    return Response.json({ success: true, pageId: page.id });
  } catch (error) {
    console.error('[Notion] 블로그 저장 실패:', error);
    return Response.json({ error: '블로그 저장 실패', detail: String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get('cursor') || undefined;
    const result = await queryBlogPosts(cursor);
    return Response.json(result);
  } catch (error) {
    console.error('[Notion] 블로그 조회 실패:', error);
    return Response.json({ error: '블로그 조회 실패', detail: String(error) }, { status: 500 });
  }
}
