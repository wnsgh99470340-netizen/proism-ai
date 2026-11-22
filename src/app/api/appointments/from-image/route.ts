import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { todaySeoul } from '@/lib/local-date';
import { extractEventsFromImage, matchCandidates, type KnownAppointment, type KnownCustomer } from '@/lib/appointment-import';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/appointments/from-image — 스크린샷으로 예약 등록 1단계 (2026-11-18)
 * body: { data: base64, mediaType, baseMonth?: 'YYYY-MM' }
 * 이미지에서 일정을 뽑고 고객·기존 예약과 맞춘 후보 표를 돌려준다. 실제 등록은 화면에서 사장님이 확인한 뒤 한다.
 * 로그인 쿠키는 미들웨어가 확인.
 */
export async function POST(request: NextRequest) {
  try {
    const { data, mediaType, baseMonth } = (await request.json()) as { data?: string; mediaType?: string; baseMonth?: string };
    if (!data || !mediaType || !/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
      return Response.json({ error: '이미지 파일만 올릴 수 있습니다.' }, { status: 400 });
    }
    if (Buffer.from(data, 'base64').length > 4 * 1024 * 1024) return Response.json({ error: '4MB 이하 이미지만 올릴 수 있습니다.' }, { status: 400 });
    const today = todaySeoul();
    const month = baseMonth && /^\d{4}-\d{2}$/.test(baseMonth) ? baseMonth : today.slice(0, 7);

    const extracted = await extractEventsFromImage(data, mediaType, month);
    if (extracted.events.length === 0) return Response.json({ month: extracted.month, candidates: [], hidden: extracted.hidden, note: '읽은 일정이 없습니다' });

    const dates = extracted.events.flatMap((e) => [e.start, e.end || e.start]).sort();
    const [{ data: customers }, { data: appts }] = await Promise.all([
      supabase.from('customers').select('id, name, phone, car_brand, car_model, created_at'),
      supabase.from('appointments').select('id, customer_id, appointment_date, end_date, memo, status').lte('appointment_date', dates[dates.length - 1]).gte('appointment_date', dates[0] < '2000-01-01' ? '2000-01-01' : addMonths(dates[0], -1)),
    ]);
    // 차량 N대 (2026-11-22): 두 번째 차로도 고객을 찾는다. 표가 없으면 빈 목록
    const { data: vrows } = await supabase.from('vehicles').select('customer_id, brand, model');
    const carsBy = new Map<string, string[]>();
    for (const v of (vrows || []) as { customer_id: string; brand: string | null; model: string | null }[]) { const arr = carsBy.get(v.customer_id) || []; arr.push([v.brand, v.model].filter(Boolean).join(' ')); carsBy.set(v.customer_id, arr); }
    const withCars = ((customers || []) as KnownCustomer[]).map((c) => ({ ...c, cars: carsBy.get(c.id) || [] }));
    const candidates = matchCandidates(extracted.events, withCars, (appts || []) as KnownAppointment[], today);
    return Response.json({ month: extracted.month, candidates, hidden: extracted.hidden });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '읽기 실패' }, { status: 500 });
  }
}

/** 기간 예약은 시작일이 한 달 전일 수도 있어 조회 범위를 앞으로 넉넉히 */
function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
