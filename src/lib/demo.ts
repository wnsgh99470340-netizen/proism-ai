/**
 * 둘러보기 모드 (2026-11-22 사장님 "남한테 보여줄 수 있게 고객 정보 다 빼고, 가짜로 바꿀 필요 없이 비어 보이게")
 * - /demo 로 들어오면 crm_demo 쿠키(2시간)가 생기고 /crm 이 열린다. 로그인 없이 화면만
 * - 브라우저의 supabase 클라이언트가 이 쿠키를 보면 DB 대신 빈 결과를 돌려준다(src/lib/supabase.ts) → 고객·예약·사후관리 전부 0건, 저장도 안 됨
 * - 서버 API(/api/*)는 미들웨어가 그대로 401 → 홈 카드(마케팅팀·숫자)·블로그 작업 목록도 비어 보임. 실제 데이터는 어떤 길로도 안 나감
 * - 사장님 기기에서 /demo 를 열었다가 내 데이터가 안 보이면: 상단 띠의 "나가기" 또는 2시간 뒤 자동 해제. 로그인하면 쿠키를 지운다
 */
export const DEMO_COOKIE = 'crm_demo';
export const DEMO_COOKIE_VALUE = 'tour';
export const DEMO_MAX_AGE = 60 * 60 * 2;

export function isDemoClient(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim() === `${DEMO_COOKIE}=${DEMO_COOKIE_VALUE}`);
}

export function clearDemoCookie() {
  if (typeof document === 'undefined') return;
  document.cookie = `${DEMO_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}
