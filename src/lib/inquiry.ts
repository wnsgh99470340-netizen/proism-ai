/**
 * 문의 자동 답변 (2026-11-12)
 * 카페·문자·톡으로 온 문의 글을 붙여 넣으면
 *  1) 정규식으로 시공 항목을 찾고(src/config/inquiry-pricing.ts 시장 평균가)
 *  2) Claude 가 차종·이름·전화·질문·빠진 항목을 읽고
 *  3) 숫자는 코드가 정한 값만 쓰도록 사실 블록을 주고 Claude 가 사장님 말투로 답변을 쓴다
 *  4) 답변 속 "N만" 숫자가 허용 목록 밖이면 1회 다시 쓰고, 그래도 남으면 경고로 표시
 * 가격은 "많은 업체들 평균가"(사장님 결정), 시간은 사장님 기준.
 */
import { callClaude } from './claude-client';
import { MARKET_ITEMS, matchItems, estimateDuration, priceText, fmtMan, CONFIDENCE_LABEL, type MarketItem } from '@/config/inquiry-pricing';

export interface InquiryItem {
  key: string;
  label: string;
  unit?: string;
  min: number;
  max: number;
  typical: number;
  confidence: string;
  confidenceLabel: string;
  note?: string;
  priceText: string;
}

export interface InquiryAnswer {
  car: string;
  name: string;
  phone: string;
  asks: { price: boolean; time: boolean; other: string[] };
  items: InquiryItem[];
  /** 찾지 못한 요청(차량 보고 안내) */
  unmatched: string[];
  total: { min: number; max: number; typical: number } | null;
  duration: string;
  reply: string;
  warnings: string[];
}

interface Extracted {
  car?: string;
  name?: string;
  phone?: string;
  asks?: { price?: boolean; time?: boolean; other?: string[] };
  extra_items?: string[];
  more_keys?: string[];
}

function parseJson<T>(raw: string): T | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as T; } catch { return null; }
}

async function extract(text: string, matched: MarketItem[]): Promise<Extracted> {
  const catalog = MARKET_ITEMS.map(m => `${m.key}: ${m.label}${m.unit ? `(${m.unit})` : ''}`).join('\n');
  const sys = `자동차 시공 매장(PPF·랩핑·썬팅)에 온 고객 문의 글을 읽고 JSON 만 출력한다. 설명 금지.
{"car":"차종(브랜드+모델+세대, 없으면 빈 문자열)","name":"고객 이름(없으면 빈)","phone":"전화번호(없으면 빈)","asks":{"price":가격을 물었는가,"time":시공 시간·기간을 물었는가,"other":["그 외 질문 요약"]},"more_keys":["이미 잡힌 항목 외에 아래 목록에서 고객이 분명히 요청한 항목의 key"],"extra_items":["목록에 없는 요청(고객 표현 그대로, 짧게)"]}
항목 목록:
${catalog}
이미 잡힌 항목: ${matched.map(m => m.key).join(', ') || '없음'}
규칙: 고객이 말하지 않은 것을 넣지 않는다. 같은 뜻이면 more_keys 에 넣지 말고 extra_items 도 비운다. "기본 생활기스 방지"는 life3 다.`;
  const raw = await callClaude(sys, [{ role: 'user', content: text }], 800);
  return parseJson<Extracted>(raw) || {};
}

function buildFacts(a: Omit<InquiryAnswer, 'reply' | 'warnings'>): string {
  const lines = a.items.map(i => `- ${i.label}${i.unit ? `(${i.unit})` : ''}: ${i.priceText}`);
  if (a.unmatched.length) lines.push(...a.unmatched.map(u => `- ${u}: 가격은 차량을 보고 안내(숫자 쓰지 말 것)`));
  const total = a.total && a.total.typical > 0 && a.items.filter(i => i.typical > 0).length >= 2
    ? `합계: 대략 ${fmtMan(a.total.typical)} 안팎 (범위 ${fmtMan(a.total.min)}~${fmtMan(a.total.max)})`
    : '합계: 쓰지 말 것';
  const dur = a.duration ? `시공 시간: ${a.duration}` : '시공 시간: 정해진 기준 없음 → "차량 보고 안내드리겠습니다"로만';
  return [`차종: ${a.car || '언급 없음'}`, '항목별 가격(이 숫자만 사용):', ...lines, total, dur].join('\n');
}

const REPLY_SYSTEM = `너는 3M 프로이즘 강남서초점에서 고객 문의에 답하는 사람이다. 아래 [사실]만으로 답장을 쓴다.

말투: 존댓말, 짧은 문장, 한 줄 10~18자 안팎으로 줄바꿈, 마침표 생략. 친절하지만 과장 없이
구조: 1) "안녕하세요 3M 프로이즘 강남서초점입니다" 2) 문의 항목별 가격을 "항목 약 N만 원 선" 식으로 한 줄씩(같은 어미를 매 줄 반복하지 않는다) 3) 합계가 있으면 "다 하시면 대략 N만 원 안팎" 한 줄 4) 시공 시간 5) 실차를 보면 범위에 따라 조정될 수 있다는 한 줄 6) 어디까지 할지 정하지 않고 오셔도 된다는 한 줄 7) 입고 편하신 날짜 두 개 알려 달라는 한 줄 8) 마지막 줄은 "010-7287-7140" 연락처 한 줄(앞에 군더더기 문장 없이)
숫자: [사실]에 적힌 금액·시간만 쓴다. 다른 숫자(경력·보증 기간·두께·겹수·고객 수)는 절대 쓰지 않는다. 가격은 "약 N만 원 선"처럼 '선'을 붙인다
쓰지 않는 것: 작업자·경력·직접 시공 소개, 제품 스펙, 다른 매장 비교, 이모지 남발, 링크, 해시태그, 고객 이름 호칭(이름이 없으면)
길이: 300~550자. 답장 본문만 출력`;

function numbersIn(text: string): number[] {
  return Array.from(text.matchAll(/(\d[\d,]*)\s*만/g)).map(m => Number(m[1].replace(/,/g, ''))).filter(n => !Number.isNaN(n));
}

export async function answerInquiry(text: string): Promise<InquiryAnswer> {
  const src = text.trim();
  let matched = matchItems(src);
  const ex = await extract(src, matched).catch(() => ({} as Extracted));
  for (const k of ex.more_keys || []) {
    const it = MARKET_ITEMS.find(m => m.key === k);
    if (it && !matched.some(m => m.key === k)) matched.push(it);
  }
  matched = matchDedupe(matched);

  const items: InquiryItem[] = matched.map(m => ({
    key: m.key, label: m.label, unit: m.unit, min: m.min, max: m.max, typical: m.typical,
    confidence: m.confidence, confidenceLabel: CONFIDENCE_LABEL[m.confidence], note: m.note, priceText: priceText(m),
  }));
  const priced = items.filter(i => i.typical > 0);
  // 합계는 5만 단위로 둥글게(92만 → 90만). 평균값을 더한 숫자라 자릿수까지 정확한 척하지 않는다
  const round5 = (n: number) => Math.round(n / 5) * 5;
  const total = priced.length
    ? { min: round5(priced.reduce((s, i) => s + i.min, 0)), max: round5(priced.reduce((s, i) => s + i.max, 0)), typical: round5(priced.reduce((s, i) => s + i.typical, 0)) }
    : null;
  const base: Omit<InquiryAnswer, 'reply' | 'warnings'> = {
    car: (ex.car || '').trim(),
    name: (ex.name || '').trim(),
    phone: (ex.phone || '').trim(),
    asks: { price: ex.asks?.price !== false, time: Boolean(ex.asks?.time), other: ex.asks?.other || [] },
    items,
    unmatched: (ex.extra_items || []).map(s => s.trim()).filter(Boolean).slice(0, 5),
    total,
    duration: estimateDuration(matched),
  };

  const facts = buildFacts(base);
  const allowed = new Set<number>();
  for (const i of priced) { allowed.add(i.typical); allowed.add(i.min); allowed.add(i.max); }
  if (total) { allowed.add(total.typical); allowed.add(total.min); allowed.add(total.max); }

  const warnings: string[] = [];
  let reply = '';
  for (let pass = 0; pass < 2; pass++) {
    const user = `[문의 글]\n${src}\n\n[사실]\n${facts}${pass === 1 ? `\n\n앞 답장에 [사실]에 없는 금액이 있었다. 금액은 [사실]의 숫자만 쓰고 다시 써라.` : ''}`;
    reply = (await callClaude(REPLY_SYSTEM, [{ role: 'user', content: user }], 1200)).trim();
    const bad = numbersIn(reply).filter(n => !allowed.has(n));
    if (bad.length === 0) break;
    if (pass === 1) warnings.push(`답변에 기준 밖 금액이 남아 있습니다: ${bad.map(n => `${n}만`).join(', ')} — 보내기 전에 확인하세요`);
  }
  if (!base.car) warnings.push('차종을 읽지 못했습니다. 답변의 차종 표현을 확인하세요');
  for (const i of items) if (i.confidence === 'low') warnings.push(`${i.label}은(는) 시장 자료가 적어 평균값(${fmtMan(i.typical)})으로 적었습니다`);
  for (const i of items) if (i.confidence === 'ours') warnings.push(`${i.label}은(는) 시장 자료가 없어 우리 견적표 값입니다`);
  if (!base.duration && base.asks.time) warnings.push('이 조합의 시공 시간 기준이 없어 "차량 보고 안내"로 적었습니다');

  return { ...base, reply, warnings };
}

function matchDedupe(items: MarketItem[]): MarketItem[] {
  const seen = new Set<string>();
  return items.filter(i => (seen.has(i.key) ? false : (seen.add(i.key), true)));
}
