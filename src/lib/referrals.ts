/**
 * 소개 연결 (referrals 표). 표가 아직 없으면 조용히 빈 값 (blog_posts 와 같은 방식)
 */
import { supabase } from './supabase';
import { POINTS } from '@/config/membership';

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

// ── 소개 포인트 (referral_points 표, 2026-11-19) ────────────────────────────

export interface PointRow { id: string; delta: number; reason: string; referral_id: string | null; created_at: string }
export interface PointSummary { balance: number; rows: PointRow[]; lastEarnAt: string | null; expiresAt: string | null; expired: boolean; tableMissing: boolean }

function summarize(rows: PointRow[]): Omit<PointSummary, 'tableMissing'> {
  const earns = rows.filter((r) => r.delta > 0).map((r) => r.created_at).sort();
  const lastEarnAt = earns[earns.length - 1] || null;
  let expiresAt: string | null = null, expired = false;
  if (lastEarnAt) {
    const d = new Date(lastEarnAt); d.setFullYear(d.getFullYear() + POINTS.expiryYears);
    expiresAt = d.toISOString(); expired = d.getTime() < Date.now();
  }
  const raw = rows.reduce((a, r) => a + r.delta, 0);
  return { balance: expired ? 0 : Math.max(0, raw), rows, lastEarnAt, expiresAt, expired };
}

/** 고객의 포인트 잔액·내역. 표가 없으면 tableMissing */
export async function loadPoints(customerId: string): Promise<PointSummary> {
  try {
    const { data, error } = await supabase.from('referral_points').select('id, delta, reason, referral_id, created_at').eq('customer_id', customerId).order('created_at', { ascending: false });
    if (error) return { balance: 0, rows: [], lastEarnAt: null, expiresAt: null, expired: false, tableMissing: true };
    return { ...summarize((data || []) as PointRow[]), tableMissing: false };
  } catch { return { balance: 0, rows: [], lastEarnAt: null, expiresAt: null, expired: false, tableMissing: true }; }
}

/**
 * 소개받은 분(referredId)이 시공을 마쳤을 때 소개한 분에게 1포인트. 소개 1건당 한 번(referral_id unique)
 * 돌려주는 값: 적립됐으면 소개한 분 id·이름, 아니면 null (표 없음·이미 적립·소개 기록 없음은 조용히)
 */
export async function grantPointForReferred(referredId: string): Promise<{ referrerId: string; referrerName: string; referredName: string } | null> {
  try {
    const { data: r } = await supabase.from('referrals').select(SELECT).eq('referred_id', referredId).maybeSingle();
    const ref = r as Referral | null;
    if (!ref?.referrer_id) return null;
    const { error } = await supabase.from('referral_points').insert({ customer_id: ref.referrer_id, delta: 1, reason: `${ref.referred?.name || '고객'} 님 소개 시공 완료`, referral_id: ref.id });
    if (error) return null; // 이미 적립(unique) 또는 표 없음
    return { referrerId: ref.referrer_id, referrerName: ref.referrer?.name || '고객', referredName: ref.referred?.name || '고객' };
  } catch { return null; }
}

/** 소개 1건에 대해 수동 적립 (예전에 완료된 소개). 이미 있으면 안내 문구 */
export async function grantPointForReferral(ref: Referral): Promise<string | null> {
  if (!ref.referrer_id) return '소개한 분이 없습니다';
  const { error } = await supabase.from('referral_points').insert({ customer_id: ref.referrer_id, delta: 1, reason: `${ref.referred?.name || '고객'} 님 소개 시공 완료`, referral_id: ref.id });
  if (!error) return null;
  if (/duplicate|unique/i.test(error.message)) return '이 소개 건은 이미 적립돼 있습니다';
  return /relation .* does not exist|schema cache/i.test(error.message) ? 'referral_points 표가 아직 없습니다. docs/소개포인트-referral_points-표-만들기.sql 을 Supabase SQL Editor 에서 실행해 주세요' : '적립 실패: ' + error.message;
}

/** 포인트 사용 (메뉴 항목). 잔액 부족이면 안내 문구 */
export async function usePoints(customerId: string, cost: number, label: string): Promise<string | null> {
  const cur = await loadPoints(customerId);
  if (cur.tableMissing) return 'referral_points 표가 아직 없습니다. docs/소개포인트-referral_points-표-만들기.sql 을 Supabase SQL Editor 에서 실행해 주세요';
  if (cur.balance < cost) return `포인트가 모자랍니다 (지금 ${cur.balance}점, 필요 ${cost}점)`;
  const { error } = await supabase.from('referral_points').insert({ customer_id: customerId, delta: -cost, reason: label });
  return error ? '사용 기록 실패: ' + error.message : null;
}

/** 포인트 내역 한 줄 지우기(잘못 누른 것) */
export async function deletePointRow(id: string): Promise<boolean> {
  const { error } = await supabase.from('referral_points').delete().eq('id', id);
  return !error;
}

/** 손님 페이지용: 잔액·내역·메뉴 (서버에서도 같은 계산) */
export function pointsView(rows: PointRow[]) {
  const s = summarize(rows);
  return { balance: s.balance, expiresAt: s.expiresAt, expired: s.expired, history: rows.map((r) => ({ date: r.created_at, delta: r.delta, reason: r.reason })), unit: POINTS.unit, earnRule: POINTS.earnRule, menu: POINTS.menu, conditions: POINTS.conditions };
}
