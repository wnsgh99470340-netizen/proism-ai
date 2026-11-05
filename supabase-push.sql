-- Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run (RLS 없이 실행)
-- 웹 푸시 알림 구독 저장용 (supabase-schema.sql 8번과 동일)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint text PRIMARY KEY,
  subscription jsonb NOT NULL,
  user_agent text,
  created_at timestamptz DEFAULT now()
);
