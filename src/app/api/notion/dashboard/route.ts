import { getDashboardData } from '@/lib/notion';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year') || new Date().getFullYear().toString();

    const data = await getDashboardData(year);

    if (!data) {
      return Response.json({ error: '시공 기록 DB가 초기화되지 않았습니다.' }, { status: 404 });
    }

    return Response.json(data);
  } catch (error) {
    console.error('[Notion] 대시보드 조회 실패:', error);
    return Response.json({ error: '대시보드 조회 실패', detail: String(error) }, { status: 500 });
  }
}
