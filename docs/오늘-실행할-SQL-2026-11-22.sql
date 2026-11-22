-- ===== 2026-11-22 오늘 실행할 SQL (한 번에 전부, Supabase SQL Editor 에 그대로 붙여 넣고 Run) =====
-- 두 번 실행해도 안전합니다 (IF NOT EXISTS).

-- A. 고객 1명 : 차량 N대
CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  brand text,
  model text,
  year text,
  color text,
  plate text,
  memo text,
  is_primary boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicles_customer_idx ON vehicles (customer_id);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL;
ALTER TABLE services     ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS follow_up_id uuid REFERENCES follow_ups(id) ON DELETE SET NULL;

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

-- B. 한 작업당 시공 기록 한 줄, 사후관리는 유형별 한 건 (리터치는 여러 번 가능)
CREATE UNIQUE INDEX IF NOT EXISTS services_one_per_job
  ON services (customer_id, service_date, service_type);

CREATE UNIQUE INDEX IF NOT EXISTS follow_ups_one_per_service_type
  ON follow_ups (service_id, follow_up_type)
  WHERE service_id IS NOT NULL AND follow_up_type IN ('QC점검', '메인터넌스', '후기요청');
