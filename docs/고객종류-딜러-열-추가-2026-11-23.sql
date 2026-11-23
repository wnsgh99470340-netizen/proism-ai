-- 고객 종류(일반/딜러) + 넣어 주신 딜러 연결 (2026-11-23 사장님 "이카운트 장부처럼 일반 고객과 딜러 두 가지")
-- Supabase SQL Editor 에서 한 번 실행. 코드는 열이 없으면 딜러 칸을 숨기고 예전처럼 돈다.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT '일반';          -- '일반' | '딜러'
ALTER TABLE customers ADD COLUMN IF NOT EXISTS dealer_id uuid REFERENCES customers(id) ON DELETE SET NULL; -- 이 손님 차를 넣어 준 딜러(고객 기록)
CREATE INDEX IF NOT EXISTS customers_dealer_idx ON customers (dealer_id);
CREATE INDEX IF NOT EXISTS customers_kind_idx ON customers (kind);
