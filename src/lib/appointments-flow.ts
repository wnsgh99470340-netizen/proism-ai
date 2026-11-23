/**
 * 예약 상태 흐름 (2026-11-22 생애 흐름 점검 추천 2)
 *  - 시작일이 되면 예약확정 → 시공중 자동 (QC·메인터넌스 방문·상담중은 제외). 아침 크론과 CRM 화면 로드 양쪽에서 호출, 몇 번 돌려도 같은 결과
 *  - 끝난 날이 지났는데 완료가 안 된 예약 목록 (홈 카드 "완료 처리할 예약")
 *  - 고객 등록 때 같은 번호로 남은 미연결 상담 기록·견적 재연락을 그 고객에 붙이기
 */
import { supabase } from './supabase';
import { todaySeoul, addDaysISO } from './local-date';
import { arrivalSms, dealerArrivalSms } from '@/config/sms-templates';
import { dealerFor } from './dealers';
import { linkReferral } from './referrals';

const CARE_VISIT_TYPES = ['QC점검', '메인터넌스'];

/** 시작일 ≤ 오늘 ≤ 종료일인 예약확정 → 시공중. 돌려준 값 = 바꾼 건수 */
export async function advanceAppointmentsForToday(date = todaySeoul()): Promise<number> {
  const { data } = await supabase.from('appointments').select('id, appointment_date, end_date, service_type').eq('status', '예약확정').lte('appointment_date', date);
  const targets = (data || []).filter((a) => ((a.end_date as string | null) || (a.appointment_date as string)) >= date && !CARE_VISIT_TYPES.includes((a.service_type as string | null) || ''));
  // 지나간 입고 안내는 닫는다 (보냈든 안 보냈든 어제 일)
  await supabase.from('follow_ups').update({ is_completed: true, completed_date: date }).eq('follow_up_type', '입고안내').eq('is_completed', false).lt('scheduled_date', date);
  if (targets.length === 0) return 0;
  await supabase.from('appointments').update({ status: '시공중' }).in('id', targets.map((a) => a.id as string));
  return targets.length;
}

// ─── 입고 전날 안내 (2026-11-22 점검 3-2): 예약이 잡히면 D-1 에 '입고안내' 사후관리 → 아침 브리핑·홈 카드에 문자 버튼으로 ───
export const ARRIVAL_TYPE = '입고안내';
const SKIP_ARRIVAL_TYPES = ['QC점검', '메인터넌스'];
export async function ensureArrivalNotice(input: { customerId: string; name: string; phone: string | null | undefined; date: string; serviceType: string | null | undefined; car?: string | null }): Promise<boolean> {
  if (!input.customerId || !input.date || SKIP_ARRIVAL_TYPES.includes(input.serviceType || '')) return false;
  const today = todaySeoul();
  const noticeDate = addDaysISO(input.date, -1);
  if (noticeDate < today) return false; // 내일이거나 지난 예약이면 안내할 전날이 없다
  const { data: existing } = await supabase.from('follow_ups').select('id, memo').eq('customer_id', input.customerId).eq('follow_up_type', ARRIVAL_TYPE).eq('is_completed', false);
  if ((existing || []).some((r) => ((r.memo as string | null) || '').includes(`${input.date} 입고`))) return false;
  // 딜러가 넣어 준 차면 입고 안내는 딜러에게 (2026-11-23 사장님). memo 첫 줄 "딜러이름(딜러) 전화 · 고객이름 시공 날짜 입고" → 홈·브리핑·사후관리 탭이 이 번호로 연다
  const dealer = await dealerFor(input.customerId);
  let car = input.car ?? null;
  if (dealer && car === null) { const { data: c } = await supabase.from('customers').select('car_brand, car_model').eq('id', input.customerId).maybeSingle(); car = [c?.car_brand, c?.car_model].filter(Boolean).join(' ') || null; }
  const head = dealer
    ? `${dealer.name}(딜러) ${dealer.phone || ''} · ${input.name} ${input.serviceType || '시공'} ${input.date} 입고`.replace(/\s+·/, ' ·')
    : `${input.name} ${input.phone || ''} · ${input.serviceType || '시공'} ${input.date} 입고`.replace(/\s+·/, ' ·');
  const body = dealer ? dealerArrivalSms(dealer.name, input.name, car, input.date, input.serviceType || null) : arrivalSms(input.name, input.date, input.serviceType || null);
  await supabase.from('follow_ups').insert({ customer_id: input.customerId, follow_up_type: ARRIVAL_TYPE, scheduled_date: noticeDate, is_completed: false, memo: `${head}\n${body}` });
  return true;
}
/** 예약 날짜가 바뀌거나 취소되면 그 날짜의 열린 입고 안내를 지우고(취소) 새 날짜로 다시 만든다(변경) */
export async function resyncArrivalNotice(input: { customerId: string; name: string; phone: string | null | undefined; oldDate: string; newDate: string | null; serviceType: string | null | undefined }): Promise<void> {
  const { data } = await supabase.from('follow_ups').select('id, memo').eq('customer_id', input.customerId).eq('follow_up_type', ARRIVAL_TYPE).eq('is_completed', false);
  const ids = (data || []).filter((r) => ((r.memo as string | null) || '').includes(`${input.oldDate} 입고`)).map((r) => r.id as string);
  if (ids.length) await supabase.from('follow_ups').delete().in('id', ids);
  if (input.newDate) await ensureArrivalNotice({ customerId: input.customerId, name: input.name, phone: input.phone, date: input.newDate, serviceType: input.serviceType });
}

export interface OverdueAppointment { id: string; customer_id: string; appointment_date: string; end_date: string | null; service_type: string | null; status: string; customer?: { name: string; phone: string | null } | null }

/** 끝난 날이 지났는데 예약확정·시공중인 예약 (완료 처리를 기다리는 것). QC·메인터넌스 방문은 '점검 완료'를 기다리는 것이라 같이 보여 준다 */
export function overdueAppointments<T extends { appointment_date: string; end_date?: string | null; status: string }>(appointments: T[], date = todaySeoul()): T[] {
  return appointments.filter((a) => (a.status === '예약확정' || a.status === '시공중') && ((a.end_date || a.appointment_date) < date));
}

/** 고객 등록 때: 같은 번호로 남은 미연결 상담 기록·견적 재연락을 이 고객에 붙인다 (견적 문자 경로에만 있던 것을 공통으로) */
export async function linkOrphanRecordsByPhone(customerId: string, phone: string | null | undefined, opts: { alreadyReferrer?: string | null } = {}): Promise<{ consultations: number; followUps: number; referrerLinked: string | null }> {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10) return { consultations: 0, followUps: 0, referrerLinked: null };
  const { data: cons } = await supabase.from('consultations').select('id, memo, content').is('customer_id', null);
  const mine = (cons || []).filter((c) => `${c.memo || ''} ${c.content || ''}`.replace(/\D/g, '').includes(digits));
  const consIds = mine.map((c) => c.id as string);
  if (consIds.length) await supabase.from('consultations').update({ customer_id: customerId }).in('id', consIds);
  // 상담 기록에 "소개: 이름 [ref:id]" 가 있으면 소개 관계를 자동으로 잇고 유입경로를 소개/재방문으로 (2026-11-22 점검 9-2). 등록 창에서 이미 골랐으면 건너뜀
  let referrerLinked: string | null = null;
  if (!opts.alreadyReferrer) {
    for (const c of mine) {
      const m = `${c.memo || ''}`.match(/소개: ([^\[·]+?) \[ref:([0-9a-f-]{36})\]/);
      if (!m || m[2] === customerId) continue;
      const err = await linkReferral(customerId, m[2]);
      if (!err) {
        referrerLinked = m[1].trim();
        const { data: cu } = await supabase.from('customers').select('source').eq('id', customerId).maybeSingle();
        if (!cu?.source || cu.source === '경로X' || cu.source === '기타') await supabase.from('customers').update({ source: '소개/재방문' }).eq('id', customerId);
      }
      break;
    }
  }
  const { data: fus } = await supabase.from('follow_ups').select('id, memo').is('customer_id', null);
  const fuIds = (fus || []).filter((f) => ((f.memo as string | null) || '').split('\n')[0].replace(/\D/g, '').includes(digits)).map((f) => f.id as string);
  if (fuIds.length) await supabase.from('follow_ups').update({ customer_id: customerId }).in('id', fuIds);
  return { consultations: consIds.length, followUps: fuIds.length, referrerLinked };
}
