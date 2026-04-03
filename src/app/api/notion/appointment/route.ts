import { createAppointmentPage, queryAppointments } from '@/lib/notion';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.customerName || !body.appointmentDate) {
      return Response.json({ error: '고객명과 예약일은 필수입니다.' }, { status: 400 });
    }

    const page = await createAppointmentPage({
      customerName: body.customerName,
      serviceType: body.serviceType || null,
      appointmentDate: body.appointmentDate,
      endDate: body.endDate || null,
      status: body.status || null,
      manager: body.manager || null,
      memo: body.memo || null,
    });

    return Response.json({ success: true, pageId: page.id });
  } catch (error) {
    console.error('[Notion] 예약 등록 실패:', error);
    return Response.json({ error: '예약 등록 실패', detail: String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get('cursor') || undefined;
    const result = await queryAppointments(cursor);
    return Response.json(result);
  } catch (error) {
    console.error('[Notion] 예약 조회 실패:', error);
    return Response.json({ error: '예약 조회 실패', detail: String(error) }, { status: 500 });
  }
}
