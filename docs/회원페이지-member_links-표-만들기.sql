-- 2026-11-18 손님용 회원 페이지 개인 링크 표. Supabase → SQL Editor → 붙여넣고 Run 한 번 (RLS 없이).
CREATE TABLE IF NOT EXISTS member_links (
  customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now(),
  last_seen_at timestamptz,
  visits int NOT NULL DEFAULT 0
);
