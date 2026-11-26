import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { maskName } from '@/lib/member-links';
import { MEMBERSHIP } from '@/config/membership';
import { parseWorkOrder, workItems, type WorkOrderJson } from '@/lib/work-order';
import { AUTH_COOKIE_NAME, isAuthCookieValid } from '@/lib/auth-cookie';
import { pointsView, type PointRow } from '@/lib/referrals';
import { parseCareLog } from '@/lib/care-log';
import { isSkipped, maintenanceYears } from '@/lib/followups';
import { careGuidesFor, CARE_COMMON_LINE } from '@/config/care-guide';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** 뒷자리 시도 제한 (2026-11-19): 같은 주소에서 5번 틀리면 10분 잠금. 서버 인스턴스 메모리라 인스턴스가 바뀌면 초기화되는 가벼운 보호 */
const PIN_FAILS = new Map<string, { n: number; until: number }>();
const PIN_MAX = 5, PIN_LOCK_MS = 10 * 60 * 1000;
function pinLocked(token: string): number { const f = PIN_FAILS.get(token); if (!f) return 0; if (f.until && f.until > Date.now()) return Math.ceil((f.until - Date.now()) / 60000); if (f.until && f.until <= Date.now()) PIN_FAILS.delete(token); return 0; }
function pinFail(token: string): number { const f = PIN_FAILS.get(token) || { n: 0, until: 0 }; f.n += 1; if (f.n >= PIN_MAX) { f.until = Date.now() + PIN_LOCK_MS; f.n = 0; } PIN_FAILS.set(token, f); return f.until ? PIN_MAX : PIN_MAX - f.n; }

/**
 * GET /api/member/<token> (헤더 x-member-pin: 1234) — 손님용 회원 페이지 데이터 (2026-11-18)
 * - 로그인 없이 열리는 경로(미들웨어 예외). token 이 맞고 pin 이 그 고객 전화 뒷자리 4개와 같을 때만 돌려준다
 * - 다른 사람 이름은 가리고, 전화번호·금액은 내려보내지 않는다
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // 뒷자리는 헤더로만 받는다 (주소창·서버 로그에 안 남게). 2026-11-19
  const pin = (request.headers.get('x-member-pin') || '').replace(/\D/g, '').slice(0, 4);
  // CRM 에 로그인된 기기(사장님)는 뒷자리 없이 손님 화면 그대로 본다 (2026-11-19 사장님 "고객 상세에서 나도 들어갈 수 있게")
  const owner = await isAuthCookieValid(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  if (!token || token.length < 12) return Response.json({ error: '잘못된 주소입니다' }, { status: 404 });

  const { data: link, error: e1 } = await supabase.from('member_links').select('customer_id').eq('token', token).maybeSingle();
  if (e1) return Response.json({ error: '회원 페이지가 아직 준비되지 않았습니다' }, { status: 503 });
  if (!link) return Response.json({ error: '없는 주소입니다' }, { status: 404 });

  const { data: c } = await supabase.from('customers').select('id, name, phone, car_brand, car_model, car_color, created_at').eq('id', link.customer_id).single();
  if (!c) return Response.json({ error: '고객 정보를 찾을 수 없습니다' }, { status: 404 });
  const last4 = (c.phone || '').replace(/\D/g, '').slice(-4);
  if (!owner) {
    const lockedMin = pinLocked(token);
    if (lockedMin) return Response.json({ error: `여러 번 틀려 잠시 막혔습니다. ${lockedMin}분 뒤에 다시 시도해 주세요` }, { status: 429 });
    if (!pin) return Response.json({ needPin: true, name: maskName(c.name) });
    if (!last4 || pin !== last4) {
      const left = pinFail(token);
      return Response.json({ error: left >= PIN_MAX ? `5번 틀려 10분 동안 막혔습니다. 번호가 바뀌셨으면 매장으로 연락 주세요` : `전화번호 뒷자리가 맞지 않습니다 (${left}번 더 틀리면 10분 잠김)` }, { status: 401 });
    }
    PIN_FAILS.delete(token);
  }

  const [{ data: services }, { data: followUps }, { data: appts }, { data: gave }, { data: received }, { data: pointRows }] = await Promise.all([
    supabase.from('services').select('id, service_type, service_date, completion_date, service_area, film_used, memo').eq('customer_id', c.id).order('service_date', { ascending: false }),
    supabase.from('follow_ups').select('id, follow_up_type, scheduled_date, is_completed, completed_date, service_id, memo').eq('customer_id', c.id).in('follow_up_type', ['QC점검', '메인터넌스', '리터치']).order('scheduled_date', { ascending: true }),
    supabase.from('appointments').select('id, appointment_date, end_date, service_type, status, memo').eq('customer_id', c.id).neq('status', '취소').order('appointment_date', { ascending: false }),
    supabase.from('referrals').select('id, referred_id, created_at, referrer_reward, referrer_reward_used_at, referred:customers!referrals_referred_id_fkey(name)').eq('referrer_id', c.id).order('created_at', { ascending: false }),
    supabase.from('referrals').select('id, referrer_id, created_at, referred_reward, referred_reward_used_at, referrer:customers!referrals_referrer_id_fkey(name)').eq('referred_id', c.id).maybeSingle(),
    supabase.from('referral_points').select('id, delta, reason, referral_id, created_at').eq('customer_id', c.id).order('created_at', { ascending: false }), // 표 없으면 null → 빈 포인트
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
      photos: Array.isArray(w.photos) ? w.photos.slice(0, 6) : [], // 완료 처리 때 붙인 작업 사진 (2026-11-25)
    }));

  // 작업 내역서 없이 들어온 시공(이카운트·타임트리 가져오기, 고객 상세 '시공 추가')도 증명서 줄로 — 회원 107명의 증명서 탭이 비어 보이던 것 (2026-11-26)
  const near = (a: string, b: string) => Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000) <= 3;
  const fromServices = (services || [])
    .filter((s) => s.service_date && !warranties.some((w) => w.date && near(w.date, s.service_date as string)))
    .map((s) => {
      const memoText = String(s.memo || '');
      const fromMemo = memoText.trim().startsWith('{') ? '' : (memoText.match(/전표 [^·]+ · ([^·]+)/)?.[1] || '').trim(); // "이카운트 … · 전표 번호 · 품목명 · …" 의 품목명
      const text = (s.film_used || s.service_area || fromMemo || '').trim();
      return { date: s.service_date as string, end: null as string | null, work: `${s.service_type} 시공`, period: '', url: null as string | null, items: [{ group: s.service_type as string, text: text || '시공 내역은 매장 기록 기준' }], certNo: `PZ-${String(s.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`, photos: [] as string[] };
    });
  const allWarranties = [...warranties, ...fromServices].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // QC·메인터넌스 방문 예약(2026-11-22)은 '다음 관리'에 방문일로 보이게 하고, 예약 목록에서는 뺀다 (두 번 보이지 않게)
  const visitByFollowUp = new Map<string, string>();
  for (const a of (appts || []) as { appointment_date: string; status: string; service_type: string | null; follow_up_id?: string | null; memo: string | null }[]) {
    if (!['QC점검', '메인터넌스'].includes(a.service_type || '') || a.status === '완료' || a.status === '취소') continue;
    const fid = a.follow_up_id || (a.memo || '').match(/사후관리:([0-9a-f-]{36})/)?.[1];
    if (fid) visitByFollowUp.set(fid, a.appointment_date);
  }
  const isCareVisit = (a: { service_type: string | null; follow_up_id?: string | null; memo: string | null }) => ['QC점검', '메인터넌스'].includes(a.service_type || '') && !!(a.follow_up_id || /사후관리:[0-9a-f-]{36}/.test(a.memo || ''));
  const upcoming = (appts || []).filter((a) => a.status !== '완료' && !isCareVisit(a as { service_type: string | null; follow_up_id?: string | null; memo: string | null })).map((a) => ({ date: a.appointment_date, end: a.end_date, service: a.service_type, status: a.status }));
  const memberSince = (services || []).map((s) => s.service_date || s.completion_date || '').filter(Boolean).sort()[0] || null;

  // 방문 기록 (실패해도 페이지는 그대로). 사장님이 열어 본 것은 손님 방문 수에 넣지 않는다
  if (!owner) {
    const { data: cur } = await supabase.from('member_links').select('visits').eq('token', token).maybeSingle();
    await supabase.from('member_links').update({ last_seen_at: new Date().toISOString(), visits: ((cur?.visits as number | null) || 0) + 1 }).eq('token', token);
  }

  return Response.json({
    owner,
    customer: { name: c.name, car: [c.car_brand, c.car_model].filter(Boolean).join(' '), color: c.car_color, memberSince, registered: c.created_at },
    membership: { name: MEMBERSHIP.name, common: MEMBERSHIP.common, referrerReward: MEMBERSHIP.referrerReward, referredRewardOptions: MEMBERSHIP.referredRewardOptions, referredCondition: MEMBERSHIP.referredCondition },
    services: (services || []).map((s) => ({ id: s.id, type: s.service_type, date: s.service_date, done: s.completion_date, area: s.service_area, film: s.film_used })),
    // 내 차 관리법 (2026-11-22): 시공 종류 + 작업 내역서 항목 묶음(PPF·썬팅·컬러PPF·랩핑·코팅)으로 해당하는 안내만
    careYears: (services || []).map((sv) => maintenanceYears((sv as { memo?: string | null }).memo || null)).find((y) => !!y) || null, // 메인터넌스 기간(년) — 손님 페이지 관리 탭 안내 (2026-11-22)
    careGuide: { guides: careGuidesFor((services || []).map((s) => s.service_type as string), allWarranties.flatMap((w) => w.items.map((i) => i.group))), common: CARE_COMMON_LINE },
    // 2026-11-18 "기한 지나 정리"로 일괄 완료 처리된 건(실제 점검 기록 아님)은 손님에게 "받으셨습니다"로 보이면 안 되므로 뺀다 (2026-11-19 사장님). CRM 에는 그대로
    care: (followUps || []).filter((f) => !(f.is_completed && /기한 지나 정리|^블랙리스트로 정리 /m.test((f.memo as string | null) || ''))).map((f) => { const log = parseCareLog(f.memo as string | null); return { type: f.follow_up_type, date: f.scheduled_date, done: f.is_completed, skipped: isSkipped(f.memo as string | null), visitDate: visitByFollowUp.get(f.id as string) || null, doneAt: f.completed_date, serviceId: (f.service_id as string | null) || null, note: log?.note || null, photos: log?.photos || [] }; }), // note·photos: 점검 기록 (2026-11-22, src/lib/care-log.ts) // serviceId: 시공 건별로 묶어 보이기 (2026-11-19 사장님 "기존 작업과 새 작업은 따로 분류")
    upcoming,
    warranties: allWarranties,
    referrals: {
      gave: (gave || []).map((r) => {
        const rid = r.referred_id as string;
        const referred = r.referred as unknown as { name: string } | null;
        return { name: maskName(referred?.name), date: r.created_at, state: doneSet.has(rid) ? '시공 완료' : bookedSet.has(rid) ? '예약' : '연락', reward: r.referrer_reward, rewardAt: r.referrer_reward_used_at };
      }),
      received: received ? { from: maskName((received.referrer as unknown as { name: string } | null)?.name), date: received.created_at, reward: received.referred_reward, rewardAt: received.referred_reward_used_at } : null,
    },
    points: (() => { const v = pointsView((pointRows || []) as PointRow[]); return { ...v, history: v.history.map((h) => ({ ...h, reason: h.reason.replace(/^(\S+) 님 소개/, (_m, n: string) => `${maskName(n)} 님 소개`) })) }; })(), // 소개 포인트 (2026-11-19). 적립 사유의 다른 손님 이름은 가린다
    shop: { name: '3M 프로이즘 강남서초점', phone: '010-7287-7140', address: '서울특별시 서초구 서초중앙로8길 82 1동 1층 1호', card: 'https://proism-ai.vercel.app/card', map: 'https://map.naver.com/p/entry/place/2043882706', talk: 'http://talk.naver.com/wy4w32e' },
  });
}
