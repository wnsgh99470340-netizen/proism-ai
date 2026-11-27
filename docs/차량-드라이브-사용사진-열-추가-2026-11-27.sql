-- 드라이브 사진 '후기에 사용함' 표시 (2026-11-27 사장님 "후기 요청 때 쓴 사진이라는 표시"): 그 차 드라이브 폴더의 파일 id 목록. CRM 차량 카드에서만 쓰고 시공기·공개 페이지와 연결하지 않음
-- Supabase SQL Editor 에서 한 번 실행
alter table vehicles add column if not exists drive_used_ids jsonb not null default '[]'::jsonb;
