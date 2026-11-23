/**
 * 빠진 것 확인 (2026-11-19 사장님 "내가 널 찾지 않아도 돌아갈 수 있는 시스템" 중 하나)
 * - 작업은 끝났는데 회원 페이지 링크를 안 보낸 분 (최근 30일 시공)
 * - 날짜가 지났는데 시공중·예약확정 그대로 멈춘 예약 (7일 넘음)
 * - 후기 요청 문자를 보냈는데 2주 넘게 답(완료 표시) 없는 분
 * 홈 "마케팅팀 오늘 한 일"에는 매일 보이고, 푸시는 금요일 07시에 전체, 급한 묶음(urgent)은 매일 07시 브리핑 본문에 한 줄 (2026-11-23). Claude 호출 없음.
 * 2026-11-23 추가: 중복 기록 / 지난 QC·메인터넌스(방문도 안 잡힘) / 고객과 안 묶인 상담 / 메인터넌스 기간 끝나가는 차. 멈춘 예약 기준 7일 → 끝난 다음 날
 */
import { supabase } from './supabase';
import { isImportedCustomer } from './crm-shared';
import { todaySeoul, addDaysISO } from './local-date';

export interface MissedGroup {
  key: 'link' | 'stuck' | 'review' | 'fill' | 'dup' | 'careLate' | 'orphan' | 'careEnding';
  label: string;
  count: number;
  /** 아침마다 바로 알려야 하는 것 (2026-11-23 사장님 "자비스처럼 먼저 말 걸어 줘"): 중복·지난 QC·끝난 예약 */
  urgent?: boolean;
  /** 화면·푸시용 짧은 줄 (이름 · 내용) */
  lines: string[];
  /** 어디서 처리하는지 */
  where: string;
}

export interface MissedReport {
  date: string;
  groups: MissedGroup[];
  total: number;
}

const LINK_WINDOW_DAYS = 30;
const STUCK_DAYS = 1;      // 끝난 다음 날부터 (2026-11-23: 예전 7일 → 홈 '완료 처리할 예약' 카드와 같은 기준)
const REVIEW_DAYS = 14;
const CARE_LATE_DAYS = 3;  // QC·메인터넌스 예정일이 지났는데 방문도 안 잡히고 완료도 안 됨
const ORPHAN_DAYS = 2;     // 전화만 있는 상담 기록이 고객과 안 묶인 채 며칠
const CARE_ENDING_DAYS = 60; // 메인터넌스 기간이 두 달 안에 끝나는 차

type NameRow = { name: string } | null;
const nameOf = (c: unknown) => ((c as NameRow)?.name || '고객');

export async function buildMissedReport(date = todaySeoul()): Promise<MissedReport> {
  const groups: MissedGroup[] = [];

  // 1) 회원 링크 안 보낸 분: 최근 30일 안에 시공(completion_date 또는 service_date)이 있는데 링크 문자 기록도, 열어 본 기록도 없음
  try {
    const since = addDaysISO(date, -LINK_WINDOW_DAYS);
    const [{ data: services }, { data: sent }, { data: links }] = await Promise.all([
      supabase.from('services').select('customer_id, service_type, service_date, completion_date, customer:customers(name)').or(`completion_date.gte.${since},service_date.gte.${since}`).order('service_date', { ascending: false }),
      supabase.from('consultations').select('customer_id').eq('memo', '회원 문자').like('content', '[회원 문자] 회원 페이지 링크%'),
      supabase.from('member_links').select('customer_id, visits'),
    ]);
    const sentSet = new Set((sent || []).map((r) => r.customer_id as string));
    for (const l of links || []) if (((l.visits as number | null) || 0) > 0) sentSet.add(l.customer_id as string);
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const s of services || []) {
      const cid = s.customer_id as string;
      if (!cid || seen.has(cid) || sentSet.has(cid)) continue;
      const d = (s.completion_date as string | null) || (s.service_date as string | null) || '';
      if (d && d > date) continue; // 아직 안 끝난 작업
      seen.add(cid);
      lines.push(`${nameOf(s.customer)} · ${s.service_type || '시공'}${d ? ` ${d.slice(5).replace('-', '.')}` : ''}`);
    }
    if (lines.length) groups.push({ key: 'link', label: '회원 링크 안 보낸 분', count: lines.length, lines, where: '회원 페이지 목록 → 링크 안 보낸 분만' });
  } catch { /* 표가 없거나 조회 실패 → 이 항목만 건너뜀 */ }

  // 2) 멈춘 예약: 끝나는 날이 7일 넘게 지났는데 시공중·예약확정 그대로
  try {
    const cutoff = addDaysISO(date, -STUCK_DAYS);
    const { data } = await supabase.from('appointments').select('appointment_date, end_date, service_type, status, customer:customers(name)').in('status', ['시공중', '예약확정']).lte('appointment_date', cutoff).order('appointment_date', { ascending: true });
    const lines = (data || [])
      .filter((a) => ((a.end_date as string | null) || (a.appointment_date as string)) <= cutoff)
      .map((a) => `${nameOf(a.customer)} · ${a.service_type || ''} ${(a.appointment_date as string).slice(5).replace('-', '.')} ${a.status}`);
    if (lines.length) groups.push({ key: 'stuck', label: '끝났는데 완료 처리 안 된 예약', count: lines.length, lines, where: '홈 → 완료 처리할 예약 카드', urgent: true });
  } catch { /* 건너뜀 */ }

  // 3) 후기 답 없는 분: 후기요청 문자는 보냈고(sms_sent) 2주 넘게 완료 표시가 없음
  try {
    const cutoff = addDaysISO(date, -REVIEW_DAYS);
    const { data } = await supabase.from('follow_ups').select('scheduled_date, sms_sent, customer:customers(name)').eq('follow_up_type', '후기요청').eq('is_completed', false).lte('scheduled_date', cutoff).order('scheduled_date', { ascending: true });
    const lines = (data || [])
      .filter((f) => Object.values((f.sms_sent as Record<string, boolean> | null) || {}).some(Boolean))
      .map((f) => `${nameOf(f.customer)} · 요청 ${(f.scheduled_date as string).slice(5).replace('-', '.')}`);
    if (lines.length) groups.push({ key: 'review', label: '후기 요청 뒤 2주 답 없는 분', count: lines.length, lines, where: '사후관리 탭 → 후기요청 → 후기 받음 또는 다시 문자' });
  } catch { /* 건너뜀 */ }

  // 5) 중복 (2026-11-23): 같은 고객·시공일·종류의 시공 기록, 같은 시공 기록에 같은 유형의 QC·메인터넌스·후기요청 — DB 제약이 막지만 혹시 생기면 바로
  try {
    const [{ data: sv }, { data: fu }] = await Promise.all([
      supabase.from('services').select('customer_id, service_date, service_type, customer:customers(name)'),
      supabase.from('follow_ups').select('service_id, follow_up_type').not('service_id', 'is', null).in('follow_up_type', ['QC점검', '메인터넌스', '후기요청']),
    ]);
    const seen = new Map<string, number>(); const names = new Map<string, string>();
    for (const r of sv || []) { const k = `${r.customer_id}|${r.service_date}|${r.service_type}`; seen.set(k, (seen.get(k) || 0) + 1); names.set(k, `${nameOf(r.customer)} · ${r.service_type} ${String(r.service_date).slice(5).replace('-', '.')}`); }
    const lines = Array.from(seen.entries()).filter(([, n]) => n > 1).map(([k, n]) => `${names.get(k)} 시공 기록 ${n}줄`);
    const fseen = new Map<string, number>();
    for (const r of fu || []) { const k = `${r.service_id}|${r.follow_up_type}`; fseen.set(k, (fseen.get(k) || 0) + 1); }
    const fdup = Array.from(fseen.values()).filter((n) => n > 1).length;
    if (fdup) lines.push(`사후관리 유형 중복 ${fdup}묶음`);
    if (lines.length) groups.push({ key: 'dup', label: '중복 기록', count: lines.length, lines, where: '고객 상세 → 시공 이력에서 하나 삭제 (또는 저에게)', urgent: true });
  } catch { /* 건너뜀 */ }

  // 6) 지난 QC·메인터넌스 (2026-11-23): 예정일이 3일 넘게 지났는데 방문도 안 잡히고 완료·미방문 정리도 없음
  try {
    const cutoff = addDaysISO(date, -CARE_LATE_DAYS);
    const { data } = await supabase.from('follow_ups').select('id, follow_up_type, scheduled_date, customer:customers(name)').in('follow_up_type', ['QC점검', '메인터넌스']).eq('is_completed', false).lte('scheduled_date', cutoff).order('scheduled_date', { ascending: true });
    const ids = (data || []).map((f) => f.id as string);
    let booked = new Set<string>();
    if (ids.length) {
      const { data: va } = await supabase.from('appointments').select('follow_up_id, memo').in('service_type', ['QC점검', '메인터넌스']).neq('status', '취소').neq('status', '완료');
      booked = new Set((va || []).map((a) => (a.follow_up_id as string | null) || ((a.memo as string | null) || '').match(/사후관리:([0-9a-f-]{36})/)?.[1] || '').filter(Boolean));
    }
    const lines = (data || []).filter((f) => !booked.has(f.id as string)).map((f) => `${nameOf(f.customer)} · ${f.follow_up_type === 'QC점검' ? 'QC' : '메인터넌스'} ${String(f.scheduled_date).slice(5).replace('-', '.')} 예정이었음`);
    if (lines.length) groups.push({ key: 'careLate', label: '지난 QC·메인터넌스', count: lines.length, lines, where: '사후관리 탭 → 방문 잡기 또는 안 오심', urgent: true });
  } catch { /* 건너뜀 */ }

  // 7) 고객과 안 묶인 상담 기록 (2026-11-23): 전화는 있는데 고객 없이 며칠째
  try {
    const cutoff = addDaysISO(date, -ORPHAN_DAYS);
    const { data } = await supabase.from('consultations').select('consultation_date, memo, content').is('customer_id', null).lte('consultation_date', cutoff).order('consultation_date', { ascending: false });
    const lines = (data || []).filter((c) => /01[016789][-\s]?\d{3,4}[-\s]?\d{4}/.test(`${c.memo || ''} ${c.content || ''}`))
      .map((c) => `${String(c.memo || '').split(' · ')[0].replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/, '').trim() || '전화문의'} · ${String(c.consultation_date).slice(5).replace('-', '.')} 상담`);
    if (lines.length) groups.push({ key: 'orphan', label: '고객과 안 묶인 상담', count: lines.length, lines, where: '상담 기록 탭 → ＋ 고객 목록에 추가 (예약 잡혔으면 자동)' });
  } catch { /* 건너뜀 */ }

  // 8) 메인터넌스 기간이 끝나가는 차 (2026-11-23): 시공일 + N년이 두 달 안 — 마지막 메인터넌스 때 "이번이 마지막" 안내용
  try {
    const { data } = await supabase.from('services').select('service_date, service_type, memo, customer:customers(name)').not('memo', 'is', null);
    const lines: string[] = [];
    for (const r of data || []) {
      let years = 0;
      try { const j = JSON.parse(String(r.memo)); years = Number(j.maintenance_years) || (Number((String(j.warranty?.warranty_period || '').match(/(\d+)\s*년/) || [])[1]) >= 2 ? Number((String(j.warranty?.warranty_period || '').match(/(\d+)\s*년/) || [])[1]) : 0); } catch { continue; }
      if (!years || !r.service_date) continue;
      const end = new Date(String(r.service_date) + 'T00:00:00+09:00'); end.setFullYear(end.getFullYear() + years);
      const endIso = new Date(end.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      if (endIso >= date && endIso <= addDaysISO(date, CARE_ENDING_DAYS)) lines.push(`${nameOf(r.customer)} · ${r.service_type} 메인터넌스 ${endIso.slice(5).replace('-', '.')}까지`);
    }
    if (lines.length) groups.push({ key: 'careEnding', label: '메인터넌스 기간 끝나가는 차', count: lines.length, lines, where: '마지막 메인터넌스 때 안내' });
  } catch { /* 건너뜀 */ }

  // 4) 채워야 할 고객 (2026-11-22 점검 10): 유입경로나 차종이 비어 있는 분 — 월말 유입경로 표와 차량 연결이 틀어진다
  try {
    const { data } = await supabase.from('customers').select('name, source, car_model, car_brand, memo').neq('kind', '딜러').order('created_at', { ascending: false }); // 딜러 기록은 유입경로·차종이 없는 게 정상 (2026-11-23)
    const lines = (data || [])
      .filter((c) => !isImportedCustomer(c.memo as string | null)) // 이카운트·타임트리에서 가져온 기록은 비어 있는 게 정상 (2026-11-23)
      .filter((c) => !c.source || (!c.car_model && !c.car_brand))
      .map((c) => `${c.name} · ${[!c.source ? '유입경로' : '', !c.car_model && !c.car_brand ? '차종' : ''].filter(Boolean).join('·')} 비어 있음`);
    if (lines.length) groups.push({ key: 'fill', label: '채워야 할 고객', count: lines.length, lines, where: '고객 목록 → 이름 눌러 수정' });
  } catch { /* 건너뜀 */ }

  return { date, groups, total: groups.reduce((a, g) => a + g.count, 0) };
}

/** 급한 묶음(중복·지난 QC·끝난 예약)만 — 아침 푸시에 매일 한 줄 (2026-11-23) */
export function urgentSummaryLine(r: MissedReport): string {
  const u = r.groups.filter((g) => g.urgent);
  return u.length ? `🔎 ${u.map((g) => `${g.label} ${g.count}`).join(' · ')}` : '';
}

/** 홈 줄·푸시 첫 줄 */
export function missedSummaryLine(r: MissedReport): string {
  if (r.total === 0) return '빠진 것 없습니다';
  return r.groups.map((g) => `${g.label} ${g.count}`).join(' · ');
}

/** 푸시 본문: 묶음마다 한 줄, 이름은 3명까지 */
export function missedPushBody(r: MissedReport): string {
  return r.groups.map((g) => {
    const names = g.lines.slice(0, 3).map((l) => l.split(' · ')[0]);
    return `${g.label} ${g.count}명: ${names.join(', ')}${g.count > 3 ? ' 외' : ''}`;
  }).join('\n');
}
