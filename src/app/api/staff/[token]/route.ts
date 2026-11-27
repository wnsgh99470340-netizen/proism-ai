import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { AUTH_COOKIE_NAME, isAuthCookieValid } from '@/lib/auth-cookie';
import { todaySeoul } from '@/lib/local-date';
import { staffToken, staffCars, staffVisibleRange, type StaffAppointmentRow } from '@/lib/staff-page';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** PIN 시도 제한 — 회원 페이지와 같은 방식 (같은 주소 5번 틀리면 10분) */
const PIN_FAILS = new Map<string, { n: number; until: number }>();
const PIN_MAX = 5, PIN_LOCK_MS = 10 * 60 * 1000;
function pinLocked(token: string): number { const f = PIN_FAILS.get(token); if (!f) return 0; if (f.until && f.until > Date.now()) return Math.ceil((f.until - Date.now()) / 60000); if (f.until && f.until <= Date.now()) PIN_FAILS.delete(token); return 0; }
function pinFail(token: string): number { const f = PIN_FAILS.get(token) || { n: 0, until: 0 }; f.n += 1; if (f.n >= PIN_MAX) { f.until = Date.now() + PIN_LOCK_MS; f.n = 0; } PIN_FAILS.set(token, f); return f.until ? PIN_MAX : PIN_MAX - f.n; }

/**
 * GET /api/staff/<token> (헤더 x-staff-pin) — 직원용 예약 페이지 데이터 (2026-11-27)
 * - 로그인 없이 열리는 경로(미들웨어 예외). token 이 staffToken() 과 같고 pin 이 STAFF_PIN 과 같을 때만
 * - 응답 차 줄은 toStaffCar 의 고정 키뿐(금액·딜러·이메일 없음, 손님 전화는 sheet.head.phone 에만). 읽기 전용
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const expected = staffToken();
  if (!expected || token !== expected) return Response.json({ error: '없는 주소입니다' }, { status: 404 });
  const staffPin = (process.env.STAFF_PIN || '').replace(/\D/g, '');
  if (staffPin.length !== 4) return Response.json({ error: 'STAFF_PIN 설정 필요' }, { status: 503 });

  const owner = await isAuthCookieValid(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  if (!owner) {
    const pin = (request.headers.get('x-staff-pin') || '').replace(/\D/g, '').slice(0, 4);
    const lockedMin = pinLocked(token);
    if (lockedMin) return Response.json({ error: `여러 번 틀려 잠시 막혔습니다. ${lockedMin}분 뒤에 다시 시도해 주세요` }, { status: 429 });
    if (!pin) return Response.json({ needPin: true });
    if (pin !== staffPin) {
      const left = pinFail(token);
      return Response.json({ error: left >= PIN_MAX ? '5번 틀려 10분 동안 막혔습니다. 번호는 사장님께 물어봐 주세요' : `번호가 맞지 않습니다 (${left}번 더 틀리면 10분 잠김)` }, { status: 401 });
    }
    PIN_FAILS.delete(token);
  }

  const today = todaySeoul();
  const { from, to } = staffVisibleRange(today);
  const cols = 'id, appointment_date, end_date, service_type, status, memo';
  let { data, error } = await supabase
    .from('appointments')
    .select(`${cols}, customer:customers(name, phone, car_brand, car_model, kind, source), vehicle:vehicles(brand, model)`)
    .neq('status', '취소').gte('appointment_date', addBack(from)).lte('appointment_date', to)
    .order('appointment_date', { ascending: true });
  if (error || !data) { // vehicles 표가 없으면 join 이 실패 → 차량 없이
    const r = await supabase
      .from('appointments')
      .select(`${cols}, customer:customers(name, phone, car_brand, car_model, kind, source)`)
      .neq('status', '취소').gte('appointment_date', addBack(from)).lte('appointment_date', to)
      .order('appointment_date', { ascending: true });
    data = r.data as typeof data; error = r.error;
  }
  if (error) return Response.json({ error: '불러오지 못했습니다' }, { status: 500 });

  return Response.json({
    owner,
    today,
    range: { from, to },
    cars: staffCars((data || []) as unknown as StaffAppointmentRow[], today),
  });
}

/** 시작이 범위 전이라도 길게 걸친 예약(끝이 범위 안)을 잡으려고 시작 쪽을 30일 더 넓혀 읽는다. 자르기는 staffCars 가 */
function addBack(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10);
}
