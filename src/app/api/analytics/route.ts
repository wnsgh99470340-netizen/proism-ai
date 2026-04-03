import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year') || new Date().getFullYear().toString();

    // 1. 시공 기록 (services + customers 조인)
    const { data: services } = await supabase
      .from('services')
      .select('*, customer:customers(name, car_brand, car_model, source)')
      .order('service_date', { ascending: false });

    const allServices = (services || []).filter((s: Record<string, unknown>) => {
      const d = s.service_date as string || s.completion_date as string || '';
      return d.startsWith(year);
    });

    // ─── 월별 매출 + 전월 대비 ───────────────────────────
    const byMonth: Record<string, { count: number; revenue: number }> = {};
    for (let m = 1; m <= 12; m++) {
      byMonth[`${year}-${String(m).padStart(2, '0')}`] = { count: 0, revenue: 0 };
    }
    for (const s of allServices) {
      const date = (s.service_date || s.completion_date || '') as string;
      const month = date.slice(0, 7);
      if (byMonth[month]) {
        byMonth[month].count++;
        byMonth[month].revenue += (s.amount as number) || 0;
      }
    }

    const monthlyData = Object.entries(byMonth).map(([month, data], i, arr) => {
      const prevRevenue = i > 0 ? arr[i - 1][1].revenue : 0;
      const change = prevRevenue > 0 ? Math.round(((data.revenue - prevRevenue) / prevRevenue) * 100) : null;
      return { month, ...data, change };
    });

    // ─── 분기별 ──────────────────────────────────────────
    const quarters = [
      { label: 'Q1', months: ['01', '02', '03'] },
      { label: 'Q2', months: ['04', '05', '06'] },
      { label: 'Q3', months: ['07', '08', '09'] },
      { label: 'Q4', months: ['10', '11', '12'] },
    ].map((q) => {
      let count = 0, revenue = 0;
      for (const m of q.months) {
        const key = `${year}-${m}`;
        if (byMonth[key]) { count += byMonth[key].count; revenue += byMonth[key].revenue; }
      }
      return { label: q.label, count, revenue };
    });

    // ─── 서비스별 ────────────────────────────────────────
    const byService: Record<string, { count: number; revenue: number }> = {};
    for (const s of allServices) {
      const key = (s.service_type as string) || '기타';
      if (!byService[key]) byService[key] = { count: 0, revenue: 0 };
      byService[key].count++;
      byService[key].revenue += (s.amount as number) || 0;
    }

    // ─── 차종별 인기 서비스 ──────────────────────────────
    const carServiceMap: Record<string, Record<string, { count: number; revenue: number }>> = {};
    for (const s of allServices) {
      const cust = s.customer as Record<string, string> | null;
      const car = [cust?.car_brand, cust?.car_model].filter(Boolean).join(' ') || '미입력';
      const svc = (s.service_type as string) || '기타';
      if (!carServiceMap[car]) carServiceMap[car] = {};
      if (!carServiceMap[car][svc]) carServiceMap[car][svc] = { count: 0, revenue: 0 };
      carServiceMap[car][svc].count++;
      carServiceMap[car][svc].revenue += (s.amount as number) || 0;
    }

    const carAnalysis = Object.entries(carServiceMap)
      .map(([car, svcs]) => {
        const totalCount = Object.values(svcs).reduce((s, v) => s + v.count, 0);
        const totalRevenue = Object.values(svcs).reduce((s, v) => s + v.revenue, 0);
        const services = Object.entries(svcs)
          .map(([name, data]) => ({ name, ...data }))
          .sort((a, b) => b.count - a.count);
        return { car, totalCount, totalRevenue, services };
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 15);

    // ─── 유입 경로 분석 ──────────────────────────────────
    const sourceMap: Record<string, { customers: Set<string>; count: number; revenue: number }> = {};
    for (const s of allServices) {
      const cust = s.customer as Record<string, string> | null;
      const source = cust?.source || '미입력';
      const custId = s.customer_id as string;
      if (!sourceMap[source]) sourceMap[source] = { customers: new Set(), count: 0, revenue: 0 };
      sourceMap[source].customers.add(custId);
      sourceMap[source].count++;
      sourceMap[source].revenue += (s.amount as number) || 0;
    }

    const sourceAnalysis = Object.entries(sourceMap)
      .map(([source, data]) => ({
        source,
        customerCount: data.customers.size,
        serviceCount: data.count,
        revenue: data.revenue,
        avgPerCustomer: data.customers.size > 0 ? Math.round(data.revenue / data.customers.size) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // ─── 요약 ────────────────────────────────────────────
    const totalRevenue = allServices.reduce((s, r) => s + ((r.amount as number) || 0), 0);

    return Response.json({
      year,
      totalCount: allServices.length,
      totalRevenue,
      avgPerCase: allServices.length > 0 ? Math.round(totalRevenue / allServices.length) : 0,
      byService: Object.entries(byService).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.revenue - a.revenue),
      byMonth: monthlyData,
      quarters,
      carAnalysis,
      sourceAnalysis,
    });
  } catch (error) {
    console.error('[Analytics] 분석 실패:', error);
    return Response.json({ error: '분석 데이터 조회 실패', detail: String(error) }, { status: 500 });
  }
}
