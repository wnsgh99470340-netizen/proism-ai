/**
 * 예약 상태 흐름 (2026-11-22 생애 흐름 점검 추천 2)
 *  - 시작일이 되면 예약확정 → 시공중 자동 (QC·메인터넌스 방문·상담중은 제외). 아침 크론과 CRM 화면 로드 양쪽에서 호출, 몇 번 돌려도 같은 결과
 *  - 끝난 날이 지났는데 완료가 안 된 예약 목록 (홈 카드 "완료 처리할 예약")
 *  - 고객 등록 때 같은 번호로 남은 미연결 상담 기록·견적 재연락을 그 고객에 붙이기
 */
import { supabase } from './supabase';
import { todaySeoul } from './local-date';

const CARE_VISIT_TYPES = ['QC점검', '메인터넌스'];

/** 시작일 ≤ 오늘 ≤ 종료일인 예약확정 → 시공중. 돌려준 값 = 바꾼 건수 */
export async function advanceAppointmentsForToday(date = todaySeoul()): Promise<number> {
  const { data } = await supabase.from('appointments').select('id, appointment_date, end_date, service_type').eq('status', '예약확정').lte('appointment_date', date);
  const targets = (data || []).filter((a) => ((a.end_date as string | null) || (a.appointment_date as string)) >= date && !CARE_VISIT_TYPES.includes((a.service_type as string | null) || ''));
  if (targets.length === 0) return 0;
  await supabase.from('appointments').update({ status: '시공중' }).in('id', targets.map((a) => a.id as string));
  return targets.length;
}

export interface OverdueAppointment { id: string; customer_id: string; appointment_date: string; end_date: string | null; service_type: string | null; status: string; customer?: { name: string; phone: string | null } | null }

/** 끝난 날이 지났는데 예약확정·시공중인 예약 (완료 처리를 기다리는 것). QC·메인터넌스 방문은 '점검 완료'를 기다리는 것이라 같이 보여 준다 */
export function overdueAppointments<T extends { appointment_date: string; end_date?: string | null; status: string }>(appointments: T[], date = todaySeoul()): T[] {
  return appointments.filter((a) => (a.status === '예약확정' || a.status === '시공중') && ((a.end_date || a.appointment_date) < date));
}

/** 고객 등록 때: 같은 번호로 남은 미연결 상담 기록·견적 재연락을 이 고객에 붙인다 (견적 문자 경로에만 있던 것을 공통으로) */
export async function linkOrphanRecordsByPhone(customerId: string, phone: string | null | undefined): Promise<{ consultations: number; followUps: number }> {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10) return { consultations: 0, followUps: 0 };
  const { data: cons } = await supabase.from('consultations').select('id, memo, content').is('customer_id', null);
  const consIds = (cons || []).filter((c) => `${c.memo || ''} ${c.content || ''}`.replace(/\D/g, '').includes(digits)).map((c) => c.id as string);
  if (consIds.length) await supabase.from('consultations').update({ customer_id: customerId }).in('id', consIds);
  const { data: fus } = await supabase.from('follow_ups').select('id, memo').is('customer_id', null);
  const fuIds = (fus || []).filter((f) => ((f.memo as string | null) || '').split('\n')[0].replace(/\D/g, '').includes(digits)).map((f) => f.id as string);
  if (fuIds.length) await supabase.from('follow_ups').update({ customer_id: customerId }).in('id', fuIds);
  return { consultations: consIds.length, followUps: fuIds.length };
}
