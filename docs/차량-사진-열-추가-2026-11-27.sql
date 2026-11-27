-- 차량 사진 열 (2026-11-27 사장님 "차량 카드에 사진 추가"): 입고 상태·문제 부위 같은 내부용 사진. CRM 고객 상세 차량 카드에서만 보임
-- Supabase SQL Editor 에서 한 번 실행
alter table vehicles add column if not exists photos jsonb not null default '[]'::jsonb;
