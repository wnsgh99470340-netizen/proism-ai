/**
 * 고객 타임라인 (2026-11-23 사장님 "이카운트처럼 한 거래처의 모든 일이 한 화면에 날짜순으로")
 * 상담·견적 문자·문의 답변·회원 문자·예약·시공·보증서·QC·메인터넌스·리터치·후기·소개·포인트·회원 페이지를
 * 한 줄 목록으로 합친다. DB 를 읽지 않는 순수 함수 — 고객 상세가 이미 불러온 것만 넣는다.
 * 앞으로 일어날 것(예정 사후관리·앞 예약)은 upcoming, 지난 것은 past(최신 먼저).
 */
import { hideRefToken } from '@/components/crm/ReferrerPicker';
import { parseCareLog } from '@/lib/care-log';
import { isSkipped, skipReason, quoteCloseReason } from '@/lib/followups';
import { followUpLabel } from '@/config/sms-templates';
import { toSeoulISO } from '@/lib/local-date';
import type { Referral, PointRow } from '@/lib/referrals';

export type TimelineKind = 'register' | 'consult' | 'quote' | 'inquiry' | 'member' | 'appointment' | 'service' | 'warranty' | 'care' | 'retouch' | 'review' | 'arrival' | 'referral' | 'point' | 'page';
export type TimelineTone = 'normal' | 'ok' | 'warn' | 'muted' | 'future';

export interface TimelineEvent {
  date: string;            // YYYY-MM-DD (서울)
  kind: TimelineKind;
  title: string;           // 한 줄 제목 ("QC 점검 완료")
  detail?: string;         // 작은 글씨 한 줄
  tone: TimelineTone;
  sortKey: number;         // 같은 날 안의 순서용
}

export interface TimelineInput {
  today: string;
  customer: { name: string; created_at: string; source?: string | null };
  appointments: { id: string; appointment_date: string; end_date?: string | null; service_type: string | null; status: string; memo: string | null }[];
  services: { id: string; service_type: string; film_used?: string | null; service_date: string | null; completion_date?: string | null; amount?: number | null }[];
  consultations: { id: string; consultation_date: string; content: string | null; estimate?: string | null; memo: string | null }[];
  followUps: { id: string; follow_up_type: string; scheduled_date: string; is_completed: boolean; completed_date: string | null; memo: string | null; service?: { service_type: string } | null }[];
  referrals?: { receivedFrom: Referral | null; gave: Referral[] };
  points?: PointRow[];
  memberLink?: { created_at: string; last_seen_at: string | null; visits: number } | null;
}

const toDate = (v: string | null | undefined): string | null => {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : toSeoulISO(d);
};
const firstLine = (s: string | null | undefined) => (s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
const cleanMemo = (s: string | null | undefined) => hideRefToken(s).split(' · ').filter((seg) => !seg.startsWith('사진: ')).join(' · ').trim();
const short = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const fmtShort = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

export function buildTimeline(input: TimelineInput): { upcoming: TimelineEvent[]; past: TimelineEvent[] } {
  const ev: TimelineEvent[] = [];
  const push = (e: Omit<TimelineEvent, 'sortKey'> & { sortKey?: number }) => ev.push({ sortKey: 0, ...e });

  // 등록
  const reg = toDate(input.customer.created_at);
  if (reg) push({ date: reg, kind: 'register', title: '고객 등록', detail: input.customer.source ? `유입경로 ${input.customer.source}` : undefined, tone: 'muted', sortKey: -10 });

  // 상담 기록 — 접두로 종류를 가른다
  for (const c of input.consultations) {
    const d = toDate(c.consultation_date); if (!d) continue;
    const head = firstLine(c.content);
    const body = (c.content || '').split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
    if (head.startsWith('[견적 문자 발송]')) push({ date: d, kind: 'quote', title: '견적 문자 보냄', detail: short(body.find((l) => /견적|만원|원$/.test(l)) || body[0] || ''), tone: 'normal' });
    else if (head.startsWith('[문의 답변]')) push({ date: d, kind: 'inquiry', title: '문의 답변 보냄', detail: short(body[0] || ''), tone: 'normal' });
    else if (head.startsWith('[회원 문자]')) push({ date: d, kind: 'member', title: `회원 문자 · ${head.replace('[회원 문자]', '').trim() || '안내'}`, tone: 'muted' });
    else {
      const parts = [short(head || cleanMemo(c.memo), 70)];
      if (c.estimate) parts.push(`견적 ${c.estimate}`);
      push({ date: d, kind: 'consult', title: '상담', detail: parts.filter(Boolean).join(' · '), tone: 'normal' });
    }
  }

  // 예약 + 보증서
  for (const a of input.appointments) {
    const d = toDate(a.appointment_date); if (!d) continue;
    // QC·메인터넌스 방문 예약은 묶인 사후관리 줄("방문 예정")이 대신 말하므로 두 줄 만들지 않는다
    if ((a.service_type === 'QC점검' || a.service_type === '메인터넌스') && a.status !== '취소' && input.followUps.some((f) => f.follow_up_type === a.service_type && f.scheduled_date === a.appointment_date)) continue;
    const range = a.end_date && a.end_date !== a.appointment_date ? `${fmtShort(d)}~${fmtShort(a.end_date)}` : fmtShort(d);
    const svc = a.service_type || '시공 미정';
    const future = d > input.today && a.status !== '취소' && a.status !== '완료';
    push({
      date: d, kind: 'appointment',
      title: a.status === '취소' ? `예약 취소 · ${svc}` : a.status === '완료' ? `입고 · ${svc}` : `예약 · ${svc}`,
      detail: `${range} · ${a.status}`,
      tone: a.status === '취소' ? 'muted' : future ? 'future' : 'normal', sortKey: 1,
    });
    try {
      const w = JSON.parse(a.memo || '') as { warranty_issued?: boolean; warranty?: { date?: string; work_details?: string } };
      if (w && (w.warranty_issued || w.warranty)) {
        const wd = toDate(a.end_date) || toDate(w.warranty?.date) || d; // 발급은 완료(출고) 처리 때 — 보증서의 시공일(입고일)보다 출고일이 맞다
        push({ date: wd, kind: 'warranty', title: '보증서 발급 · 회원 등록', detail: w.warranty?.work_details ? short(w.warranty.work_details) : undefined, tone: 'ok', sortKey: 3 });
      }
    } catch { /* memo 가 JSON 이 아님 */ }
  }

  // 시공 기록
  for (const s of input.services) {
    const d = toDate(s.completion_date) || toDate(s.service_date); if (!d) continue;
    const parts = [s.film_used, s.amount && s.amount > 0 ? `${s.amount.toLocaleString()}원` : null].filter(Boolean) as string[];
    push({ date: d, kind: 'service', title: `시공 완료 · ${s.service_type}`, detail: parts.join(' · ') || undefined, tone: 'ok', sortKey: 2 });
  }

  // 사후관리
  for (const f of input.followUps) {
    const t = f.follow_up_type;
    const label = followUpLabel(t);
    const svc = f.service?.service_type ? ` (${f.service.service_type})` : '';
    const sched = toDate(f.scheduled_date);
    const done = toDate(f.completed_date) || sched;
    if (!sched || !done) continue;
    if (t === '입고안내') {
      if (!f.is_completed) push({ date: sched, kind: 'arrival', title: '입고 안내 문자 보낼 날', tone: 'future' });
      continue; // 보낸 뒤에는 예약 줄로 충분
    }
    if (t === '견적재연락' || t === '견적마무리') {
      if (!f.is_completed) { push({ date: sched, kind: 'quote', title: `${label} 할 날`, tone: sched < input.today ? 'warn' : 'future' }); continue; }
      const m = f.memo || '';
      if (/예약 잡혀 자동 정리/.test(m)) { if (t === '견적재연락') push({ date: done, kind: 'quote', title: '견적 → 예약으로 이어짐', tone: 'ok' }); continue; }
      const reason = quoteCloseReason(m);
      if (reason) { if (t === '견적재연락' || !input.followUps.some((o) => o.id !== f.id && o.follow_up_type === '견적재연락' && quoteCloseReason(o.memo))) push({ date: done, kind: 'quote', title: `견적 종결 · ${reason}`, tone: 'muted' }); continue; }
      push({ date: done, kind: 'quote', title: `${label} 완료`, tone: 'normal' });
      continue;
    }
    if (t === '리터치') {
      const log = parseCareLog(f.memo);
      push({ date: toDate(log?.date) || done, kind: 'retouch', title: `리터치${svc}`, detail: log?.note ? short(log.note) : undefined, tone: 'ok' });
      continue;
    }
    if (t === '후기요청') {
      const m = f.memo || '';
      const got = m.match(/후기 받음 (\d{4}-\d{2}-\d{2})/);
      if (got) push({ date: got[1], kind: 'review', title: '후기 받음', tone: 'ok' });
      else if (f.is_completed) push({ date: done, kind: 'review', title: '후기 요청 정리', tone: 'muted' });
      else push({ date: sched, kind: 'review', title: '후기 요청 할 날', tone: sched < input.today ? 'warn' : 'future' });
      continue;
    }
    // QC·메인터넌스
    if (f.is_completed) {
      if (isSkipped(f.memo)) { const r = skipReason(f.memo); push({ date: done, kind: 'care', title: `${label} 미방문${svc}`, detail: r || undefined, tone: 'muted' }); continue; }
      if (/기한 지나 정리/.test(f.memo || '')) { push({ date: done, kind: 'care', title: `${label} 기한 지나 정리${svc}`, tone: 'muted' }); continue; }
      const log = parseCareLog(f.memo);
      push({ date: toDate(log?.date) || done, kind: 'care', title: `${label} 완료${svc}`, detail: log?.note ? short(log.note) : undefined, tone: 'ok' });
    } else {
      const visit = input.appointments.find((a) => a.service_type === t && a.status !== '취소' && a.status !== '완료' && a.appointment_date === f.scheduled_date);
      push({ date: sched, kind: 'care', title: `${label} ${visit ? '방문 예정' : '연락할 날'}${svc}`, tone: sched < input.today ? 'warn' : 'future' });
    }
  }

  // 소개
  if (input.referrals) {
    const r = input.referrals.receivedFrom;
    if (r) {
      const d = toDate(r.created_at); if (d) push({ date: d, kind: 'referral', title: `소개받음 · ${r.referrer?.name || '-'} 님`, tone: 'normal' });
      const u = toDate(r.referred_reward_used_at); if (u) push({ date: u, kind: 'referral', title: `소개받은 분 혜택 적용 · ${r.referred_reward || ''}`.trim(), tone: 'ok' });
    }
    for (const g of input.referrals.gave) {
      const d = toDate(g.created_at); if (d) push({ date: d, kind: 'referral', title: `${g.referred?.name || '손님'} 님을 소개`, tone: 'normal' });
      const th = toDate(g.thanks_sms_sent_at); if (th) push({ date: th, kind: 'member', title: '소개 감사 문자 보냄', tone: 'muted' });
      const u = toDate(g.referrer_reward_used_at); if (u) push({ date: u, kind: 'referral', title: `소개 혜택 적용 · ${g.referrer_reward || ''}`.trim(), tone: 'ok' });
    }
  }

  // 포인트
  for (const p of input.points || []) {
    const d = toDate(p.created_at); if (!d) continue;
    push({ date: d, kind: 'point', title: p.delta > 0 ? `소개 포인트 +${p.delta}점` : `소개 포인트 ${p.delta}점 사용`, detail: short(p.reason), tone: p.delta > 0 ? 'ok' : 'normal' });
  }

  // 회원 페이지
  if (input.memberLink) {
    const seen = toDate(input.memberLink.last_seen_at);
    if (seen && input.memberLink.visits > 0) push({ date: seen, kind: 'page', title: `회원 페이지 열어 봄 · ${input.memberLink.visits}회`, detail: '마지막으로 본 날', tone: 'muted' });
  }

  const byDate = (a: TimelineEvent, b: TimelineEvent) => (a.date === b.date ? b.sortKey - a.sortKey : b.date.localeCompare(a.date));
  const upcoming = ev.filter((e) => e.tone === 'future' || e.tone === 'warn').sort((a, b) => (a.date === b.date ? a.sortKey - b.sortKey : a.date.localeCompare(b.date)));
  const past = ev.filter((e) => e.tone !== 'future' && e.tone !== 'warn').sort(byDate);
  return { upcoming, past };
}
