import { createEstimatePage } from '@/lib/notion';
import { createEstimate } from '@/lib/estimates';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.customerName) {
      return Response.json({ error: '고객명은 필수입니다.' }, { status: 400 });
    }

    const serviceDetails: Record<string, string> = body.serviceDetails || {};

    // 1. Supabase에 저장 (공개 URL용)
    const estimate = await createEstimate({
      customerName: body.customerName,
      phone: body.phone || null,
      carModel: body.carModel || null,
      services: body.services || [],
      serviceDetails,
      amount: body.amount || null,
      scheduledDate: body.scheduledDate || null,
      memo: body.memo || null,
    });

    // 2. Notion에도 기록 (실패해도 자체 URL은 반환)
    let notionUrl: string | null = null;
    try {
      const page = await createEstimatePage({
        customerName: body.customerName,
        phone: body.phone || null,
        carModel: body.carModel || null,
        services: body.services || [],
        serviceDetails,
        amount: body.amount || null,
        scheduledDate: body.scheduledDate || null,
        memo: body.memo || null,
      });
      notionUrl = page.url;
    } catch (err) {
      console.warn('[Estimate] Notion 동기화 실패 (무시):', err);
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:3000`;
    const publicUrl = `${baseUrl}/estimate/${estimate.id}`;

    return Response.json({
      success: true,
      id: estimate.id,
      url: publicUrl,
      notionUrl,
    });
  } catch (error) {
    console.error('[Estimate] 견적서 생성 실패:', error);
    return Response.json({ error: '견적서 생성 실패', detail: String(error) }, { status: 500 });
  }
}
