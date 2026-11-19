/**
 * 빠진 것 확인 (2026-11-19 사장님 "내가 널 찾지 않아도 돌아갈 수 있는 시스템" 중 하나)
 * - 작업은 끝났는데 회원 페이지 링크를 안 보낸 분 (최근 30일 시공)
 * - 날짜가 지났는데 시공중·예약확정 그대로 멈춘 예약 (7일 넘음)
 * - 후기 요청 문자를 보냈는데 2주 넘게 답(완료 표시) 없는 분
 * 홈 "마케팅팀 오늘 한 일"에는 매일 보이고, 푸시는 금요일 07시에만 간다. Claude 호출 없음.
 */
import { supabase } from './supabase';
import { todaySeoul, addDaysISO } from './local-date';

export interface MissedGroup {
  key: 'link' | 'stuck' | 'review';
  label: string;
  count: number;
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
const STUCK_DAYS = 7;
const REVIEW_DAYS = 14;

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
    if (lines.length) groups.push({ key: 'stuck', label: '날짜 지났는데 멈춘 예약', count: lines.length, lines, where: '예약/일정 탭 → 완료 또는 취소' });
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

  return { date, groups, total: groups.reduce((a, g) => a + g.count, 0) };
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
