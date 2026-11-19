-- ============================================
-- 11. referral_points (소개 포인트 — 2026-11-19 사장님 결정)
-- 소개 1건 = 1포인트. 소개받은 분이 시공을 마쳤을 때 소개한 분에게 적립(referral_id 당 한 번).
-- 쓰는 메뉴는 src/config/membership.ts POINTS.menu (모두 "공임 서비스, 필름값만"). 잔액 = delta 합계.
-- 유효기간: 마지막 적립일로부터 2년 (코드에서 계산, 컬럼 없음)
-- Supabase SQL Editor에서 이 블록만 실행
-- ============================================
CREATE TABLE IF NOT EXISTS referral_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,  -- 포인트 주인(소개한 분)
  delta int NOT NULL,                       -- +1 적립 / -N 사용
  reason text NOT NULL,                     -- "김*수 님 소개 시공 완료" / "중간 판 1장 재시공 공임 서비스"
  referral_id uuid REFERENCES referrals(id) ON DELETE SET NULL,  -- 적립 근거(소개 1건당 한 번)
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_points_customer_idx ON referral_points (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS referral_points_referral_uniq ON referral_points (referral_id) WHERE referral_id IS NOT NULL;
