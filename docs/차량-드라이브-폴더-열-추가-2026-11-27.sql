-- 차량 드라이브 폴더 링크 (2026-11-27 사장님 "차량 카드에 그 차의 드라이브 폴더 링크"): 작업 과정·출고 사진이 모인 공유 폴더. CRM 차량 카드에서 썸네일을 복사 없이 읽고, 시공기 폼 사진 폴더 칸에 미리 채움
-- Supabase SQL Editor 에서 한 번 실행
alter table vehicles add column if not exists drive_folder text;
