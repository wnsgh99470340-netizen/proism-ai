import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const year = searchParams.get('year') || String(now.getFullYear());
    const month = searchParams.get('month') || String(now.getMonth() + 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    const monthStr = `${year}-${pad(Number(month))}`;
    const prevMonth = Number(month) === 1 ? `${Number(year) - 1}-12` : `${year}-${pad(Number(month) - 1)}`;

    // 서비스 데이터
    const { data: services } = await supabase
      .from('services')
      .select('*, customer:customers(name, car_brand, car_model, source)')
      .order('service_date', { ascending: false });

    const all = services || [];
    const current = all.filter((s) => ((s.service_date || s.completion_date || '') as string).startsWith(monthStr));
    const prev = all.filter((s) => ((s.service_date || s.completion_date || '') as string).startsWith(prevMonth));

    const totalRevenue = current.reduce((sum, s) => sum + ((s.amount as number) || 0), 0);
    const prevRevenue = prev.reduce((sum, s) => sum + ((s.amount as number) || 0), 0);
    const revenueChange = prevRevenue > 0 ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100) : null;

    // 서비스별
    const byService: Record<string, { count: number; revenue: number }> = {};
    for (const s of current) {
      const key = (s.service_type as string) || '기타';
      if (!byService[key]) byService[key] = { count: 0, revenue: 0 };
      byService[key].count++;
      byService[key].revenue += (s.amount as number) || 0;
    }

    // 차종별
    const carMap: Record<string, Record<string, number>> = {};
    for (const s of current) {
      const cust = s.customer as Record<string, string> | null;
      const car = [cust?.car_brand, cust?.car_model].filter(Boolean).join(' ') || '미입력';
      const svc = (s.service_type as string) || '기타';
      if (!carMap[car]) carMap[car] = {};
      carMap[car][svc] = (carMap[car][svc] || 0) + 1;
    }
    const carAnalysis = Object.entries(carMap)
      .map(([car, svcs]) => ({ car, services: Object.entries(svcs).map(([name, count]) => `${name} ${count}건`).join(', '), total: Object.values(svcs).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // 유입 경로별
    const sourceMap: Record<string, { customers: Set<string>; count: number; revenue: number }> = {};
    for (const s of current) {
      const cust = s.customer as Record<string, string> | null;
      const source = cust?.source || '미입력';
      if (!sourceMap[source]) sourceMap[source] = { customers: new Set(), count: 0, revenue: 0 };
      sourceMap[source].customers.add(s.customer_id as string);
      sourceMap[source].count++;
      sourceMap[source].revenue += (s.amount as number) || 0;
    }
    const sourceAnalysis = Object.entries(sourceMap)
      .map(([source, d]) => ({ source, customerCount: d.customers.size, count: d.count, revenue: d.revenue }))
      .sort((a, b) => b.revenue - a.revenue);

    // 담당자별
    const managerMap: Record<string, number> = { '대표': 0, '이팀장님': 0, '김막내': 0 };
    for (const s of current) {
      const svc = ((s.service_type as string) || '').toLowerCase();
      if (svc.includes('틴팅') || svc.includes('썬팅')) managerMap['이팀장님']++;
      else managerMap['대표']++;
    }

    return Response.json({
      year, month: Number(month), monthStr,
      totalCount: current.length,
      totalRevenue,
      avgPerCase: current.length > 0 ? Math.round(totalRevenue / current.length) : 0,
      revenueChange,
      prevRevenue,
      byService: Object.entries(byService).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.revenue - a.revenue),
      carAnalysis,
      sourceAnalysis,
      managerWorkload: Object.entries(managerMap).map(([name, count]) => ({ name, count })),
    });
  } catch (error) {
    console.error('[Report] 리포트 생성 실패:', error);
    return Response.json({ error: '리포트 생성 실패', detail: String(error) }, { status: 500 });
  }
}
