/**
 * 블랙리스트 (2026-11-22 사장님 "블랙리스트 창 만들어서 임권 집어넣어")
 * - 스키마 변경 없이 customers.memo 끝에 "[블랙리스트 날짜: 사유]" 토큰으로 표시. 해제하면 토큰만 지운다
 * - 고객 목록 ⛔ 배지, 고객 상세 빨간 띠, 예약 추가 고객 고르기 ⛔, 상담 추가·견적 문자·문의 답변에서 전화번호가 맞으면 경고 띠
 * - 손님 페이지에는 아무것도 안 보인다
 */
import { supabase } from './supabase';
import { todaySeoul } from './local-date';

export const BLACKLIST_RE = /\[블랙리스트 (\d{4}-\d{2}-\d{2}): ([^\]]*)\]/;

export interface BlacklistInfo { date: string; reason: string }

export function blacklistInfo(memo: string | null | undefined): BlacklistInfo | null {
  const m = (memo || '').match(BLACKLIST_RE);
  return m ? { date: m[1], reason: m[2].trim() } : null;
}
export const isBlacklisted = (memo: string | null | undefined) => BLACKLIST_RE.test(memo || '');
/** 메모 표시용: 토큰 제거 */
export function stripBlacklist(memo: string | null | undefined): string {
  return (memo || '').replace(BLACKLIST_RE, '').replace(/\n{2,}/g, '\n').trim();
}

export async function setBlacklist(customerId: string, reason: string): Promise<string | null> {
  const { data } = await supabase.from('customers').select('memo').eq('id', customerId).maybeSingle();
  const base = stripBlacklist((data?.memo as string | null) || '');
  const token = `[블랙리스트 ${todaySeoul()}: ${reason.trim() || '사유 미기입'}]`;
  const { error } = await supabase.from('customers').update({ memo: [base, token].filter(Boolean).join('\n') }).eq('id', customerId);
  return error ? error.message : null;
}
export async function clearBlacklist(customerId: string): Promise<string | null> {
  const { data } = await supabase.from('customers').select('memo').eq('id', customerId).maybeSingle();
  const { error } = await supabase.from('customers').update({ memo: stripBlacklist((data?.memo as string | null) || '') || null }).eq('id', customerId);
  return error ? error.message : null;
}

export interface BlacklistedCustomer { id: string; name: string; phone: string | null; car: string; date: string; reason: string }
export async function loadBlacklist(): Promise<BlacklistedCustomer[]> {
  const { data } = await supabase.from('customers').select('id, name, phone, car_brand, car_model, memo').like('memo', '%[블랙리스트 %');
  return (data || []).map((c) => { const i = blacklistInfo(c.memo as string | null); return i ? { id: c.id as string, name: c.name as string, phone: (c.phone as string | null) || null, car: [c.car_brand, c.car_model].filter(Boolean).join(' '), date: i.date, reason: i.reason } : null; }).filter((x): x is BlacklistedCustomer => !!x).sort((a, b) => b.date.localeCompare(a.date));
}

/** 전화번호로 블랙리스트 확인 (상담 추가·견적 문자·문의 답변에서) */
export async function blacklistByPhone(phone: string | null | undefined): Promise<BlacklistedCustomer | null> {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const list = await loadBlacklist();
  return list.find((c) => (c.phone || '').replace(/\D/g, '') === digits) || null;
}
