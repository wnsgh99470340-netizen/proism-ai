/** 바깥 링크 모음 (2026-11-18). 매장 자체 보증서(/warranty/[id])는 그대로 두고, 3M 정품 보증은 링크로만 덧붙인다 (사장님 "기존 보증서도 같이 남겨둬야 해") */
export const LINKS = {
  /** 3M 소비자 보증서 확인 — 한국쓰리엠 공식(autofilm.co.kr). 고객이 전자 보증서 일련번호로 정품 시공 여부를 직접 조회 (2026-11-18 사장님이 준 주소) */
  threeMWarrantyCheck: 'https://www.autofilm.co.kr/awf/check_warranty.php',
  /** 3M 코리아 자동차 필름 FAQ — "보증 청구는 어떻게 하나요?"(시공점 먼저 연락, 전자 보증서 사본+영수증) */
  threeMWarrantyFaq: 'https://www.3m.co.kr/3M/ko_KR/car-personalization-kr/support/faqs/',
  /** 3M 공식 시공점 찾기 */
  threeMFindInstaller: 'https://www.3m.co.kr/3M/ko_KR/car-personalization-kr/resources/find-a-installer/',
} as const;
