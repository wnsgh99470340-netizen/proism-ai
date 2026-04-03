import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customer_id');

    let query = supabase.from('promotions').select('*').order('created_at', { ascending: false });
    if (customerId) query = query.eq('customer_id', customerId);

    const { data, error } = await query;
    if (error) throw error;
    return Response.json(data || []);
  } catch (error) {
    return Response.json({ error: '프로모션 이력 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { data, error } = await supabase
      .from('promotions')
      .insert({
        customer_id: body.customer_id,
        customer_name: body.customer_name,
        promotion_type: body.promotion_type,
        message: body.message,
      })
      .select()
      .single();
    if (error) throw error;
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: '프로모션 기록 실패' }, { status: 500 });
  }
}
