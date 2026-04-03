import { createWarranty } from '@/lib/warranties';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.customer_name) {
      return Response.json({ error: '고객명은 필수입니다.' }, { status: 400 });
    }

    const warranty = await createWarranty({
      customer_name: body.customer_name,
      phone: body.phone || null,
      car_type: body.car_type || null,
      car_number: body.car_number || null,
      work_details: body.work_details || null,
      warranty_period: body.warranty_period || null,
      service_date: body.service_date || null,
      price: body.price || null,
    });

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    return Response.json({ success: true, id: warranty.id, url: `${baseUrl}/warranty/${warranty.id}` });
  } catch (error) {
    console.error('[Warranty] 생성 실패:', error);
    return Response.json({ error: '보증서 생성 실패', detail: String(error) }, { status: 500 });
  }
}
