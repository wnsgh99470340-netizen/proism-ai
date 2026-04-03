import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('inventory')
      .select('*')
      .order('name');
    if (error) throw error;
    return Response.json(data || []);
  } catch (error) {
    console.error('[Inventory] 조회 실패:', error);
    return Response.json({ error: '재고 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.name) return Response.json({ error: '품목명은 필수입니다.' }, { status: 400 });

    const { data, error } = await supabase
      .from('inventory')
      .insert({
        name: body.name,
        quantity: body.quantity ?? 0,
        unit: body.unit || '롤',
        min_stock: body.min_stock ?? 0,
        memo: body.memo || null,
      })
      .select()
      .single();
    if (error) throw error;
    return Response.json(data);
  } catch (error) {
    console.error('[Inventory] 등록 실패:', error);
    return Response.json({ error: '재고 등록 실패' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return Response.json({ error: 'id 필수' }, { status: 400 });

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.quantity !== undefined) updates.quantity = body.quantity;
    if (body.unit !== undefined) updates.unit = body.unit;
    if (body.min_stock !== undefined) updates.min_stock = body.min_stock;
    if (body.memo !== undefined) updates.memo = body.memo;

    const { data, error } = await supabase
      .from('inventory')
      .update(updates)
      .eq('id', body.id)
      .select()
      .single();
    if (error) throw error;
    return Response.json(data);
  } catch (error) {
    console.error('[Inventory] 수정 실패:', error);
    return Response.json({ error: '재고 수정 실패' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return Response.json({ error: 'id 필수' }, { status: 400 });

    const { error } = await supabase.from('inventory').delete().eq('id', id);
    if (error) throw error;
    return Response.json({ success: true });
  } catch (error) {
    console.error('[Inventory] 삭제 실패:', error);
    return Response.json({ error: '재고 삭제 실패' }, { status: 500 });
  }
}
