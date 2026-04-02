-- ============================================
-- Proism AI - Supabase Schema
-- Supabase SQL Editor에서 실행
-- ============================================

-- 1. customers (고객)
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  car_brand text,
  car_model text,
  car_year text,
  car_color text,
  source text,
  memo text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. services (시공 이력)
CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  service_type text NOT NULL,
  film_used text,
  service_area text,
  service_date date,
  completion_date date,
  amount integer,
  memo text,
  created_at timestamptz DEFAULT now()
);

-- 3. appointments (예약)
CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  appointment_date date NOT NULL,
  service_type text,
  status text DEFAULT '상담중',
  memo text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 4. follow_ups (사후관리)
CREATE TABLE follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid REFERENCES services(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  follow_up_type text NOT NULL,
  scheduled_date date NOT NULL,
  is_completed boolean DEFAULT false,
  completed_date date,
  memo text,
  created_at timestamptz DEFAULT now()
);

-- 5. consultations (상담)
CREATE TABLE consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  consultation_date date NOT NULL,
  content text,
  estimate text,
  interested_services text,
  memo text,
  created_at timestamptz DEFAULT now()
);

-- ============================================
-- updated_at 자동 업데이트 트리거
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
