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

-- ============================================
-- 6. blog_posts (사장님 글 데이터베이스 — 2026-11-04 추가)
-- kind: 'owner' = 사장님이 직접 쓴 글, 'draft' = AI 초안, 'final' = 사장님이 수정해 확정한 최종본
-- 톤 학습 참고용: 글 생성 시 owner/final 최근 글과 feedback 을 프롬프트에 넣는다
-- Supabase SQL Editor에서 이 블록만 실행
-- ============================================
CREATE TABLE IF NOT EXISTS blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('owner', 'draft', 'final')),
  title text NOT NULL,
  body text NOT NULL,
  car_model text,
  service_type text,
  product text,
  region text,
  feedback text,            -- 사장님 수정 피드백 메모 (final 에 주로 기록)
  draft_id uuid,            -- final 이 어떤 draft 에서 나왔는지
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blog_posts_kind_created_idx ON blog_posts (kind, created_at DESC);

-- ============================================
-- 7. blog_jobs (블로그 글 백그라운드 생성 작업 — 2026-11-05 추가)
-- 폰 화면을 꺼도 서버가 접수 → 조사 → 작성 → 인스타·카페 변환까지 이어가기 위한 작업 큐
-- status: queued → researching → writing → channels → done (실패 시 failed)
-- Supabase SQL Editor에서 이 블록만 실행
-- ============================================
CREATE TABLE IF NOT EXISTS blog_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'researching', 'writing', 'channels', 'done', 'failed')),
  message text NOT NULL,
  request jsonb,            -- 시공기 빠른 생성 폼 값
  research jsonb,           -- { context, summary }
  result jsonb,             -- { reply, draft, checks, draftId, target }
  channels jsonb,           -- { instagram, cafe }
  error text,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blog_jobs_status_created_idx ON blog_jobs (status, created_at DESC);
