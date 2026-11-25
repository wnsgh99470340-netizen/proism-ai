/**
 * 딜러용 현황 페이지 (2026-11-25 사장님 "딜러 현황 페이지부터 가자")
 * - 일감을 주는 딜러(3~4명)가 자기가 넣은 차들이 지금 어디까지 왔는지 폰에서 바로 보게 하는 페이지. /d/<코드>
 * - 코드는 손님 회원 페이지와 같은 member_links 표를 쓴다(딜러도 customers 행이므로 customer_id = 딜러 id)
 * - 순수 함수만 여기에(시험 대상). DB 읽기는 /api/dealer/[token], 화면은 /d/[token]
 */

export const DEALER_PAGE_BASE = 'https://proism-ai.vercel.app/d/';
export const dealerPageUrl = (token: string) => DEALER_PAGE_BASE + token;

export interface CarAppointment { appointment_date: string; end_date: string | null; service_type: string | null; status: string }
export interface CarService { service_date: string | null; completion_date?: string | null; service_type: string }

export type CarTone = 'soon' | 'working' | 'done' | 'talk' | 'none';
export interface CarState {
  tone: CarTone;
  /** 배지 글자: 입고 예정 · 작업 중 · 출고 완료 · 상담 중 */
  label: string;
  /** 한 줄 설명: "11월 28일 입고" / "12월 1일 출고 예정" / "11월 25일 출고" */
  detail: string;
  service: string | null;
  /** 정렬용: 진행 중이 앞, 그 안에서는 가까운 날짜 먼저 */
  sortKey: string;
}

const md = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${m}월 ${d}일`;
};

/**
 * 차 한 대의 현재 상태. 가장 최근 예약(취소 제외)을 본다. 예약이 없으면 시공 기록으로 '출고 완료'.
 * - 예약확정이면서 시작일이 오늘 이후 → 입고 예정 (오늘이 시작일이면 '오늘 입고')
 * - 시공중, 또는 예약확정인데 시작일이 지났고 끝나지 않음 → 작업 중 (출고 예정 = 끝나는 날)
 * - 완료 → 출고 완료 (끝나는 날 또는 시작일)
 * - 상담중 → 상담 중
 */
export function carState(appts: CarAppointment[], services: CarService[], today: string): CarState {
  const live = appts.filter((a) => a.status !== '취소').sort((a, b) => (a.appointment_date < b.appointment_date ? 1 : -1));
  const a = live[0];
  if (a) {
    const end = a.end_date || a.appointment_date;
    if (a.status === '완료') return { tone: 'done', label: '출고 완료', detail: `${md(end)} 출고`, service: a.service_type, sortKey: `2-${end}` };
    if (a.status === '상담중') return { tone: 'talk', label: '상담 중', detail: a.appointment_date ? `${md(a.appointment_date)} 예정` : '', service: a.service_type, sortKey: `1-${a.appointment_date}` };
    if (a.status === '시공중' || a.appointment_date < today) {
      const detail = end >= today ? `${md(end)} 출고 예정` : `${md(end)} 출고 예정이었음`;
      return { tone: 'working', label: '작업 중', detail, service: a.service_type, sortKey: `0-${end}` };
    }
    return { tone: 'soon', label: a.appointment_date === today ? '오늘 입고' : '입고 예정', detail: `${md(a.appointment_date)} 입고${a.end_date && a.end_date !== a.appointment_date ? ` · ${md(a.end_date)} 출고 예정` : ''}`, service: a.service_type, sortKey: `0-${a.appointment_date}` };
  }
  const s = services.filter((x) => x.service_date).sort((x, y) => ((x.service_date || '') < (y.service_date || '') ? 1 : -1))[0];
  if (s) return { tone: 'done', label: '출고 완료', detail: `${md(s.completion_date || s.service_date)} 출고`, service: s.service_type, sortKey: `2-${s.completion_date || s.service_date}` };
  return { tone: 'none', label: '기록 없음', detail: '', service: null, sortKey: '3-' };
}

/** 딜러에게 현황 페이지 링크를 보내는 문자 (사장님 문자 말투) */
export function dealerLinkSms(dealerName: string, url: string): string {
  return [
    '안녕하세요 3M 프로이즘 대표 진준호입니다.',
    `${dealerName} 님이 넣어 주신 차들의 작업 상황을 한 번에 보실 수 있는 페이지를 만들었습니다.`,
    '입고 예정, 작업 중, 출고 완료가 차마다 보이고 작업이 진행되면 바로 바뀝니다.',
    url,
    '들어가실 때 전화번호 뒷자리 4개를 넣어 주세요.',
    '앞으로 입고·출고 문자에도 이 링크를 같이 넣어 드리겠습니다.',
  ].join('\n');
}
