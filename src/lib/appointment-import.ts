/**
 * 스크린샷으로 예약 등록 (2026-11-18 사장님 "스크린샷 예약 해보자")
 *
 * 타임트리 달력 캡처·카톡 예약 대화 같은 이미지를 Claude 비전으로 읽어 일정 후보를 뽑고,
 * 고객 목록(전화 → 이름 → 차종 순)과 기존 예약(같은 고객·겹치는 날짜 또는 같은 메모)에 맞춰
 * "새 고객으로 등록 / 기존 고객에 연결 / 이미 있는 예약" 으로 나눠 돌려준다. 등록은 화면에서 사장님이 표를 보고 누른다.
 */
import { analyzeImageWithClaude } from './claude-client';

export interface ExtractedEvent {
  label: string;        // 화면에 적힌 원문 (예: "SL 전체 PPF 무광")
  start: string;        // YYYY-MM-DD
  end: string | null;   // 여러 날이면 마지막 날, 하루면 null
  time: string | null;  // "1시 입고" 같은 시간 메모
  name: string | null;  // 사람 이름이 보이면
  phone: string | null;
  car: string | null;   // 차종 (SL, X5, 모델Y …)
  service: string | null; // CRM 시공 종류로 정규화한 값
  note: string | null;  // 그 외 메모(사촌누나·리터치 등)
}

export interface ImportCandidate extends ExtractedEvent {
  key: string;
  /** 기존 고객과 맞았을 때 */
  customerId: string | null;
  customerName: string | null;
  matchBy: 'phone' | 'name' | 'car' | null;
  /** 이미 같은 예약이 있을 때 그 예약 id */
  duplicateOf: string | null;
  /** 과거에 끝난 일정이면 시공중(사장님이 완료 버튼으로 마무리), 아니면 예약확정 */
  status: '시공중' | '예약확정';
  /** 새 고객을 만들 때 쓸 이름 */
  newCustomerName: string;
  /** 차종으로 짐작한 브랜드 (새 고객 car_brand 용) */
  brand: string | null;
}

export const CRM_SERVICE_TYPES = ['PPF', '컬러PPF', 'PWF', '랩핑', '크롬죽이기', '썬팅', '유리막코팅', '가죽코팅', '실내PPF', '신차패키지'] as const;

/** 화면 글자 → CRM 시공 종류. 모르면 null (리터치·점검 등) */
export function normalizeService(text: string): string | null {
  const t = text.replace(/\s+/g, '').toLowerCase();
  if (/신차패키지|신차패/.test(t)) return '신차패키지';
  if (/실내ppf|실내/.test(t)) return '실내PPF';
  if (/컬러ppf|pwf|컬러피피에프/.test(t)) return '컬러PPF';
  if (/크롬/.test(t)) return '크롬죽이기';
  if (/랩핑|래핑|투톤|wrap/.test(t)) return '랩핑';
  if (/썬팅|선팅|틴팅|tint/.test(t)) return '썬팅';
  if (/유리막|코팅/.test(t)) return '유리막코팅';
  if (/ppf|피피에프|프론트|전체/.test(t)) return 'PPF';
  return null;
}

const BRAND_BY_CAR: [RegExp, string][] = [
  [/^(x[1-7]m?|m[2-8]|i[3-7x]|[1-8]시리즈|[1-8]series|z4|ix)/i, 'BMW'],
  [/^(sl|cle|cls|cla|gl[abces]|glc|gle|gls|[acesg]\s?\d{2,3}|e클래스|s클래스|c클래스|g바겐|마이바흐|amg)/i, '벤츠'],
  [/^(a[1-8]|q[2-8]|rs\s?\d|e[\s-]?트론|etron|tt|r8)/i, '아우디'],
  [/^(모델\s?[3sxy]|model\s?[3sxy]|테슬라|yl|y\s?l)/i, '테슬라'],
  [/^(ev[3-9]|k[3-9]|쏘렌토|카니발|스포티지|셀토스|모닝|레이|니로|쏘울|스팅어|k8)/i, '기아'],
  [/^(gv?[6-9]0|g80|g90|gv80|gv70|gv60|제네시스)/i, '제네시스'],
  [/^(그랜저|아반떼|쏘나타|싼타페|투싼|팰리세이드|아이오닉|코나|캐스퍼|스타리아)/i, '현대'],
  [/^(911|카이엔|파나메라|마칸|타이칸|박스터|카이맨|718|992)/i, '포르쉐'],
  [/^(레인지로버|디스커버리|디펜더|벨라)/i, '랜드로버'],
  [/^(es|ls|nx|rx|ux|lx)\s?\d{3}/i, '렉서스'],
  [/^(xc[469]0|s[69]0|v[69]0)/i, '볼보'],
];
export function guessBrand(car: string | null): string | null {
  if (!car) return null;
  const c = car.trim();
  for (const [re, brand] of BRAND_BY_CAR) if (re.test(c)) return brand;
  return null;
}

const PROMPT = (baseMonth: string) => `이 이미지는 자동차 시공점 사장님의 예약 일정 캡처입니다(달력 앱·카톡 대화·메모 등). 여기 적힌 예약 일정을 전부 뽑아 JSON 하나로만 답하세요.

규칙:
- 달력이면 화면에 보이는 연·월을 먼저 읽습니다(없으면 ${baseMonth} 기준).
- 각 일정마다 그 막대(또는 글자)가 실제로 덮고 있는 날짜 칸을 전부 days 에 YYYY-MM-DD 로 나열하세요. 칸 하나씩 세어 적습니다. 막대가 끝난 뒤의 빈 칸은 넣지 않습니다.
- 여러 날에 걸친 막대는 줄이 바뀌어 다음 주로 이어져도 한 일정입니다. 막대가 토요일 칸까지 가고 다음 줄 일요일 칸에 같은 이름(또는 이름 없이 같은 색 막대)으로 이어지면 하나로 합쳐 days 를 계속 이어 적습니다. 다음 줄에 같은 이름의 막대가 없으면 토요일에서 끝난 것입니다.
- 막대가 줄 중간에서 끝나면 그 칸이 마지막 날입니다. 그 줄의 끝까지 늘리지 마세요.
- 하루짜리 일정은 days 에 날짜 하나만.
- 일정 글자는 label 에 원문 그대로. 차종(SL, X5, 모델Y, GV70 …)은 car 에, 사람 이름이 보이면 name 에, 전화번호가 보이면 phone 에, "1시 입고" 같은 시간은 time 에, 시공 종류 글자(전체 PPF, 투톤, 크롬죽이기, 썬팅 점검, 신차패키지, 리터치 …)는 service 에 원문대로, 그 외 메모(사촌누나 등)는 note 에.
- "+1건"처럼 접혀서 안 보이는 일정은 뽑지 말고 hidden 에 그 날짜와 개수만 적으세요.
- 설명 문장 없이 JSON 만.

형식:
{"month":"YYYY-MM","events":[{"label":"","days":["YYYY-MM-DD"],"time":null,"name":null,"phone":null,"car":null,"service":null,"note":null}],"hidden":[{"date":"YYYY-MM-DD","count":1}]}`;

export async function extractEventsFromImage(base64: string, mediaType: string, baseMonth: string): Promise<{ month: string; events: ExtractedEvent[]; hidden: { date: string; count: number }[] }> {
  const raw = await analyzeImageWithClaude(base64, mediaType, PROMPT(baseMonth), 4000, 'claude-sonnet-5-5');
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('이미지에서 일정을 읽지 못했습니다');
  type RawEvent = Partial<ExtractedEvent> & { days?: unknown };
  const j = JSON.parse(m[0]) as { month?: string; events?: RawEvent[]; hidden?: { date: string; count: number }[] };
  const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const events: ExtractedEvent[] = [];
  for (const e of j.events || []) {
    // days(칸 나열)에서 시작·끝을 잡고, 없으면 start/end 를 그대로
    const days = (Array.isArray(e.days) ? e.days.filter(isDate) : []).sort();
    const start = days[0] || (isDate(e.start) ? e.start : null);
    if (!start) continue;
    const endRaw = days.length > 1 ? days[days.length - 1] : isDate(e.end) ? e.end : null;
    const label = String(e.label || '').trim();
    if (!label) continue;
    const serviceText = [e.service, label].filter(Boolean).join(' ');
    events.push({
      label,
      start,
      end: endRaw && endRaw > start ? endRaw : null,
      time: e.time ? String(e.time).trim() : null,
      name: e.name ? String(e.name).trim() : null,
      phone: e.phone ? String(e.phone).replace(/[^\d]/g, '').replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3') : null,
      car: e.car ? String(e.car).trim() : null,
      service: normalizeService(serviceText),
      note: e.note ? String(e.note).trim() : null,
    });
  }
  return { month: j.month && /^\d{4}-\d{2}$/.test(j.month) ? j.month : baseMonth, events, hidden: Array.isArray(j.hidden) ? j.hidden : [] };
}

export interface KnownCustomer { id: string; name: string; phone: string | null; car_brand?: string | null; car_model?: string | null; created_at?: string; /** 차량 N대 (2026-11-22): 대표 차 말고 다른 차들 */ cars?: string[] }
export interface KnownAppointment { id: string; customer_id: string | null; appointment_date: string; end_date: string | null; memo: string | null; status: string }

const norm = (s: string | null | undefined) => (s || '').replace(/[\s\-_.]/g, '').toLowerCase();
/** 차종 비교용: 브랜드 말을 떼고(BMW X5 → x5, 테슬라 모델y → 모델y) 공백·기호 제거 */
const normCar = (s: string | null | undefined) => norm((s || '').replace(/bmw|벤츠|메르세데스|아우디|테슬라|기아|현대|제네시스|포르쉐|렉서스|볼보|랜드로버|미니|폭스바겐|tesla|audi|benz|porsche/gi, ' '));

/** 뽑은 일정을 고객·예약과 맞춰 등록 후보로 만든다 */
export function matchCandidates(events: ExtractedEvent[], customers: KnownCustomer[], appointments: KnownAppointment[], today: string): ImportCandidate[] {
  return events.map((e, i) => {
    let customerId: string | null = null, customerName: string | null = null, matchBy: ImportCandidate['matchBy'] = null;
    if (e.phone) {
      const c = customers.find((c) => norm(c.phone) === norm(e.phone));
      if (c) { customerId = c.id; customerName = c.name; matchBy = 'phone'; }
    }
    if (!customerId && e.name && e.name.length >= 2) {
      const hits = customers.filter((c) => norm(c.name) === norm(e.name));
      if (hits.length === 1) { customerId = hits[0].id; customerName = hits[0].name; matchBy = 'name'; }
    }
    const end = e.end || e.start;
    const overlaps = (a: KnownAppointment) => a.appointment_date <= end && (a.end_date || a.appointment_date) >= e.start;
    if (!customerId && e.car && normCar(e.car).length >= 2) {
      // 차종은 같은 차가 여럿일 수 있다: 하나뿐이면 그 사람, 여럿이면 그 날짜에 예약이 겹치는 사람만. 이름이 차 이름인 임시 고객("X7 고객")도 포함
      const key = normCar(e.car);
      // "테슬라 YL" ↔ "모델YL" 처럼 한쪽이 끝말로 포함돼도 같은 차로 본다
      const sameCar = (m: string | null | undefined) => { const k = normCar(m); return !!k && k.length >= 2 && (k === key || k.endsWith(key) || key.endsWith(k)); };
      let hits = customers.filter((c) => sameCar(c.car_model) || (c.cars || []).some(sameCar) || normCar(c.name).startsWith(key));
      if (hits.length > 1) hits = hits.filter((c) => appointments.some((a) => a.customer_id === c.id && overlaps(a)));
      if (hits.length === 1) { customerId = hits[0].id; customerName = hits[0].name; matchBy = 'car'; }
    }
    const dup = appointments.find((a) => {
      const overlap = overlaps(a);
      const sameCustomer = customerId && a.customer_id === customerId;
      const sameLabel = a.memo && norm(a.memo).includes(norm(e.label)) && norm(e.label).length >= 4;
      return overlap && (sameCustomer || sameLabel);
    });
    const carLabel = e.car || e.label.split(/\s+/)[0];
    return {
      ...e,
      key: `${i}-${e.start}-${norm(e.label)}`,
      customerId, customerName, matchBy,
      duplicateOf: dup ? dup.id : null,
      status: end < today ? '시공중' : '예약확정',
      newCustomerName: e.name || `${carLabel} 고객`,
      brand: guessBrand(e.car),
    };
  });
}
