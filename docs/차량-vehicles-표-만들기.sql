-- 고객 1명 : 차량 N대 (2026-11-22 사장님 "같은 사람 차 n대 구조도 지금 만들자")
-- 그동안 한 사람이 차를 두 대 맡기면 고객 기록을 둘 만들어(구현국·서명완) 회원 페이지 링크·소개 포인트가 둘로 나뉘었음.
-- Supabase SQL Editor 에서 이 블록을 한 번 실행. 실행 전에는 코드가 예전처럼(고객 칸의 차 한 대) 돌아간다.

-- 1) 차량 표
CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  brand text,
  model text,
  year text,
  color text,
  plate text,           -- 차량번호 (작업 내역서에서 자동으로 채워짐)
  memo text,
  is_primary boolean DEFAULT false,  -- 고객 칸에 보이는 대표 차
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicles_customer_idx ON vehicles (customer_id);

-- 2) 예약·시공 기록이 어느 차인지
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL;
ALTER TABLE services     ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL;

-- 3) 기존 고객의 차를 차량 1대씩으로 옮기고(대표), 그 고객의 예약·시공을 그 차에 연결
INSERT INTO vehicles (customer_id, brand, model, year, color, is_primary)
SELECT c.id, c.car_brand, c.car_model, c.car_year, c.car_color, true
FROM customers c
WHERE (c.car_brand IS NOT NULL OR c.car_model IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.customer_id = c.id);

UPDATE appointments a SET vehicle_id = v.id
FROM vehicles v
WHERE a.vehicle_id IS NULL AND v.customer_id = a.customer_id AND v.is_primary;

UPDATE services s SET vehicle_id = v.id
FROM vehicles v
WHERE s.vehicle_id IS NULL AND v.customer_id = s.customer_id AND v.is_primary;

-- 4) 손님 회원 페이지(로그인 없이 읽는 API)가 차량을 읽을 수 있게 — 다른 표와 같은 정책이면 아래는 필요 없음.
--    RLS 를 켜 둔 프로젝트라면: ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY; 뒤에 anon select/insert/update/delete 정책을 customers 와 같게.
