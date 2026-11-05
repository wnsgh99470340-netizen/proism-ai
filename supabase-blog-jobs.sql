-- Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run (RLS 없이 실행)
-- 블로그 글 백그라운드 생성 작업 큐 (supabase-schema.sql 7번과 동일)
CREATE TABLE IF NOT EXISTS blog_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'researching', 'writing', 'channels', 'done', 'failed')),
  message text NOT NULL,
  request jsonb,
  research jsonb,
  result jsonb,
  channels jsonb,
  error text,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blog_jobs_status_created_idx ON blog_jobs (status, created_at DESC);
