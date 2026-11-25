/**
 * 딜러 ↔ 실제 고객 (2026-11-23 사장님 "이카운트 장부는 일반 고객과 딜러 두 가지. 차를 넣어 주는 건 딜러지만 실제 고객은 따로.
 *  작업 상황은 딜러한테, 보증서 같은 것들은 고객한테")
 * - customers.kind('일반'|'딜러') + customers.dealer_id (docs/고객종류-딜러-열-추가-2026-11-23.sql, Supabase 에서 수동 실행)
 * - 열이 아직 없으면(42703) 모든 함수가 빈 값을 돌려주고 화면은 딜러 칸을 숨긴다
 * - 받는 사람 규칙: 입고 안내·출고 안내 → 딜러 / 보증서·회원 페이지·QC·메인터넌스·후기 → 고객
 */
import { supabase } from './supabase';

export const CUSTOMER_KINDS = ['일반', '딜러'] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];
export const DEALER_KIND: CustomerKind = '딜러';

export interface DealerRef { id: string; name: string; phone: string | null; memo?: string | null }

let supported: boolean | null = null;
function isMissingColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  return !!err && (err.code === '42703' || /column .*(kind|dealer_id).* does not exist|schema cache/i.test(err.message || ''));
}
/** 열이 있는지 한 번만 확인해 세션 동안 기억 */
export async function dealerSupport(): Promise<boolean> {
  if (supported !== null) return supported;
  const { error } = await supabase.from('customers').select('kind, dealer_id').limit(1);
  supported = !isMissingColumn(error);
  return supported;
}
export function dealerSupportKnown(): boolean | null { return supported; }
/** 시험용 */
export function _resetDealerSupport() { supported = null; }

export const isDealer = (c: { kind?: string | null } | null | undefined) => (c?.kind || '일반') === DEALER_KIND;

/** 퇴사 딜러 (2026-11-23 사장님 "조직도에 없는 분은 퇴사 표시"): memo 에 "[퇴사 날짜]" 토큰. 기록은 남기되 고객 창의 딜러 고르기·입고/출고 문자 대상에서 뺀다 */
export const RETIRED_RE = /\[퇴사 (\d{4}-\d{2}-\d{2})\]/;
export const isRetiredDealer = (memo: string | null | undefined) => RETIRED_RE.test(memo || '');
export const retiredDate = (memo: string | null | undefined) => (memo || '').match(RETIRED_RE)?.[1] || null;

/** 딜러 목록(고객 기록 중 종류가 딜러인 것) */
export async function loadDealers(): Promise<DealerRef[]> {
  if (!(await dealerSupport())) return [];
  const { data } = await supabase.from('customers').select('id, name, phone, memo').eq('kind', DEALER_KIND).order('name');
  return ((data || []) as DealerRef[]).filter((d) => !isRetiredDealer(d.memo)); // 퇴사한 분은 고르기 목록에서 뺌
}

/** 이 손님의 차를 넣어 준 딜러. 없으면 null */
export async function dealerFor(customerId: string | null | undefined): Promise<DealerRef | null> {
  if (!customerId || !(await dealerSupport())) return null;
  const { data: c } = await supabase.from('customers').select('dealer_id').eq('id', customerId).maybeSingle();
  const dealerId = (c?.dealer_id as string | null) || null;
  if (!dealerId) return null;
  const { data: d } = await supabase.from('customers').select('id, name, phone, memo').eq('id', dealerId).maybeSingle();
  if (!d || isRetiredDealer((d as DealerRef).memo)) return null; // 퇴사한 딜러에겐 입고·출고 안내를 보내지 않는다 → 고객에게
  return d as DealerRef;
}

export interface DealerJob {
  customer: { id: string; name: string; phone: string | null; car_brand: string | null; car_model: string | null; created_at: string };
  latest: { date: string; service_type: string | null; status: string } | null; // 가장 최근 예약(취소 제외) 또는 시공
  /** 이 손님의 시공 기록 (딜러 정산 표시용, 2026-11-25) */
  services: { id: string; service_date: string | null; service_type: string; amount: number | null; memo: string | null }[];
}
/** 딜러가 넣어 준 손님들과 각자의 최근 작업 (딜러 상세 카드용) */
export async function customersOfDealer(dealerId: string): Promise<DealerJob[]> {
  if (!(await dealerSupport())) return [];
  const { data: cs } = await supabase.from('customers').select('id, name, phone, car_brand, car_model, created_at').eq('dealer_id', dealerId).order('created_at', { ascending: false });
  const list = (cs || []) as DealerJob['customer'][];
  if (list.length === 0) return [];
  const ids = list.map((c) => c.id);
  const [{ data: appts }, { data: svcs }] = await Promise.all([
    supabase.from('appointments').select('customer_id, appointment_date, end_date, service_type, status').in('customer_id', ids).neq('status', '취소').order('appointment_date', { ascending: false }),
    supabase.from('services').select('id, customer_id, service_date, service_type, amount, memo').in('customer_id', ids).order('service_date', { ascending: false }),
  ]);
  return list.map((c) => {
    const a = (appts || []).find((x) => x.customer_id === c.id) as { appointment_date: string; service_type: string | null; status: string } | undefined;
    const mine = ((svcs || []) as { id: string; customer_id: string; service_date: string | null; service_type: string; amount: number | null; memo: string | null }[]).filter((x) => x.customer_id === c.id);
    const s = mine[0];
    const latest = a ? { date: a.appointment_date, service_type: a.service_type, status: a.status } : s?.service_date ? { date: s.service_date, service_type: s.service_type, status: '완료' } : null;
    return { customer: c, latest, services: mine.map(({ id, service_date, service_type, amount, memo }) => ({ id, service_date, service_type, amount, memo })) };
  });
}

/** 입고 안내 사후관리 memo 첫 줄에서 받는 사람을 읽는다. 딜러에게 가는 건 "이름(딜러) 전화 · 고객이름 시공 날짜 입고" 꼴 */
export function arrivalRecipient(memo: string | null | undefined): { name: string; phone: string; toDealer: boolean; customerName: string } {
  const head = (memo || '').split('\n')[0];
  const phone = head.match(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/)?.[0] || '';
  const toDealer = /\(딜러\)/.test(head);
  const name = (head.split(' ')[0] || '').replace('(딜러)', '');
  const after = head.includes('·') ? head.split('·')[1].trim() : '';
  const customerName = toDealer ? (after.split(' ')[0] || '') : name;
  return { name, phone, toDealer, customerName };
}
