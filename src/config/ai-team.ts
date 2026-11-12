/**
 * AI 팀 — "시키지 않아도 매일 하는 직원" 정의 (2026-11-12 사장님 결정: 1주차는 사후관리·상담부터)
 * - active: 매일 돌고 홈 "오늘 AI가 한 일"에 올라온다
 * - prepared: 자리만 있고 아직 돌지 않는다 (사장님 자료·결정 대기)
 * 문자는 건마다 사장님이 직접 보낸다(개별 전송). AI 는 준비까지.
 */
export type WorkerKey = 'writer' | 'aftercare' | 'consult' | 'review' | 'research' | 'channel';

export interface Worker {
  key: WorkerKey;
  name: string;
  /** 홈 줄에 보이는 시간표 */
  time: string;
  /** 한 줄 역할 */
  role: string;
  status: 'active' | 'prepared';
  /** 준비 상태일 때 이유 */
  waitingFor?: string;
}

export const TEAM: Worker[] = [
  { key: 'aftercare', name: '사후관리 담당', time: '매일 07:00', role: '오늘·밀린 QC·메인터넌스·후기 요청 문자를 고객별로 준비', status: 'active' },
  { key: 'consult', name: '상담 담당', time: '매일 07:00', role: '견적 문자 보낸 분의 하루·사흘 뒤 재연락 문구 준비', status: 'active' },
  { key: 'writer', name: '시공기 작가', time: '요청 즉시', role: '사진 확인 → 조사 → 글 → 인스타·카페 → 영상', status: 'active' },
  { key: 'review', name: '검수 담당', time: '매주 월', role: '지난주 발행 글을 사장님 기준으로 다시 읽고 보고', status: 'prepared', waitingFor: '2주차' },
  { key: 'research', name: '리서치 담당', time: '매주 월', role: '키워드 순위·경쟁 매장 새 글·추천 주제', status: 'prepared', waitingFor: '사장님이 키워드·경쟁 매장을 주시면 시작' },
  { key: 'channel', name: '채널 담당', time: '글 완성 때', role: '릴스 대본·게시 순서표', status: 'prepared', waitingFor: '인스타 보류(사장님 결정)' },
];

/** 리서치 담당이 쓸 자리 — 사장님이 맥에서 채워 주기로 함 (2026-11-12). 비어 있으면 리서치는 돌지 않는다 */
export const RESEARCH_TARGETS: { keywords: string[]; competitors: { name: string; blog?: string }[] } = {
  keywords: [],
  competitors: [],
};
