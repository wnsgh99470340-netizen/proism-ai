-- 2026-11-18 고객 멤버십: 소개 연결 표. Supabase 대시보드 → SQL Editor → 아래 전체 붙여넣고 Run 한 번.
CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  referred_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  referred_reward text,
  referred_reward_used_at date,
  referrer_reward text,
  referrer_reward_used_at date,
  thanks_sms_sent_at timestamptz,
  memo text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_id);
CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_uniq ON referrals (referred_id);
