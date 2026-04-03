import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customer_id');
    if (!customerId) return Response.json({ error: 'customer_id 필수' }, { status: 400 });

    const { data, error } = await supabase
      .from('discounts')
      .select('*')
      .eq('customer_id', customerId)
      .order('discount_date', { ascending: false });
    if (error) throw error;
    return Response.json(data || []);
  } catch (error) {
    return Response.json({ error: '할인 이력 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.customer_id) return Response.json({ error: 'customer_id 필수' }, { status: 400 });

    const { data, error } = await supabase
      .from('discounts')
      .insert({
        customer_id: body.customer_id,
        discount_date: body.discount_date || new Date().toISOString().split('T')[0],
        discount_type: body.discount_type || '기타',
        discount_value: body.discount_value || null,
        memo: body.memo || null,
      })
      .select()
      .single();
    if (error) throw error;
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: '할인 기록 실패' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return Response.json({ error: 'id 필수' }, { status: 400 });
    const { error } = await supabase.from('discounts').delete().eq('id', id);
    if (error) throw error;
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: '할인 삭제 실패' }, { status: 500 });
  }
}
