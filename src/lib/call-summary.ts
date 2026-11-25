/**
 * 통화 요약 캡처 → 상담 기록 (2026-11-25 사장님 "통화 요약 캡처를 CRM 에서 바로", 조건: "통화 요약한다고 바로 예약에 잡히면 안 돼, 각 기능과 맞물리게")
 *
 * 흐름(설계):
 *  1) 읽기   — 갤럭시 전화 앱의 AI 통화 요약 캡처를 Claude 비전이 읽어 통화별 {저장된 이름, 전화, 시각, 수신/발신/부재중, 길이, 제목, 요지, 할 일 제안}으로 (DB 안 씀)
 *  2) 맞추기 — 전화 → 고객/딜러, 없으면 저장된 이름(“이명호 현대 그랜저”, “벤츠 송파 윤성혁”)으로 후보. 블랙리스트면 경고. 같은 날·같은 시각 통화가 이미 상담 기록에 있으면 '이미 있음'
 *  3) 가르기 — 문의 / 예약 관련 / 사후(AS·기포·재시공) / 딜러 / 기타(택배·퀵·개인). 기타는 기본 체크 해제
 *  4) 확인   — 사장님이 표에서 손님·종류·시공·요지·재연락 여부를 고치고 "N건 기록". **예약은 절대 자동으로 만들지 않는다** — 예약 얘기면 '예약 추가 창 열기'(날짜·고객 미리 채움)만
 *  5) 맞물림 — 상담 기록(접두 "[통화 요약]", 미등록은 메모 첫 줄 "이름 전화 · 차종" 꼴이라 고객 등록 때 linkOrphanRecordsByPhone 이 붙임) / 견적 재연락(사장님이 켠 것만, 이미 열린 재연락·예약 있으면 제안 안 함) /
 *             견적 문자 창 미리 채워 열기 / 소개한 분 토큰 / 딜러 기록 / 타임라인 "통화 · 제목" / 아침 브리핑은 재연락을 통해 / 주간 숫자는 상담 기록으로 집계
 */
import { addDaysISO } from './local-date';

export type CallDirection = '수신' | '발신' | '부재중' | '';
export type CallKind = '문의' | '예약' | '사후' | '딜러' | '기타';

export interface ExtractedCall {
  savedName: string;      // 전화 앱에 저장된 이름 그대로 ("이명호 현대 그랜저", 없으면 번호)
  phone: string | null;   // 010-0000-0000 (보이면)
  date: string | null;    // YYYY-MM-DD (캡처의 "11. 23 (월)" + 기준 연도)
  time: string | null;    // "17:04"
  direction: CallDirection;
  duration: string | null; // "1분 7초"
  title: string;          // 요약 제목
  bullets: string[];      // 요지
  todo: { text: string; date: string | null } | null; // 할 일 제안
}

export const CALL_KINDS: CallKind[] = ['문의', '예약', '사후', '딜러', '기타'];

/** 내부 통화(공동대표·직원): 손님 문의가 아니므로 기본 '기타' (2026-11-25 첫 시험에서 류하솜 통화가 '문의'로 잡힘) */
export const INTERNAL_NAMES = ['류하솜'];

const SVC: [RegExp, string][] = [
  [/신차\s*패키지|신차패/, '신차패키지'], [/컬러\s*ppf|pwf/i, '컬러PPF'], [/실내/, '실내PPF'], [/크롬/, '크롬죽이기'], [/랩핑|래핑|투톤|루프스킨/, '랩핑'],
  [/썬팅|선팅|틴팅|농도|크리스탈라인|버텍스/, '썬팅'], [/유리막|광택|코팅/, '유리막코팅'], [/ppf|필름|보호\s*필름|프론트|생활보호/i, 'PPF'],
];
/** 요약 글에서 시공 종류 짐작 (없으면 null) */
export function guessService(text: string): string | null {
  for (const [re, s] of SVC) if (re.test(text)) return s;
  return null;
}

/** 통화 종류 짐작 — 사장님이 표에서 고치는 기본값일 뿐 */
export function guessKind(c: ExtractedCall, isDealer: boolean): CallKind {
  const t = `${c.savedName} ${c.title} ${c.bullets.join(' ')}`;
  if (INTERNAL_NAMES.some((n) => c.savedName.startsWith(n))) return '기타';
  if (!c.title && c.bullets.length === 0) return isDealer ? '딜러' : '문의'; // 상세 없는 목록 줄 — 종류는 짐작만, 기록 여부는 화면에서 기본 해제
  if (/택배|퀵|배송|기사|보험사|세무|은행|광고|스팸|카드|대출|렌트카 반납|개인/.test(t) && !guessService(t)) return '기타';
  if (isDealer) return '딜러';
  if (/기포|들뜸|재시공|AS|에이에스|하자|벗겨|긁힘|리터치|보증/.test(t)) return '사후';
  if (/예약|입고|도착|출고|대차|몇\s*시/.test(t) && !/견적|가격|비용|얼마|비율|농도|등급|제품|두께/.test(t)) return '예약'; // '일정'만으로는 예약으로 보지 않는다(농도·견적 얘기에도 '일정'이 섞임)
  return '문의';
}

/** 상담 기록 content: 첫 줄 접두로 상담 탭·타임라인·주간 숫자가 알아본다 */
export function callContent(c: ExtractedCall, kind: CallKind, dealerName?: string | null): string {
  const head = `[통화 요약] ${c.time || ''} ${c.direction || ''}${c.duration ? ` ${c.duration}` : ''} · ${c.title || '통화'}`.replace(/\s+/g, ' ').trim();
  const lines = [head];
  if (kind === '딜러' && dealerName) lines.push(`- 딜러 ${dealerName} 통화`);
  for (const b of c.bullets) if (b.trim()) lines.push(`- ${b.trim()}`);
  if (c.todo?.text) lines.push(`- 할 일: ${c.todo.text}${c.todo.date ? ` (${c.todo.date})` : ''}`);
  return lines.join('\n');
}

/** 미등록 손님의 상담 memo 첫 줄 — 견적 문자 기록과 같은 꼴이라 고객 등록 때 자동으로 붙는다 */
export function unregisteredMemoHead(name: string, phone: string | null, car: string | null): string {
  return [name || '이름 없음', phone || '', car ? `· ${car}` : ''].filter(Boolean).join(' ').replace(/\s+·/, ' ·');
}

/** 견적 재연락 제안: 할 일 날짜가 있으면 그날, 없으면 D+3. 예약·열린 재연락이 이미 있으면 제안하지 않음(null) */
export function suggestFollowUp(c: ExtractedCall, kind: CallKind, today: string, hasOpenQuote: boolean, hasUpcomingAppointment: boolean): string | null {
  if (kind !== '문의' && kind !== '딜러') return null;
  if (hasOpenQuote || hasUpcomingAppointment) return null;
  if (c.todo?.date && c.todo.date >= today) return c.todo.date;
  return addDaysISO(today, 3);
}

/** 저장된 이름에서 사람 이름·차종 떼기: "이명호 현대 그랜저" → {name:'이명호', car:'현대 그랜저'}, "벤츠 송파 윤성혁" → {org:'벤츠 송파', name:'윤성혁'} */
export function splitSavedName(saved: string): { name: string; car: string | null; org: string | null } {
  const s = (saved || '').replace(/\(\d+\)\s*$/, '').trim();
  const org = s.match(/^(BMW|bmw|벤츠|아우디|포르쉐|랜드로버|렉서스|볼보|기아|현대|제네시스|테슬라)\s+(강남|남양주|잠실|송파|방배|의정부|성수|동대문|서초|대치|삼성|청담|청\/강남)\s+([가-힣]{2,4})(\s*(지점장|부장|차장|과장|대리|주임|팀장))?/);
  if (org) return { name: org[3], car: null, org: `${org[1].toUpperCase() === 'BMW' ? 'BMW' : org[1]} ${org[2]}` };
  // "1급공업사 지승흠대표님 또는 …", "벤츠 방배전시장 박원빈차장" — 소속 글자 뒤에 이름+호칭
  const biz = s.match(/^(.+?(?:공업사|대리점|전시장|렌트카|리스|캐피탈|보험|정비|모터스))\s*([가-힣]{2,4}?)\s*(대표님|대표|사장님|사장|지점장|부장|차장|과장|대리|주임|팀장|실장)/);
  if (biz) return { name: biz[2], car: null, org: biz[1].trim() };
  const m = s.match(/^([가-힣]{2,4})(?:\s+(.+))?$/);
  if (m) return { name: m[1], car: m[2]?.trim() || null, org: null };
  if (/^0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}$/.test(s)) return { name: '', car: null, org: null };
  return { name: s, car: null, org: null };
}

/** 같은 통화를 두 번 넣지 않기: 같은 날 상담 기록 content 첫 줄에 같은 시각이 있으면 */
export function isDuplicateCall(existingContents: string[], c: ExtractedCall): boolean {
  if (!c.time) return false;
  return existingContents.some((t) => t.startsWith('[통화 요약]') && t.split('\n')[0].includes(c.time!));
}
