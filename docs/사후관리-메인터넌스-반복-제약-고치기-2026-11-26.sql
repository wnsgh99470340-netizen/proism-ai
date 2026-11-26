-- 메인터넌스 다음 회차가 한 번도 안 만들어지던 원인 (2026-11-26 발견)
-- 2026-11-22 에 만든 follow_ups_one_per_service_type 인덱스가 "한 시공당 메인터넌스 한 건"으로 잠겨 있어
-- 6개월 뒤 2회차·3회차 메인터넌스 insert 가 전부 막혔고, 코드는 그 오류를 버리고 있었습니다(운영에 자동 생성 회차 0건).
-- 아래를 Supabase SQL Editor 에서 한 번 실행하면 QC·후기요청은 그대로 한 건, 메인터넌스는 "열린 것 한 건"만 잠깁니다.

DROP INDEX IF EXISTS follow_ups_one_per_service_type;

-- QC점검·후기요청: 한 시공 기록당 한 건 (두 벌 생기는 일 방지, 2026-11-22 그대로)
CREATE UNIQUE INDEX IF NOT EXISTS follow_ups_one_per_service_type
  ON follow_ups (service_id, follow_up_type)
  WHERE service_id IS NOT NULL AND follow_up_type IN ('QC점검', '후기요청');

-- 메인터넌스: 회차가 쌓이므로 '아직 안 끝난 것'만 한 건 (완료되면 다음 회차를 만들 수 있다)
CREATE UNIQUE INDEX IF NOT EXISTS follow_ups_one_open_maintenance
  ON follow_ups (service_id)
  WHERE service_id IS NOT NULL AND follow_up_type = '메인터넌스' AND is_completed = false;
