/**
 * 사후관리 문자 문구 (2026-11-12 공용 모듈로 분리 — CRM 화면과 AI 팀(매일 07시 준비)이 같은 문구를 쓴다)
 * 문구는 사장님이 쓰던 그대로. 바꾸고 싶으면 여기만 고친다.
 */

export const QC_SMS = `안녕하세요, 3M프로이즘입니다 ^^\n시공해드린 차량, 잘 타고 계신가요?\n\n시공 후 2주가 지나 QC 점검 시기가 되어 연락드렸습니다.\n필름이 완전히 안착되는 시기이기도 하고, 혹시 생활하시면서 불편하셨던 부분이 있으시다면 이번에 같이 확인해드리려고 합니다.\n\n편하신 날짜 말씀해주시면 점검 일정 잡아드리겠습니다.\n늘 감사합니다!`;

export const MAINT_SMS = `안녕하세요, 3M프로이즘입니다 ^^\n시공 후 6개월이 되어 메인터넌스 안내드립니다.\n\n필름 상태 점검과 함께 가벼운 외부 세척, 마감 재점검까지 진행해드리고 있습니다.\n오래오래 깔끔하게 유지하실 수 있도록 저희가 꾸준히 관리해드릴게요.\n\n편하신 날짜 말씀해주시면 일정 잡아드리겠습니다.\n항상 감사합니다!`;

/** 후기 요청 문자 3종(후기 게시판 링크만 다름). 사후관리 탭·예약 상세 줄·홈에서 같이 쓴다 */
export const REVIEW_SMS = {
  proism: `안녕하세요, 3M프로이즘입니다.\n멋지게 작업이 완료된 차량 사진을 보내드리오니, 소중한 후기 작성 잘 부탁드리겠습니다.\n➊ 아래의 링크 클릭\n➋ 첨부드린 사진으로 후기 작성\n[ 🚩 후기 게시판 링크 ]\nhttps://m.site.naver.com/1S6dj\n고객님의 솔직한 리뷰는 저희에게 아주 큰 힘이 됩니다. 정말 감사드리며, 이후에 이어질 메인터넌스 시기(약 6개월 후)에도 차별화 된 서비스로 다시 또 찾아뵐게요!`,
  bmw: `안녕하세요, 3M프로이즘입니다.\n멋지게 작업이 완료된 차량 사진을 보내드리오니, 소중한 후기 작성 잘 부탁드리겠습니다.\n➊ 아래의 링크 클릭\n➋ 첨부드린 사진으로 후기 작성\n[ 🚩 후기 게시판 링크 ]\nhttps://m.site.naver.com/1S6e3\n고객님의 솔직한 리뷰는 저희에게 아주 큰 힘이 됩니다. 정말 감사드리며, 이후에 이어질 메인터넌스 시기(약 6개월 후)에도 차별화 된 서비스로 다시 또 찾아뵈겠습니다!`,
  audi: `안녕하세요, 3M프로이즘입니다.\n멋지게 작업이 완료된 차량 사진을 보내드리오니, 소중한 후기 작성 잘 부탁드리겠습니다.\n➊ 아래의 링크 클릭\n➋ 첨부드린 사진으로 후기 작성\n[ 🚩 후기 게시판 링크 ]\nhttps://m.site.naver.com/1S6ej\n고객님의 솔직한 리뷰는 저희에게 아주 큰 힘이 됩니다. 정말 감사드리며, 이후에 이어질 메인터넌스 시기(약 6개월 후)에도 차별화 된 서비스로 다시 또 찾아뵈겠습니다!`,
};

/** follow_ups.sms_sent 에 기록하는 키 */
export function followUpSmsKey(type: string): string {
  return type === 'QC점검' ? 'qc' : type === '메인터넌스' ? 'maintenance' : type === '후기요청' ? 'proism' : 'quote';
}

/** 사후관리 유형별 보낼 문구. 견적 재연락·마무리는 등록 때 memo 둘째 줄부터 저장된 문자를 그대로 쓴다 */
export function followUpMessage(type: string, memo: string | null | undefined): string {
  if (type === 'QC점검') return QC_SMS;
  if (type === '메인터넌스') return MAINT_SMS;
  if (type === '후기요청') return REVIEW_SMS.proism;
  const stored = (memo || '').split('\n').slice(1).join('\n').trim();
  return stored || `안녕하세요 3M 프로이즘 대표 진준호입니다.\n${memo || ''}`;
}

export function followUpLabel(type: string): string {
  return type === 'QC점검' ? 'QC 점검' : type === '견적재연락' ? '견적 재연락' : type === '견적마무리' ? '견적 마무리' : type;
}
