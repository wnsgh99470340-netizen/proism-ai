import { queryServiceRecords } from '@/lib/notion';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year') || new Date().getFullYear().toString();

    // 전체 데이터 조회 (페이지네이션 반복)
    const allRecords: Array<{
      service: string;
      serviceDate: string;
      amount: number;
      status: string;
    }> = [];

    let cursor: string | undefined;
    do {
      const result = await queryServiceRecords({}, cursor);
      allRecords.push(...result.results);
      cursor = result.hasMore && result.nextCursor ? result.nextCursor : undefined;
    } while (cursor);

    // 해당 연도 필터
    const yearRecords = allRecords.filter((r) => r.serviceDate.startsWith(year));

    // 서비스별 통계
    const byService: Record<string, { count: number; revenue: number }> = {};
    for (const r of yearRecords) {
      const key = r.service || '기타';
      if (!byService[key]) byService[key] = { count: 0, revenue: 0 };
      byService[key].count++;
      byService[key].revenue += r.amount || 0;
    }

    // 월별 통계
    const byMonth: Record<string, { count: number; revenue: number }> = {};
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      byMonth[key] = { count: 0, revenue: 0 };
    }
    for (const r of yearRecords) {
      const month = r.serviceDate.slice(0, 7); // "2026-04"
      if (byMonth[month]) {
        byMonth[month].count++;
        byMonth[month].revenue += r.amount || 0;
      }
    }

    return Response.json({
      year,
      totalCount: yearRecords.length,
      totalRevenue: yearRecords.reduce((sum, r) => sum + (r.amount || 0), 0),
      byService: Object.entries(byService)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.revenue - a.revenue),
      byMonth: Object.entries(byMonth)
        .map(([month, data]) => ({ month, ...data })),
    });
  } catch (error) {
    console.error('[Notion] 통계 조회 실패:', error);
    return Response.json({ error: '통계 조회 실패', detail: String(error) }, { status: 500 });
  }
}
