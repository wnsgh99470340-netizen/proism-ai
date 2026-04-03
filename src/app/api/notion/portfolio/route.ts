import { createPortfolioPage, queryPortfolio } from '@/lib/notion';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.serviceDate) {
      return Response.json({ error: '시공일은 필수입니다.' }, { status: 400 });
    }

    const page = await createPortfolioPage({
      carModel: body.carModel || null,
      service: body.service || null,
      serviceDate: body.serviceDate,
      description: body.description || null,
      photoUrl: body.photoUrl || null,
    });

    return Response.json({ success: true, pageId: page.id });
  } catch (error) {
    console.error('[Notion] 포트폴리오 생성 실패:', error);
    return Response.json({ error: '포트폴리오 생성 실패', detail: String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get('cursor') || undefined;
    const result = await queryPortfolio(cursor);
    return Response.json(result);
  } catch (error) {
    console.error('[Notion] 포트폴리오 조회 실패:', error);
    return Response.json({ error: '포트폴리오 조회 실패', detail: String(error) }, { status: 500 });
  }
}
