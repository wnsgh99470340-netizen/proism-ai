import { getWarranty } from '@/lib/warranties';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const warranty = await getWarranty(id);
  if (!warranty) return Response.json({ error: '보증서를 찾을 수 없습니다.' }, { status: 404 });
  return Response.json(warranty);
}
