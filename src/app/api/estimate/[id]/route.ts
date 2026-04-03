import { getEstimate } from '@/lib/estimates';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const estimate = await getEstimate(id);

  if (!estimate) {
    return Response.json({ error: '견적서를 찾을 수 없습니다.' }, { status: 404 });
  }

  return Response.json(estimate);
}
