/**
 * 사후관리 흐름 보강 (2026-11-22 사장님 "물어보지 않아도 빈 흐름 찾아서" → 세 가지)
 *  1) 메인터넌스를 완료(또는 미방문 정리)하면 같은 시공 기록에 다음 6개월 메인터넌스를 자동으로 잡는다 — 그동안은 시공 완료 때 1회만 생겨 2회차부터 아무도 연락하지 않았음
 *  2) 예약이 잡히면 그 손님의 열린 견적 재연락·견적 마무리를 자동으로 닫는다 — 이미 예약한 분께 "결정하셨나요" 문자가 나가던 구멍
 *  3) QC·메인터넌스 '미방문' 상태 — 스키마 변경 없이 is_completed=true + memo 첫머리 "미방문 날짜: 사유" 로 표시. 손님 페이지엔 "받으셨습니다"가 아니라 "미방문"으로, 통계 완료 수에서 제외
 */
import { supabase } from './supabase';
import { todaySeoul } from './local-date';

export const SKIP_RE = /^미방문 (\d{4}-\d{2}-\d{2})(?::\s*(.*))?$/m;
export function isSkipped(memo: string | null | undefined): boolean {
  return SKIP_RE.test(memo || '');
}
export function skipReason(memo: string | null | undefined): string {
  const m = (memo || '').match(SKIP_RE);
  return m ? (m[2] || '').trim() : '';
}

/** 작업 내역서(services.memo JSON)에서 메인터넌스 기간(년). maintenance_years 우선, 없으면 보증서 기간 "시공일로부터 N년"(N≥2). 못 찾으면 null */
export function maintenanceYears(memo: string | null | undefined): number | null {
  if (!memo) return null;
  try {
    const j = JSON.parse(memo) as { maintenance_years?: string | number; warranty?: { warranty_period?: string } };
    const my = Number(j.maintenance_years); if (my > 0) return my;
    const m = (j.warranty?.warranty_period || '').match(/(\d+)\s*년/); const y = m ? Number(m[1]) : 0;
    return y >= 2 ? y : null;
  } catch { return null; }
}

/** 메인터넌스 한 건이 끝나면(완료·미방문) 같은 시공 기록에 다음 6개월 메인터넌스. 이미 열린 메인터넌스가 있으면 만들지 않는다. 기간(maintenanceYears) 안에서만 */
export async function scheduleNextMaintenance(f: { service_id: string | null; customer_id: string; follow_up_type: string }, fromDate: string): Promise<string | null> {
  if (f.follow_up_type !== '메인터넌스' || !f.service_id) return null;
  const { data: open } = await supabase.from('follow_ups').select('id').eq('service_id', f.service_id).eq('follow_up_type', '메인터넌스').eq('is_completed', false).limit(1);
  if (open && open.length > 0) return null;
  const { data: svc } = await supabase.from('services').select('service_type, service_date, memo').eq('id', f.service_id).maybeSingle();
  const { count } = await supabase.from('follow_ups').select('id', { count: 'exact', head: true }).eq('service_id', f.service_id).eq('follow_up_type', '메인터넌스');
  const next = new Date(fromDate + 'T00:00:00+09:00');
  next.setMonth(next.getMonth() + 6);
  const iso = new Date(next.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  // 메인터넌스 기간 (2026-11-22 사장님 "보증서 만들 때 2·3·4·5·7·10년 고르고 그 기간 동안"): 시공일 + N년을 넘기면 더 만들지 않는다
  // N 은 작업 내역서 maintenance_years, 없으면 보증서 기간 "시공일로부터 N년"(N≥2). 예전 기본값 '1년'만 있는 기록은 고른 적이 없으므로 한계 없이 계속
  const years = maintenanceYears((svc?.memo as string | null) || null);
  if (years && svc?.service_date) {
    const limit = new Date((svc.service_date as string) + 'T00:00:00+09:00'); limit.setFullYear(limit.getFullYear() + years);
    if (next.getTime() > limit.getTime()) return null;
  }
  const nth = (count || 0) + 1;
  await supabase.from('follow_ups').insert({
    service_id: f.service_id, customer_id: f.customer_id, follow_up_type: '메인터넌스', scheduled_date: iso,
    memo: `${(svc?.service_type as string | null) || '시공'} ${nth}회차 메인터넌스 (6개월마다 자동)`,
  });
  return iso;
}

/** QC·메인터넌스 미방문 정리: 완료 상태로 닫되 memo 에 미방문 표시. 메인터넌스면 다음 회차도 잡는다 */
export async function markFollowUpSkipped(f: { id: string; service_id: string | null; customer_id: string; follow_up_type: string; memo: string | null }, reason: string): Promise<void> {
  const date = todaySeoul();
  const line = `미방문 ${date}${reason.trim() ? `: ${reason.trim()}` : ''}`;
  const memo = [line, (f.memo || '').trim()].filter(Boolean).join('\n');
  await supabase.from('follow_ups').update({ is_completed: true, completed_date: date, memo }).eq('id', f.id);
  await scheduleNextMaintenance(f, date);
}

/** 예약이 잡히면 그 손님의 열린 견적 재연락·마무리를 닫는다. 고객 id 또는(미등록 문의) 메모 첫 줄의 전화번호로 찾는다 */
export async function closeQuoteFollowUpsFor(customerId: string | null | undefined, phone: string | null | undefined): Promise<number> {
  const digits = (phone || '').replace(/\D/g, '');
  const { data } = await supabase.from('follow_ups').select('id, customer_id, memo').in('follow_up_type', ['견적재연락', '견적마무리']).eq('is_completed', false);
  const hits = (data || []).filter((r) => {
    if (customerId && r.customer_id === customerId) return true;
    if (digits.length >= 10) { const head = ((r.memo as string | null) || '').split('\n')[0].replace(/\D/g, ''); return head.includes(digits); }
    return false;
  });
  if (hits.length === 0) return 0;
  const date = todaySeoul();
  for (const r of hits) {
    await supabase.from('follow_ups').update({ is_completed: true, completed_date: date, memo: `${((r.memo as string | null) || '').trim()}\n예약 잡혀 자동 정리 ${date}`.trim() }).eq('id', r.id);
  }
  return hits.length;
}

// ─── 견적 종결 (2026-11-22 점검 2-1): 재연락이 영원히 미처리로 남지 않게 ───
export const QUOTE_CLOSE_REASONS = ['다른 곳에서 함', '연락 없음', '보류'] as const;
export type QuoteCloseReason = typeof QUOTE_CLOSE_REASONS[number];
export const QUOTE_CLOSE_RE = /^견적 종결 (\d{4}-\d{2}-\d{2}): (.+)$/m;
export function quoteCloseReason(memo: string | null | undefined): string {
  const m = (memo || '').match(QUOTE_CLOSE_RE);
  return m ? m[2].trim() : '';
}
/** 견적 재연락·마무리 한 쌍(같은 고객 또는 같은 메모 첫 줄)을 사유와 함께 닫는다 */
export async function closeQuoteAs(f: { id: string; customer_id: string | null; memo: string | null }, reason: QuoteCloseReason): Promise<number> {
  const date = todaySeoul();
  const head = (f.memo || '').split('\n')[0].trim();
  const { data } = await supabase.from('follow_ups').select('id, customer_id, memo').in('follow_up_type', ['견적재연락', '견적마무리']).eq('is_completed', false);
  const targets = (data || []).filter((r) => r.id === f.id || (f.customer_id && r.customer_id === f.customer_id) || (head && ((r.memo as string | null) || '').split('\n')[0].trim() === head));
  for (const r of targets) {
    await supabase.from('follow_ups').update({ is_completed: true, completed_date: date, memo: `견적 종결 ${date}: ${reason}\n${((r.memo as string | null) || '').trim()}`.trim() }).eq('id', r.id);
  }
  return targets.length;
}
