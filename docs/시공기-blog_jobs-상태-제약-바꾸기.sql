-- 시공기 파이프라인 재설계(2026-11-20): blog_jobs.status 에 facts(사실표 만드는 중)·confirming(사장님 확인 대기) 추가
-- Supabase 대시보드 → SQL Editor → 아래 두 줄 붙여넣고 Run. 기존 작업 데이터는 그대로 유지됩니다.
ALTER TABLE blog_jobs DROP CONSTRAINT IF EXISTS blog_jobs_status_check;
ALTER TABLE blog_jobs ADD CONSTRAINT blog_jobs_status_check
  CHECK (status IN ('queued', 'researching', 'facts', 'confirming', 'writing', 'channels', 'done', 'failed'));
