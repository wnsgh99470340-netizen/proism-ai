import { createServiceRecordPage, queryServiceRecords } from '@/lib/notion';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.customerName || !body.serviceDate) {
      return Response.json({ error: '고객명과 시공일은 필수입니다.' }, { status: 400 });
    }

    const page = await createServiceRecordPage({
      customerName: body.customerName,
      carModel: body.carModel || null,
      service: body.service || null,
      serviceDate: body.serviceDate,
      amount: body.amount || null,
      manager: body.manager || null,
      status: body.status || null,
    });

    return Response.json({ success: true, pageId: page.id });
  } catch (error) {
    console.error('[Notion] 시공 기록 실패:', error);
    return Response.json({ error: '시공 기록 실패', detail: String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get('cursor') || undefined;
    const month = searchParams.get('month') || undefined;
    const service = searchParams.get('service') || undefined;

    const result = await queryServiceRecords({ month, service }, cursor);
    return Response.json(result);
  } catch (error) {
    console.error('[Notion] 시공 조회 실패:', error);
    return Response.json({ error: '시공 조회 실패', detail: String(error) }, { status: 500 });
  }
}
