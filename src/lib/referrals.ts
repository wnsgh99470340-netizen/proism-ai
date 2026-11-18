/**
 * 소개 연결 (referrals 표). 표가 아직 없으면 조용히 빈 값 (blog_posts 와 같은 방식)
 */
import { supabase } from './supabase';

export interface Referral {
  id: string;
  referrer_id: string | null;
  referred_id: string;
  referred_reward: string | null;
  referred_reward_used_at: string | null;
  referrer_reward: string | null;
  referrer_reward_used_at: string | null;
  thanks_sms_sent_at: string | null;
  memo: string | null;
  created_at: string;
  referrer?: { name: string; phone: string | null } | null;
  referred?: { name: string; phone: string | null } | null;
}

const SELECT = '*, referrer:customers!referrals_referrer_id_fkey(name, phone), referred:customers!referrals_referred_id_fkey(name, phone)';

/** 이 고객이 소개받은 기록(있으면 1건)과 이 고객이 소개한 기록들 */
export async function loadReferralsFor(customerId: string): Promise<{ receivedFrom: Referral | null; gave: Referral[]; tableMissing: boolean }> {
  try {
    const [{ data: r1, error: e1 }, { data: r2, error: e2 }] = await Promise.all([
      supabase.from('referrals').select(SELECT).eq('referred_id', customerId).maybeSingle(),
      supabase.from('referrals').select(SELECT).eq('referrer_id', customerId).order('created_at', { ascending: false }),
    ]);
    if (e1 || e2) return { receivedFrom: null, gave: [], tableMissing: true };
    return { receivedFrom: (r1 as Referral | null) || null, gave: (r2 || []) as Referral[], tableMissing: false };
  } catch {
    return { receivedFrom: null, gave: [], tableMissing: true };
  }
}

/** 소개 연결 저장(소개받은 고객당 1건, 있으면 소개한 분만 바꿈). 실패 문구를 돌려줌 */
export async function linkReferral(referredId: string, referrerId: string): Promise<string | null> {
  if (referredId === referrerId) return '본인을 소개한 분으로 고를 수 없습니다';
  const { error } = await supabase.from('referrals').upsert({ referred_id: referredId, referrer_id: referrerId }, { onConflict: 'referred_id' });
  if (error) return /relation .* does not exist|schema cache/i.test(error.message) ? 'referrals 표가 아직 없습니다. supabase-schema.sql 9번 블록을 Supabase SQL Editor 에서 실행해 주세요' : '소개 연결 저장 실패: ' + error.message;
  return null;
}

export async function updateReferral(id: string, patch: Partial<Pick<Referral, 'referred_reward' | 'referred_reward_used_at' | 'referrer_reward' | 'referrer_reward_used_at' | 'thanks_sms_sent_at' | 'memo'>>): Promise<string | null> {
  const { error } = await supabase.from('referrals').update(patch).eq('id', id);
  return error ? '저장 실패: ' + error.message : null;
}

export async function unlinkReferral(id: string): Promise<boolean> {
  const { error } = await supabase.from('referrals').delete().eq('id', id);
  return !error;
}

/** 소개 감사 문자 보냄 표시 (소개받은 고객 기준) */
export async function markThanksSent(referredId: string): Promise<void> {
  await supabase.from('referrals').update({ thanks_sms_sent_at: new Date().toISOString() }).eq('referred_id', referredId);
}
