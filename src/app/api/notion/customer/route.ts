import { createCustomerPage, queryCustomers, ensureCustomerDbProperties } from '@/lib/notion';

let dbInitPromise: Promise<void> | null = null;

function ensureDbReady() {
  if (!dbInitPromise) {
    dbInitPromise = ensureCustomerDbProperties().catch((err) => {
      console.error('[Notion] DB 초기화 실패:', err);
      dbInitPromise = null;
    });
  }
  return dbInitPromise;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.name) {
      return Response.json({ error: '고객명은 필수입니다.' }, { status: 400 });
    }

    // DB 초기화를 기다리되, 실패해도 페이지 생성은 시도
    await ensureDbReady();

    const page = await createCustomerPage({
      name: body.name,
      phone: body.phone || null,
      car_brand: body.car_brand || null,
      car_model: body.car_model || null,
      service_type: body.service_type || null,
      appointment_date: body.appointment_date || null,
      status: body.status || null,
      memo: body.memo || null,
    });

    return Response.json({ success: true, pageId: page.id });
  } catch (error) {
    console.error('[Notion] 고객 등록 실패:', error);
    return Response.json(
      { error: '노션 고객 등록 실패', detail: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    await ensureDbReady();

    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get('cursor') || undefined;

    const result = await queryCustomers(cursor);

    return Response.json(result);
  } catch (error) {
    console.error('[Notion] 고객 조회 실패:', error);
    return Response.json(
      { error: '노션 고객 조회 실패', detail: String(error) },
      { status: 500 }
    );
  }
}
