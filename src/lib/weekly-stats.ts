/**
 * 주간 숫자·유입경로 표 (2026-11-18)
 *
 * 사장님이 구글 시트 "유입경로 분석"에 날짜×경로(카페·블로그·소개/재방문·유튜브·고정·경로X·기타)로 손으로 1씩 적던 집계와,
 * 실장님 주간 미팅 표의 서초 칸(발행 수·상담·후기)을 CRM 기록으로 자동 계산한다. Claude 호출 없음.
 *
 * - buildWeeklyStats(to, days): 지난 N일(기본 7일) 숫자 — 블로그 발행(네이버 목록 실시간, 실패 시 글 DB)·생성, 상담 기록·견적 문자·문의 답변,
 *   새 고객·유입경로 분포, 후기 요청→받음, QC·메인터넌스 완료, 입고
 * - buildSourceTable(month): 그 달의 날짜×유입경로 표(합계·비율) — 시트와 같은 모양, TSV 복사용
 * - 홈 "이번 주 숫자" 카드(/api/stats)와 월요일 브리핑(team.ts)이 쓴다
 */
import { supabase } from './supabase';
import { listJobs } from './jobs';
import { fetchOwnerPostList } from './blog-import';
import { todaySeoul, addDaysISO, toSeoulISO } from './local-date';

/** CRM 고객 등록의 유입경로 선택지와 같은 순서 (시트 열 순서도 동일) */
export const SOURCE_LABELS = ['카페', '블로그', '소개/재방문', '유튜브', '고정', '경로X', '기타'] as const;

export interface WeeklyStats {
  from: string;
  to: string;
  /** 네이버 블로그 발행 수 (roice_ 목록 기준) */
  blogPublished: number;
  blogPublishedTitles: string[];
  /** 이 시스템이 완성한 시공기 수 */
  blogGenerated: number;
  consultations: number;
  quoteSms: number;
  inquiryReplies: number;
  newCustomers: number;
  sources: { label: string; count: number }[];
  /** 후기 요청 문자를 보낸 건(예정일이 기간 안) */
  reviewRequested: number;
  /** 후기 받음 처리된 건(완료일이 기간 안) */
  reviewReceived: number;
  qcDone: number;
  maintenanceDone: number;
  /** 기간 안에 시작한 예약(입고) */
  appointments: number;
  /** 읽기 실패한 항목 이름 */
  errors: string[];
}

export interface SourceTable {
  month: string;              // YYYY-MM
  labels: string[];
  rows: { day: number; counts: number[]; total: number }[];
  totals: number[];
  total: number;
  ratios: number[];           // 0~100 (소수 1자리)
  /** 유입경로가 비어 있어 "기타"로 센 고객 수 */
  blankSource: number;
}

const seoulRange = (from: string, to: string) => ({ start: `${from}T00:00:00+09:00`, end: `${to}T23:59:59.999+09:00` });

function sourceIndex(src: string | null | undefined): number {
  const s = (src || '').trim();
  const i = (SOURCE_LABELS as readonly string[]).indexOf(s);
  if (i >= 0) return i;
  if (/소개|재방문|지인/.test(s)) return 2;
  if (/카페/.test(s)) return 0;
  if (/블로그/.test(s)) return 1;
  if (/유튜브|youtube/i.test(s)) return 3;
  if (/고정/.test(s)) return 4;
  return 6;
}

export async function buildWeeklyStats(to = todaySeoul(), days = 7): Promise<WeeklyStats> {
  const from = addDaysISO(to, -(days - 1));
  const { start, end } = seoulRange(from, to);
  const errors: string[] = [];
  const inRange = (d: string | null | undefined) => !!d && d >= from && d <= to;

  // 블로그 발행: 네이버 목록 1페이지(30편)로 충분. 실패하면 글 DB(owner, created_at=발행일)
  let blogPublished = 0;
  let blogPublishedTitles: string[] = [];
  try {
    const posts = await fetchOwnerPostList(1);
    const hits = posts.filter(p => inRange(toSeoulISO(new Date(p.pubDate))));
    blogPublished = hits.length;
    blogPublishedTitles = hits.map(p => p.title).slice(0, 5);
  } catch {
    try {
      const { data } = await supabase.from('blog_posts').select('title, created_at').eq('kind', 'owner').gte('created_at', start).lte('created_at', end);
      blogPublished = data?.length || 0;
      blogPublishedTitles = (data || []).map(r => r.title as string).slice(0, 5);
    } catch { errors.push('블로그 발행'); }
  }

  let blogGenerated = 0;
  try {
    const jobs = await listJobs(60);
    blogGenerated = jobs.filter(j => j.status === 'done' && inRange(toSeoulISO(new Date(j.updated_at)))).length;
  } catch { errors.push('시공기 생성'); }

  let consultations = 0, quoteSms = 0, inquiryReplies = 0;
  try {
    const { data, error } = await supabase.from('consultations').select('content, consultation_date').gte('consultation_date', from).lte('consultation_date', to);
    if (error) throw error;
    for (const r of data || []) {
      const c = (r.content as string) || '';
      if (c.startsWith('[견적 문자 발송]')) quoteSms++;
      else if (c.startsWith('[문의 답변]')) inquiryReplies++;
      else consultations++;
    }
  } catch { errors.push('상담 기록'); }

  let newCustomers = 0;
  const sourceCounts = SOURCE_LABELS.map(() => 0);
  try {
    const { data, error } = await supabase.from('customers').select('source, created_at').gte('created_at', start).lte('created_at', end);
    if (error) throw error;
    newCustomers = data?.length || 0;
    for (const r of data || []) sourceCounts[sourceIndex(r.source as string | null)]++;
  } catch { errors.push('고객'); }

  let reviewRequested = 0, reviewReceived = 0, qcDone = 0, maintenanceDone = 0;
  try {
    const { data, error } = await supabase
      .from('follow_ups')
      .select('follow_up_type, scheduled_date, is_completed, completed_date, sms_sent, memo')
      .or(`and(scheduled_date.gte.${from},scheduled_date.lte.${to}),and(completed_date.gte.${from},completed_date.lte.${to})`);
    if (error) throw error;
    for (const r of data || []) {
      const t = r.follow_up_type as string;
      const sent = Object.values((r.sms_sent as Record<string, boolean> | null) || {}).some(Boolean);
      // 일괄 정리된 건은 실제 점검·후기가 아니므로 완료 수에 넣지 않는다 (2026-11-19):
      // memo 에 "기한 지나 정리"가 있거나, 예정일보다 60일 넘게 지나 완료 처리된 것(11-11 에 3~5월 후기요청 10건을 한 번에 닫은 일)
      const sched = r.scheduled_date as string, comp = r.completed_date as string | null;
      const lateDays = comp ? Math.round((new Date(comp).getTime() - new Date(sched).getTime()) / 86400000) : 0;
      const bulkClosed = /기한 지나 정리/.test((r.memo as string | null) || '') || lateDays > 60;
      const doneIn = inRange(comp) && !bulkClosed;
      if (t === '후기요청') {
        if (sent && inRange(r.scheduled_date as string)) reviewRequested++;
        if (doneIn && (r.is_completed as boolean)) reviewReceived++;
      } else if (t === 'QC점검' && doneIn) qcDone++;
      else if (t === '메인터넌스' && doneIn) maintenanceDone++;
    }
  } catch { errors.push('사후관리'); }

  let appointments = 0;
  try {
    const { data, error } = await supabase.from('appointments').select('appointment_date, status').gte('appointment_date', from).lte('appointment_date', to);
    if (error) throw error;
    appointments = (data || []).filter(r => r.status !== '취소').length;
  } catch { errors.push('예약'); }

  return {
    from, to, blogPublished, blogPublishedTitles, blogGenerated, consultations, quoteSms, inquiryReplies, newCustomers,
    sources: SOURCE_LABELS.map((label, i) => ({ label, count: sourceCounts[i] })).filter(s => s.count > 0),
    reviewRequested, reviewReceived, qcDone, maintenanceDone, appointments, errors,
  };
}

/** 그 달의 날짜×유입경로 표 (고객 등록일 기준) */
export async function buildSourceTable(month = todaySeoul().slice(0, 7)): Promise<SourceTable> {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const from = `${month}-01`;
  const to = `${month}-${String(daysInMonth).padStart(2, '0')}`;
  const { start, end } = seoulRange(from, to);
  const rows = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, counts: SOURCE_LABELS.map(() => 0), total: 0 }));
  let blankSource = 0;
  const { data, error } = await supabase.from('customers').select('source, created_at').gte('created_at', start).lte('created_at', end);
  if (error) throw new Error(`고객 조회 실패: ${error.message}`);
  for (const r of data || []) {
    const day = Number(toSeoulISO(new Date(r.created_at as string)).slice(8, 10));
    const row = rows[day - 1];
    if (!row) continue;
    const idx = sourceIndex(r.source as string | null);
    if (!(r.source as string | null)?.trim()) blankSource++;
    row.counts[idx]++;
    row.total++;
  }
  const totals = SOURCE_LABELS.map((_, i) => rows.reduce((a, r) => a + r.counts[i], 0));
  const total = totals.reduce((a, b) => a + b, 0);
  const ratios = totals.map(t => total ? Math.round((t / total) * 1000) / 10 : 0);
  return { month, labels: [...SOURCE_LABELS], rows, totals, total, ratios, blankSource };
}

/** 시트에 그대로 붙일 수 있는 탭 구분 텍스트 (제목 줄 + 머리글 + 31일 + 합계 + 비율) */
export function sourceTableTsv(t: SourceTable): string {
  const [y, m] = t.month.split('-');
  // 시트 모양(2026-11-18 사장님): 위에 합계·머리글·비율 블록, 아래에 일별 표
  const lines = [
    `${Number(m)}월 유입경로 분석 (${y})`,
    ['합계', ...t.totals.map(String), String(t.total)].join('\t'),
    ['', ...t.labels, '합계'].join('\t'),
    ['비율', ...t.ratios.map(r => `${r.toFixed(2)}%`), ''].join('\t'),
    '',
    ['일', ...t.labels, '합계'].join('\t'),
    ...t.rows.map(r => [String(r.day), ...r.counts.map(c => (c ? String(c) : '')), String(r.total)].join('\t')),
  ];
  return lines.join('\n');
}

/** 브리핑·푸시용 한 줄 */
export function weeklySummaryLine(w: WeeklyStats): string {
  const parts = [
    `발행 ${w.blogPublished}`,
    `상담 ${w.consultations}`,
    `견적 문자 ${w.quoteSms}`,
    `문의 답변 ${w.inquiryReplies}`,
    `새 고객 ${w.newCustomers}`,
    `후기 ${w.reviewReceived}/${w.reviewRequested}`,
    `QC ${w.qcDone} · 메인터넌스 ${w.maintenanceDone}`,
  ];
  return `지난주(${w.from.slice(5).replace('-', '.')}~${w.to.slice(5).replace('-', '.')}) ${parts.join(' · ')}`;
}

/** 지난달 전체 숫자 + 유입경로 표 (매달 1일 07시 크론, 2026-11-19). 홈 카드의 ‹ 로 보는 것과 같은 계산 */
export interface MonthlyReport { month: string; stats: WeeklyStats; table: SourceTable; tsv: string; builtAt: string }

export async function buildMonthlyReport(month: string): Promise<MonthlyReport> {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const last = `${month}-${String(daysInMonth).padStart(2, '0')}`;
  const [stats, table] = await Promise.all([buildWeeklyStats(last, daysInMonth), buildSourceTable(month)]);
  return { month, stats, table, tsv: sourceTableTsv(table), builtAt: new Date().toISOString() };
}

/** 푸시 본문: 두 줄 (숫자 한 줄 + 유입경로 상위 3개) */
export function monthlySummaryLines(r: MonthlyReport): string[] {
  const w = r.stats;
  const top = r.table.labels.map((l, i) => ({ l, n: r.table.totals[i] })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3).map((x) => `${x.l} ${x.n}`).join(' · ');
  return [
    `발행 ${w.blogPublished} · 상담 ${w.consultations} · 견적 문자 ${w.quoteSms} · 새 고객 ${w.newCustomers} · 입고 ${w.appointments} · 후기 ${w.reviewReceived}/${w.reviewRequested}`,
    top ? `유입경로: ${top} (합계 ${r.table.total})` : '유입경로: 새 고객 없음',
  ];
}
