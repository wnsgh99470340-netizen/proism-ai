import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { AUTH_COOKIE_NAME, isAuthCookieValid } from '@/lib/auth-cookie';
import { maskName } from '@/lib/member-links';
import { carState, type CarAppointment, type CarService } from '@/lib/dealer-page';
import { DEALER_KIND } from '@/lib/dealers';
import { todaySeoul } from '@/lib/local-date';
import { parseWorkOrder } from '@/lib/work-order';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** 뒷자리 시도 제한 — 회원 페이지와 같은 방식 (같은 주소 5번 틀리면 10분) */
const PIN_FAILS = new Map<string, { n: number; until: number }>();
const PIN_MAX = 5, PIN_LOCK_MS = 10 * 60 * 1000;
function pinLocked(token: string): number { const f = PIN_FAILS.get(token); if (!f) return 0; if (f.until && f.until > Date.now()) return Math.ceil((f.until - Date.now()) / 60000); if (f.until && f.until <= Date.now()) PIN_FAILS.delete(token); return 0; }
function pinFail(token: string): number { const f = PIN_FAILS.get(token) || { n: 0, until: 0 }; f.n += 1; if (f.n >= PIN_MAX) { f.until = Date.now() + PIN_LOCK_MS; f.n = 0; } PIN_FAILS.set(token, f); return f.until ? PIN_MAX : PIN_MAX - f.n; }

/**
 * GET /api/dealer/<token> (헤더 x-member-pin) — 딜러용 현황 페이지 데이터 (2026-11-25)
 * - 로그인 없이 열리는 경로(미들웨어 예외). token 이 딜러 기록의 것이고 pin 이 딜러 전화 뒷자리와 같을 때만
 * - 손님 전화번호·금액은 내려보내지 않는다. 손님 이름은 딜러가 직접 넣은 손님이라 그대로(딜러가 아는 사람)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pin = (request.headers.get('x-member-pin') || '').replace(/\D/g, '').slice(0, 4);
  const owner = await isAuthCookieValid(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  if (!token || token.length < 12) return Response.json({ error: '잘못된 주소입니다' }, { status: 404 });

  const { data: link, error: e1 } = await supabase.from('member_links').select('customer_id').eq('token', token).maybeSingle();
  if (e1) return Response.json({ error: '페이지가 아직 준비되지 않았습니다' }, { status: 503 });
  if (!link) return Response.json({ error: '없는 주소입니다' }, { status: 404 });

  const { data: d } = await supabase.from('customers').select('id, name, phone, kind, memo').eq('id', link.customer_id).single();
  if (!d || (d.kind || '일반') !== DEALER_KIND) return Response.json({ error: '없는 주소입니다' }, { status: 404 });
  const last4 = (d.phone || '').replace(/\D/g, '').slice(-4);
  if (!owner) {
    const lockedMin = pinLocked(token);
    if (lockedMin) return Response.json({ error: `여러 번 틀려 잠시 막혔습니다. ${lockedMin}분 뒤에 다시 시도해 주세요` }, { status: 429 });
    if (!pin) return Response.json({ needPin: true, name: maskName(d.name) });
    if (!last4 || pin !== last4) {
      const left = pinFail(token);
      return Response.json({ error: left >= PIN_MAX ? '5번 틀려 10분 동안 막혔습니다. 번호가 바뀌셨으면 매장으로 연락 주세요' : `전화번호 뒷자리가 맞지 않습니다 (${left}번 더 틀리면 10분 잠김)` }, { status: 401 });
    }
    PIN_FAILS.delete(token);
    // 열어 본 횟수 (2026-11-25 "열어 본 사람이 있는지 보고 다음을 정하자") — 회원 페이지와 같은 칸
    const { data: cur } = await supabase.from('member_links').select('visits').eq('token', token).maybeSingle();
    await supabase.from('member_links').update({ last_seen_at: new Date().toISOString(), visits: ((cur?.visits as number | null) || 0) + 1 }).eq('token', token);
  }

  const today = todaySeoul();
  const { data: cs } = await supabase.from('customers').select('id, name, car_brand, car_model, created_at').eq('dealer_id', d.id).order('created_at', { ascending: false });
  const custs = (cs || []) as { id: string; name: string; car_brand: string | null; car_model: string | null; created_at: string }[];
  const ids = custs.map((c) => c.id);
  const [{ data: appts }, { data: svcs }] = ids.length
    ? await Promise.all([
        supabase.from('appointments').select('customer_id, appointment_date, end_date, service_type, status, memo').in('customer_id', ids),
        supabase.from('services').select('customer_id, service_date, completion_date, service_type').in('customer_id', ids),
      ])
    : [{ data: [] }, { data: [] }];

  const cars = custs.map((c) => {
    const a = ((appts || []) as (CarAppointment & { customer_id: string; memo: string | null })[]).filter((x) => x.customer_id === c.id);
    const s = ((svcs || []) as (CarService & { customer_id: string })[]).filter((x) => x.customer_id === c.id);
    const st = carState(a, s, today);
    const history = a.filter((x) => x.status !== '취소').sort((x, y) => (x.appointment_date < y.appointment_date ? 1 : -1)).map((x) => ({ date: x.appointment_date, end: x.end_date, service: x.service_type, status: x.status, photos: parseWorkOrder(x.memo)?.photos || [] }));
    const photos = history.flatMap((h) => h.photos).slice(0, 6); // 작업 사진 (완료 처리 때 붙인 것, 2026-11-25)
    return { id: c.id, name: c.name, car: [c.car_brand, c.car_model].filter(Boolean).join(' ') || null, state: st, history, photos };
  }).sort((x, y) => (x.state.sortKey < y.state.sortKey ? -1 : x.state.sortKey > y.state.sortKey ? 1 : 0));

  const org = ((d.memo || '').split('\n')[0] || '').replace(/\[[^\]]*\]/g, '').trim() || null;
  return Response.json({
    owner,
    dealer: { name: d.name, org },
    today,
    cars,
    shop: { name: '3M 프로이즘 강남서초점', phone: '010-7287-7140', address: '서울 서초구 서초중앙로8길 82 1동 1층', card: 'https://proism-ai.vercel.app/card' },
  });
}
