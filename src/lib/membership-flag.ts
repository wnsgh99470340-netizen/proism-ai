/**
 * 회원 등록 표시 (2026-11-26 사장님 "내가 회원 등록 버튼 누르면 회원 등록되게").
 * 그동안 회원 = 시공 기록이 있는 모든 손님이었는데, 크롬죽이기·실내 PPF 한 건에도 회원이 되는 게 맞지 않아
 * 사장님이 누른 분만 회원으로. 스키마 변경 없이 블랙리스트처럼 customers.memo 끝에 "[회원 YYYY-MM-DD]" 토큰.
 * 기존 159명은 2026-11-26 전원 표시해 두고 사장님이 '회원 해제'로 내린다.
 */
import { supabase } from './supabase';
import { todaySeoul } from './local-date';

export const MEMBER_RE = /\[회원 (\d{4}-\d{2}-\d{2})\]/;

export const isMemberFlag = (memo: string | null | undefined) => MEMBER_RE.test(memo || '');
export function memberSinceFlag(memo: string | null | undefined): string | null {
  const m = (memo || '').match(MEMBER_RE);
  return m ? m[1] : null;
}
/** 메모 표시용: 토큰 제거 */
export function stripMemberFlag(memo: string | null | undefined): string {
  return (memo || '').replace(MEMBER_RE, '').replace(/\n{2,}/g, '\n').trim();
}
/** 토큰 붙인 메모 (순수) */
export function withMemberFlag(memo: string | null | undefined, date = todaySeoul()): string {
  return [stripMemberFlag(memo), `[회원 ${date}]`].filter(Boolean).join('\n');
}

export async function registerMember(customerId: string, date = todaySeoul()): Promise<string | null> {
  const { data } = await supabase.from('customers').select('memo').eq('id', customerId).maybeSingle();
  if (isMemberFlag(data?.memo as string | null)) return null;
  const { error } = await supabase.from('customers').update({ memo: withMemberFlag((data?.memo as string | null) || '', date) }).eq('id', customerId);
  return error ? error.message : null;
}
export async function unregisterMember(customerId: string): Promise<string | null> {
  const { data } = await supabase.from('customers').select('memo').eq('id', customerId).maybeSingle();
  const { error } = await supabase.from('customers').update({ memo: stripMemberFlag((data?.memo as string | null) || '') || null }).eq('id', customerId);
  return error ? error.message : null;
}
export async function isCustomerMember(customerId: string | null | undefined): Promise<boolean> {
  if (!customerId) return false;
  const { data } = await supabase.from('customers').select('memo').eq('id', customerId).maybeSingle();
  return isMemberFlag(data?.memo as string | null);
}
