-- 시공 기록은 한 예약(같은 고객·같은 시공일·같은 시공 종류)당 한 줄만 (2026-11-22 사장님 "한 작업당 무조건 한 번만")
-- 코드(handleWorkOrderSubmit)가 먼저 막지만, DB 에서도 못 들어가게 잠그는 제약입니다.
-- 중복 6줄은 2026-11-22 에 정리했으므로 바로 실행할 수 있습니다. Supabase SQL Editor 에서 이 블록만 실행.
-- 같은 날 같은 종류를 정말 두 번 시공하는 드문 경우는 코드가 "이미 완료 처리된 시공이라 내역만 갱신했습니다"로 안내합니다.

CREATE UNIQUE INDEX IF NOT EXISTS services_one_per_job
  ON services (customer_id, service_date, service_type);

-- 사후관리도 한 시공 기록당 유형별 한 건만 (QC점검·메인터넌스·후기요청이 두 벌 생기는 일 방지)
CREATE UNIQUE INDEX IF NOT EXISTS follow_ups_one_per_service_type
  ON follow_ups (service_id, follow_up_type)
  WHERE service_id IS NOT NULL;
