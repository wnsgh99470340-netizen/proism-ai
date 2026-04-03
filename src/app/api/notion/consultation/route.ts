import { createConsultationPage, queryConsultations } from '@/lib/notion';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.customerName || !body.consultationDate) {
      return Response.json({ error: '고객명과 상담일은 필수입니다.' }, { status: 400 });
    }

    const page = await createConsultationPage({
      customerName: body.customerName,
      consultationDate: body.consultationDate,
      consultationType: body.consultationType || null,
      content: body.content || null,
      manager: body.manager || null,
    });

    return Response.json({ success: true, pageId: page.id });
  } catch (error) {
    console.error('[Notion] 상담 기록 실패:', error);
    return Response.json({ error: '상담 기록 실패', detail: String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const customer = searchParams.get('customer') || undefined;
    const cursor = searchParams.get('cursor') || undefined;

    const result = await queryConsultations({ customer }, cursor);
    return Response.json(result);
  } catch (error) {
    console.error('[Notion] 상담 조회 실패:', error);
    return Response.json({ error: '상담 조회 실패', detail: String(error) }, { status: 500 });
  }
}
