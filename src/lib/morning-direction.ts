/**
 * 아침 "오늘의 방향" 브리핑 — 서버판 (2026-11-27 사장님 "맥이 꺼져 있어도 폰으로 알림이 오나?" → 응 해줘)
 *
 * 2026-11-26 밤 사장님 부탁: "매일 아침마다 잘 될 수 있는 방향에 대해서 알려줘. 거침없이, 따끔하게."
 * 처음엔 이 앱의 로컬 예약 작업(proism-morning-direction)으로 만들었는데 맥이 켜져 있어야만 돌아서,
 * 매일 07시 /api/cron/daily 안에서 같은 일을 한다: CRM 숫자를 모아(읽기만) → Claude(sonnet)가 400자 안팎으로 쓰고 → 푸시.
 *
 * 규칙(사장님과 정한 것): 사실·숫자·오늘 행동으로 / 사람 평가 금지 / 비교 대상은 어제의 사장님 /
 * 전화번호 없는 견적 기록은 시험 기록으로 보고 행동에 안 넣음 / 류 대표 동업·경쟁 매장·딜러 대시보드·알림톡·유료 멤버십·새 기능 제안 금지 /
 * 블로그는 "이번 달 돈" 항목이 아님. 손님 이름은 푸시 본문에 들어가지만(사장님 폰) 전화번호는 뒷자리만.
 */
import { supabase } from './supabase';
import { callClaude } from './claude-client';
import { todaySeoul, addDaysISO } from './local-date';
import { isBlacklisted } from './blacklist';
import { parseSettlement } from './dealer-settlement';

const CARE_TYPES = ['QC점검', '메인터넌스'];
const INQUIRY_RE = /^\[(견적 문자 발송|문의 답변|통화 요약|견적서 발급)\]/;
const SETTLEMENT_START = '2026-11-25';

type Cust = { id: string; name: string; phone: string | null; car_brand: string | null; car_model: string | null; kind: string | null; dealer_id: string | null; memo: string | null; created_at: string };
type App = { id: string; customer_id: string | null; appointment_date: string; end_date: string | null; status: string; service_type: string | null; memo: string | null; follow_up_id: string | null };
type Fu = { id: string; customer_id: string | null; service_id: string | null; follow_up_type: string; scheduled_date: string; is_completed: boolean; sms_sent: unknown; memo: string | null; completed_date: string | null };
type Svc = { id: string; customer_id: string | null; service_date: string | null; service_type: string | null; amount: number | null; memo: string | null };
type Con = { id: string; customer_id: string | null; consultation_date: string; content: string | null; memo: string | null };

export interface MorningFacts {
  date: string;
  text: string;          // 모델에게 주는 사실 묶음 (사람이 읽어도 됨)
  counts: { todayApps: number; overdue: number; undecided: number; careNoVisit: number; testRecords: number; monthCount: number; monthAmount: number; prevCount: number; prevAmount: number; upcoming: number; dealerUnpaid: number };
}

const won = (n: number) => (n ? `${Math.round(n / 10000).toLocaleString()}만` : '0');
const mask = (p: string | null | undefined) => { const d = (p || '').replace(/\D/g, ''); return d ? `…${d.slice(-4)}` : '전화없음'; };
const norm = (p: string | null | undefined) => (p || '').replace(/\D/g, '');
const carOf = (c?: Cust | null) => [c?.car_brand, c?.car_model].filter(Boolean).join(' ') || '차종?';
const daysBetween = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 864e5);
const seoulDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);

/** CRM 을 읽어 사실 묶음을 만든다 (읽기만) */
export async function collectMorningFacts(date = todaySeoul()): Promise<MorningFacts> {
  const today = date, yesterday = addDaysISO(date, -1), tomorrow = addDaysISO(date, 1);
  const [{ data: custsRaw }, { data: appsRaw }, { data: fuRaw }, { data: svcRaw }] = await Promise.all([
    supabase.from('customers').select('id,name,phone,car_brand,car_model,kind,dealer_id,memo,created_at'),
    supabase.from('appointments').select('id,customer_id,appointment_date,end_date,status,service_type,memo,follow_up_id').neq('status', '취소'),
    supabase.from('follow_ups').select('id,customer_id,service_id,follow_up_type,scheduled_date,is_completed,sms_sent,memo,completed_date'),
    supabase.from('services').select('id,customer_id,service_date,service_type,amount,memo'),
  ]);
  const custs = (custsRaw || []) as Cust[];
  const apps = (appsRaw || []) as App[];
  const fus = (fuRaw || []) as Fu[];
  const svcs = (svcRaw || []) as Svc[];
  const cmap = new Map(custs.map((c) => [c.id, c]));
  const smap = new Map(svcs.map((s) => [s.id, s]));
  const isCare = (a: App) => CARE_TYPES.includes(a.service_type || '');
  const inRange = (a: App, d: string) => a.appointment_date <= d && (a.end_date || a.appointment_date) >= d;
  const out: string[] = [`# ${today} 아침 수집 (어제 ${yesterday})`];

  // 1 오늘·내일 예약
  let todayApps = 0;
  out.push('\n## 1 오늘·내일 입고·작업');
  for (const d of [today, tomorrow]) {
    const rows = apps.filter((a) => inRange(a, d) && !isCare(a));
    if (d === today) todayApps = rows.length;
    out.push(`### ${d}: ${rows.length}건`);
    for (const a of rows) {
      const c = a.customer_id ? cmap.get(a.customer_id) : null;
      const dealer = c?.dealer_id ? cmap.get(c.dealer_id)?.name : null;
      out.push(`- ${a.appointment_date}~${a.end_date || ''} ${a.status} | ${c?.name || '?'} ${carOf(c)} | ${a.service_type || ''} | ${mask(c?.phone)}${dealer ? ` | 딜러 ${dealer}` : ''}`);
    }
    for (const a of apps.filter((x) => inRange(x, d) && isCare(x))) { const c = a.customer_id ? cmap.get(a.customer_id) : null; out.push(`- (방문) ${a.service_type} | ${c?.name || '?'} ${carOf(c)}`); }
  }
  for (const a of apps.filter((x) => x.appointment_date === today && !isCare(x))) {
    const notice = fus.find((f) => f.follow_up_type === '입고안내' && f.customer_id === a.customer_id);
    out.push(`- 오늘 입고 ${a.customer_id ? cmap.get(a.customer_id)?.name : '?'}: 입고안내 ${notice ? (notice.sms_sent ? '보냄' : '기록만 있고 안 보냄') : '없음'}`);
  }

  // 2 끝났는데 완료 안 된 예약
  const overdue = apps.filter((a) => ['예약확정', '시공중'].includes(a.status) && (a.end_date || a.appointment_date) < today && !isCare(a));
  out.push(`\n## 2 끝난 날 지났는데 완료 처리 안 된 예약: ${overdue.length}건`);
  for (const a of overdue) { const c = a.customer_id ? cmap.get(a.customer_id) : null; out.push(`- ${a.appointment_date}~${a.end_date || ''} ${a.status} | ${c?.name || '?'} ${carOf(c)} | ${a.service_type || ''}`); }

  // 3 문의했는데 결정 안 한 분 (전화번호 있는 것만; 없는 건 시험 기록)
  const openQ = fus.filter((f) => ['견적재연락', '견적마무리'].includes(f.follow_up_type) && !f.is_completed);
  let testRecords = 0;
  out.push('\n## 3 열린 견적 재연락·마무리');
  for (const f of openQ) {
    const c = f.customer_id ? cmap.get(f.customer_id) : null;
    const first = (f.memo || '').split('\n')[0];
    const phone = c?.phone || (first.match(/01\d-?\d{3,4}-?\d{4}/) || [])[0] || '';
    if (!phone) { testRecords++; continue; }
    out.push(`- ${f.scheduled_date}${f.scheduled_date < today ? '(지남)' : ''} ${f.follow_up_type} | ${c ? `${c.name} ${carOf(c)}` : first} | ${mask(phone)} | 문자 ${f.sms_sent ? '보냄' : '안 보냄'}`);
  }
  const since14 = addDaysISO(today, -14);
  const { data: consRaw } = await supabase.from('consultations').select('id,customer_id,consultation_date,content,memo').gte('consultation_date', since14).order('consultation_date');
  const cons = (consRaw || []) as Con[];
  const undecided = new Map<string, { name: string; car: string; phone: string; kinds: string[]; last: string; what: string }>();
  for (const c of cons) {
    const head = (c.content || '').split('\n')[0];
    const kind = /\[견적 문자 발송\]/.test(head) ? '견적 문자' : /\[문의 답변\]/.test(head) ? '문의 답변' : /\[통화 요약\]/.test(head) ? '통화' : /\[견적서 발급\]/.test(head) ? '견적서' : null;
    if (!kind) continue;
    if (kind === '통화' && !/문의|견적|가격|얼마|상담|예약/.test(c.content || '')) continue;
    const memoFirst = (c.memo || '').split('\n')[0];
    const cu0 = c.customer_id ? cmap.get(c.customer_id) : undefined;
    const phone = cu0?.phone || (memoFirst.match(/01\d-?\d{3,4}-?\d{4}/) || [])[0] || '';
    if (!phone) { testRecords++; continue; }
    const cid = c.customer_id || custs.find((x) => norm(x.phone) === norm(phone))?.id || null;
    const cu = cid ? cmap.get(cid) : undefined;
    if (cu?.kind === '딜러') continue;
    if (cid && apps.some((a) => a.customer_id === cid && a.appointment_date >= c.consultation_date)) continue;
    const key = cid || norm(phone);
    const prev = undecided.get(key) || { name: cu?.name || memoFirst.split(' ')[0] || '?', car: cu ? carOf(cu) : (memoFirst.split('·')[1] || '').trim(), phone, kinds: [], last: c.consultation_date, what: (c.content || '').split('\n').slice(1, 3).join(' / ').slice(0, 90) };
    prev.kinds.push(`${c.consultation_date.slice(5)} ${kind}`); prev.last = c.consultation_date;
    undecided.set(key, prev);
  }
  out.push(`\n## 3b 지난 14일 문의·견적·통화 뒤 예약 없는 분: ${undecided.size}명`);
  for (const e of undecided.values()) out.push(`- ${e.name} ${e.car} | ${mask(e.phone)} | ${e.kinds.join(', ')} | 마지막 ${e.last} (${daysBetween(today, e.last)}일 전) | ${e.what}`);
  if (testRecords) out.push(`(전화번호 없는 견적·문의 기록 ${testRecords}건은 시험 기록으로 보고 뺌)`);

  // 4 7일 안 QC·메인터넌스 중 방문 안 잡힌 분
  const care = fus.filter((f) => CARE_TYPES.includes(f.follow_up_type) && !f.is_completed && f.scheduled_date <= addDaysISO(today, 7)).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  const visitFor = (f: Fu) => apps.find((a) => isCare(a) && (a.follow_up_id === f.id || (a.memo || '').includes(`사후관리:${f.id}`)));
  let careNoVisit = 0;
  out.push('\n## 4 7일 안 QC·메인터넌스 중 방문 안 잡힌 분 (지난 것 포함)');
  for (const f of care) {
    const c = f.customer_id ? cmap.get(f.customer_id) : null;
    if (!c || isBlacklisted(c.memo) || visitFor(f)) continue;
    careNoVisit++;
    const s = f.service_id ? smap.get(f.service_id) : null;
    const over = f.scheduled_date < today ? `(${daysBetween(today, f.scheduled_date)}일 지남)` : '';
    out.push(`- ${f.scheduled_date}${over} ${f.follow_up_type} | ${c.name} ${carOf(c)} | ${s?.service_type || '?'} ${s?.service_date || ''} | ${mask(c.phone)} | 문자 ${f.sms_sent ? '보냄' : '안 보냄'}`);
  }
  out.push(`합계 ${careNoVisit}건`);

  // 5 어제 숫자
  const { data: yConsRaw } = await supabase.from('consultations').select('id,content').eq('consultation_date', yesterday);
  const kinds: Record<string, number> = {};
  for (const c of (yConsRaw || []) as { content: string | null }[]) { const k = ((c.content || '').split('\n')[0].match(/^\[([^\]]+)\]/) || [])[1] || '일반 상담'; kinds[k] = (kinds[k] || 0) + 1; }
  const newCust = custs.filter((c) => seoulDate(c.created_at) === yesterday && c.kind !== '딜러');
  const doneY = apps.filter((a) => a.status === '완료' && (a.end_date || a.appointment_date) === yesterday && !isCare(a));
  const svcY = svcs.filter((s) => s.service_date === yesterday);
  const fuDoneY = fus.filter((f) => f.is_completed && f.completed_date === yesterday);
  out.push(`\n## 5 어제(${yesterday}) 숫자`);
  out.push(`상담 기록 ${Object.values(kinds).reduce((a, b) => a + b, 0)}건: ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ') || '없음'}`);
  out.push(`새 고객 ${newCust.length}명 / 어제 출고(완료) ${doneY.length}건: ${doneY.map((a) => `${a.customer_id ? cmap.get(a.customer_id)?.name : '?'} ${a.service_type}`).join(', ') || '없음'}`);
  out.push(`어제 시공 기록 ${svcY.length}건 금액 ${won(svcY.reduce((a, s) => a + (s.amount || 0), 0))}: ${svcY.map((s) => `${s.customer_id ? cmap.get(s.customer_id)?.name : '?'} ${s.service_type} ${won(s.amount || 0)}`).join(', ') || '없음'}`);
  out.push(`어제 완료한 사후관리 ${fuDoneY.length}건: ${fuDoneY.map((f) => f.follow_up_type).join(', ') || '없음'}`);

  // 6 이번 달 누적 vs 지난달 같은 날까지
  const m0 = `${today.slice(0, 7)}-01`;
  const day = today.slice(8);
  const pmDate = new Date(`${today}T12:00:00Z`); pmDate.setUTCMonth(pmDate.getUTCMonth() - 1);
  const pm0 = `${pmDate.toISOString().slice(0, 7)}-01`, pmEnd = `${pmDate.toISOString().slice(0, 7)}-${day}`;
  const sum = (arr: Svc[]) => arr.reduce((a, s) => a + (s.amount || 0), 0);
  const sThis = svcs.filter((s) => (s.service_date || '') >= m0 && (s.service_date || '') <= today);
  const sPrev = svcs.filter((s) => (s.service_date || '') >= pm0 && (s.service_date || '') <= pmEnd);
  const { data: consMonthRaw } = await supabase.from('consultations').select('id,consultation_date,content').gte('consultation_date', pm0);
  const consMonth = (consMonthRaw || []) as { consultation_date: string; content: string | null }[];
  const inq = (from: string, to: string) => consMonth.filter((c) => c.consultation_date >= from && c.consultation_date <= to && INQUIRY_RE.test((c.content || '').split('\n')[0])).length;
  const appsNext = apps.filter((a) => a.appointment_date > today && !isCare(a)).sort((a, b) => a.appointment_date.localeCompare(b.appointment_date));
  out.push('\n## 6 이번 달 누적');
  out.push(`완료 시공: 이번 달 ${sThis.length}건 ${won(sum(sThis))} / 지난달 같은 날까지 ${sPrev.length}건 ${won(sum(sPrev))}`);
  out.push(`새 문의(견적 문자·문의 답변·통화·견적서): 이번 달 ${inq(m0, today)} / 지난달 같은 날까지 ${inq(pm0, pmEnd)}`);
  out.push(`앞으로 잡힌 입고 예약 ${appsNext.length}건: ${appsNext.slice(0, 8).map((a) => `${a.appointment_date.slice(5)} ${a.customer_id ? cmap.get(a.customer_id)?.name : '?'} ${a.service_type}`).join(' | ') || '없음'}`);

  // 7 딜러 미수
  let dealerUnpaid = 0, dealerAmt = 0;
  out.push(`\n## 7 딜러 미수 (${SETTLEMENT_START} 이후, 정산 표시 없음)`);
  for (const s of svcs) {
    if ((s.service_date || '') < SETTLEMENT_START) continue;
    const c = s.customer_id ? cmap.get(s.customer_id) : null;
    if (!c?.dealer_id || parseSettlement(s.memo)?.paid_at) continue;
    dealerUnpaid++; dealerAmt += s.amount || 0;
    out.push(`- ${s.service_date} ${c.name} ${carOf(c)} ${s.service_type} ${won(s.amount || 0)} | 딜러 ${cmap.get(c.dealer_id)?.name || '?'}`);
  }
  out.push(`합계 ${dealerUnpaid}건 ${won(dealerAmt)}`);

  return {
    date: today,
    text: out.join('\n'),
    counts: { todayApps, overdue: overdue.length, undecided: undecided.size, careNoVisit, testRecords, monthCount: sThis.length, monthAmount: sum(sThis), prevCount: sPrev.length, prevAmount: sum(sPrev), upcoming: appsNext.length, dealerUnpaid },
  };
}

const SYSTEM = `너는 3M 프로이즘 강남서초점 대표 진준호(사장님)의 아침 방향 브리핑 담당이다. 사장님이 직접 부탁했다: "매일 아침마다 잘 될 수 있는 방향에 대해서 알려줘. 거침없이 말해줘도 돼. 따끔하게 정신 차리게."
배경: 혼자 운영하는 자동차 필름(PPF·컬러PPF·랩핑·썬팅) 매장, 연 지 1년 남짓, 아직 수입이 적어 조급하고 지쳐 있다. 그래서 (1) 사실과 숫자로 (2) 오늘 당장 할 행동으로 (3) 짧게 말한다. 위로는 안 해도 되지만 사람을 깎아내리지 않는다. 비교 대상은 다른 매장이 아니라 어제의 사장님이다. "게으르다·안일하다" 같은 인격 평가 금지. 숫자가 좋으면 좋다고 그대로.

아래 [사실]만 쓴다. 없는 손님·숫자를 만들지 않는다. 제안하지 않을 것(이미 결정됨): 동업·새 사업, 경쟁 매장 조사, 딜러 대시보드·딜러 방문, 카카오 알림톡, 유료 멤버십, 새 CRM 기능, 블로그를 "이번 달 돈"으로 세는 것.

형식(한국어, 전체 400자 안팎, 이모지·격언·응원 문구 없음, 전화번호는 뒷자리 4개까지만):
오늘 돈과 가장 가까운 행동 3개
1. 이름 차종 — 왜 지금인지 한 줄. 우선순위: 문의했는데 결정 안 한 분에게 전화 > 오늘 입고 차 챙기기(입고 안내·딜러) > 완료 처리 안 된 예약 > 7일 안 QC·메인터넌스 중 PPF·컬러PPF 손님 방문 잡기(점검 때 생활보호·실내 PPF 제안 가능) > 랩핑·썬팅 메인터넌스.
2. …
3. …
(3개가 안 채워지면 "오늘은 전화할 사람이 없다. 그러면 X를 해라"로 솔직히)

어제: 상담 N · 문자 N · 출고 N · 금액 (0이면 0. [회원 문자]·[딜러 문자]처럼 한꺼번에 찍힌 자동 기록은 상담 수에 섞지 말고 "회원 문자 N건 따로"로)

따끔한 한마디: 숫자에서 나온 것 한 줄. 숫자가 좋으면 "어제는 됐다. 오늘도 같은 걸 해라."

오늘 하지 말 것: 한 줄 (보통 "새 기능·블로그 손보기 전에 위 전화부터")`;

/** 사실 묶음을 Claude 가 브리핑 문장으로. API 키가 없으면 숫자만으로 된 대체문 */
export async function composeMorningDirection(facts: MorningFacts): Promise<{ text: string; model: string }> {
  const md = facts.date.slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/');
  if (!process.env.ANTHROPIC_API_KEY) return { text: fallbackText(facts), model: 'none' };
  try {
    const text = await callClaude(SYSTEM, [{ role: 'user', content: `오늘은 ${facts.date} 이다. 제목은 "오늘의 방향 ${md}".\n\n[사실]\n${facts.text}` }], 1500, 'claude-sonnet-5-5');
    const clean = text.trim();
    if (clean.length < 60) return { text: fallbackText(facts), model: `fallback-short(${clean.length}): ${clean.slice(0, 80)}` };
    return { text: clean.slice(0, 1500), model: 'claude-sonnet-5-5' };
  } catch (e) {
    return { text: fallbackText(facts), model: `fallback-error: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}` };
  }
}

function fallbackText(f: MorningFacts): string {
  const c = f.counts;
  return [
    `오늘의 방향 ${f.date.slice(5)}`,
    `문의 뒤 결정 안 한 분 ${c.undecided}명 · 오늘 입고 ${c.todayApps}건 · 완료 처리 안 된 예약 ${c.overdue}건 · 7일 안 점검 방문 안 잡힌 분 ${c.careNoVisit}명`,
    `이번 달 시공 ${c.monthCount}건 ${won(c.monthAmount)} / 지난달 같은 날까지 ${c.prevCount}건 ${won(c.prevAmount)} · 앞으로 잡힌 입고 ${c.upcoming}건`,
    c.dealerUnpaid ? `딜러 미수 ${c.dealerUnpaid}건` : '',
    '브리핑 문장은 못 만들었다(모델 호출 실패). 위 숫자 순서대로 전화부터.',
  ].filter(Boolean).join('\n');
}

export interface MorningResult { date: string; text: string; model: string; counts: MorningFacts['counts']; factsText: string }

/** 수집 → 작성. 푸시·저장은 부르는 쪽(크론)이 한다 */
export async function buildMorningDirection(date = todaySeoul()): Promise<MorningResult> {
  const facts = await collectMorningFacts(date);
  const { text, model } = await composeMorningDirection(facts);
  return { date: facts.date, text, model, counts: facts.counts, factsText: facts.text };
}
