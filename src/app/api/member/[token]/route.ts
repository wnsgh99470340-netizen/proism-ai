import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { maskName } from '@/lib/member-links';
import { MEMBERSHIP } from '@/config/membership';
import { parseWorkOrder, workItems, type WorkOrderJson } from '@/lib/work-order';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/member/<token> (헤더 x-member-pin: 1234) — 손님용 회원 페이지 데이터 (2026-11-18)
 * - 로그인 없이 열리는 경로(미들웨어 예외). token 이 맞고 pin 이 그 고객 전화 뒷자리 4개와 같을 때만 돌려준다
 * - 다른 사람 이름은 가리고, 전화번호·금액은 내려보내지 않는다
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // 뒷자리는 헤더로만 받는다 (주소창·서버 로그에 안 남게). 2026-11-19
  const pin = (request.headers.get('x-member-pin') || '').replace(/\D/g, '').slice(0, 4);
  if (!token || token.length < 12) return Response.json({ error: '잘못된 주소입니다' }, { status: 404 });

  const { data: link, error: e1 } = await supabase.from('member_links').select('customer_id').eq('token', token).maybeSingle();
  if (e1) return Response.json({ error: '회원 페이지가 아직 준비되지 않았습니다' }, { status: 503 });
  if (!link) return Response.json({ error: '없는 주소입니다' }, { status: 404 });

  const { data: c } = await supabase.from('customers').select('id, name, phone, car_brand, car_model, car_color, created_at').eq('id', link.customer_id).single();
  if (!c) return Response.json({ error: '고객 정보를 찾을 수 없습니다' }, { status: 404 });
  const last4 = (c.phone || '').replace(/\D/g, '').slice(-4);
  if (!pin) return Response.json({ needPin: true, name: maskName(c.name) });
  if (!last4 || pin !== last4) return Response.json({ error: '전화번호 뒷자리가 맞지 않습니다' }, { status: 401 });

  const [{ data: services }, { data: followUps }, { data: appts }, { data: gave }, { data: received }] = await Promise.all([
    supabase.from('services').select('id, service_type, service_date, completion_date, service_area, film_used').eq('customer_id', c.id).order('service_date', { ascending: false }),
    supabase.from('follow_ups').select('follow_up_type, scheduled_date, is_completed, completed_date').eq('customer_id', c.id).in('follow_up_type', ['QC점검', '메인터넌스']).order('scheduled_date', { ascending: true }),
    supabase.from('appointments').select('id, appointment_date, end_date, service_type, status, memo').eq('customer_id', c.id).neq('status', '취소').order('appointment_date', { ascending: false }),
    supabase.from('referrals').select('id, referred_id, created_at, referrer_reward, referrer_reward_used_at, referred:customers!referrals_referred_id_fkey(name)').eq('referrer_id', c.id).order('created_at', { ascending: false }),
    supabase.from('referrals').select('id, referrer_id, created_at, referred_reward, referred_reward_used_at, referrer:customers!referrals_referrer_id_fkey(name)').eq('referred_id', c.id).maybeSingle(),
  ]);

  // 소개한 분들의 진행 상태: 그 사람에게 시공 기록이 있으면 완료, 예약이 있으면 예약, 아니면 연락
  const referredIds = (gave || []).map((r) => r.referred_id as string);
  let doneSet = new Set<string>(), bookedSet = new Set<string>();
  if (referredIds.length > 0) {
    const [{ data: s2 }, { data: a2 }] = await Promise.all([
      supabase.from('services').select('customer_id').in('customer_id', referredIds),
      supabase.from('appointments').select('customer_id').in('customer_id', referredIds).neq('status', '취소'),
    ]);
    doneSet = new Set((s2 || []).map((x) => x.customer_id as string));
    bookedSet = new Set((a2 || []).map((x) => x.customer_id as string));
  }

  // 보증서: 예약 메모(JSON) 속 warranty / warranty_url + 작업 내역서 항목(PPF·썬팅·코팅…)을 증명서 줄로 (src/lib/work-order.ts)
  const warranties = (appts || []).map((a) => { const w = parseWorkOrder(a.memo); return w ? { a, w } : null; })
    .filter((v): v is { a: NonNullable<typeof appts>[number]; w: WorkOrderJson } => !!v && !!(v.w.warranty_issued || v.w.warranty))
    .map(({ a, w }) => ({
      date: w.warranty?.date || a.appointment_date, end: a.end_date, work: w.warranty?.work_details || a.service_type || '', period: w.warranty?.warranty_period || '',
      url: (w.warranty_url || '').replace(/\s+/g, '') || null, items: workItems(w), certNo: `PZ-${String(a.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    }));

  const upcoming = (appts || []).filter((a) => a.status !== '완료').map((a) => ({ date: a.appointment_date, end: a.end_date, service: a.service_type, status: a.status }));
  const memberSince = (services || []).map((s) => s.service_date || s.completion_date || '').filter(Boolean).sort()[0] || null;

  // 방문 기록 (실패해도 페이지는 그대로)
  const { data: cur } = await supabase.from('member_links').select('visits').eq('token', token).maybeSingle();
  await supabase.from('member_links').update({ last_seen_at: new Date().toISOString(), visits: ((cur?.visits as number | null) || 0) + 1 }).eq('token', token);

  return Response.json({
    customer: { name: c.name, car: [c.car_brand, c.car_model].filter(Boolean).join(' '), color: c.car_color, memberSince, registered: c.created_at },
    membership: { name: MEMBERSHIP.name, common: MEMBERSHIP.common, referrerReward: MEMBERSHIP.referrerReward, referredRewardOptions: MEMBERSHIP.referredRewardOptions, referredCondition: MEMBERSHIP.referredCondition },
    services: (services || []).map((s) => ({ type: s.service_type, date: s.service_date, done: s.completion_date, area: s.service_area, film: s.film_used })),
    care: (followUps || []).map((f) => ({ type: f.follow_up_type, date: f.scheduled_date, done: f.is_completed, doneAt: f.completed_date })),
    upcoming,
    warranties,
    referrals: {
      gave: (gave || []).map((r) => {
        const rid = r.referred_id as string;
        const referred = r.referred as unknown as { name: string } | null;
        return { name: maskName(referred?.name), date: r.created_at, state: doneSet.has(rid) ? '시공 완료' : bookedSet.has(rid) ? '예약' : '연락', reward: r.referrer_reward, rewardAt: r.referrer_reward_used_at };
      }),
      received: received ? { from: maskName((received.referrer as unknown as { name: string } | null)?.name), date: received.created_at, reward: received.referred_reward, rewardAt: received.referred_reward_used_at } : null,
    },
    shop: { name: '3M 프로이즘 강남서초점', phone: '010-7287-7140', address: '서울특별시 서초구 서초중앙로8길 82 1동 1층 1호', card: 'https://proism-ai.vercel.app/card', map: 'https://map.naver.com/p/entry/place/2043882706', talk: 'http://talk.naver.com/wy4w32e' },
  });
}
