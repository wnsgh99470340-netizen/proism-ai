/**
 * 마케팅팀 하루 브리핑 (2026-11-12)
 * - buildDailyBrief: 오늘 기준으로 각 직원이 "준비한 것"을 계산한다 (DB 조회, Claude 호출 없음)
 *   · 사후관리 담당: 오늘·14일 안에 밀린 QC·메인터넌스·후기요청 → 고객별 문자
 *   · 상담 담당: 견적재연락(D+1)·견적마무리(D+3) → 등록 때 저장된 문자
 *   · 시공기 작가: 오늘 완성·진행 중인 글
 * - 매일 07:00 크론(/api/cron/daily)이 이걸 만들어 Blob team/날짜.json 에 남기고 푸시를 보낸다
 * - 홈 "마케팅팀 오늘 한 일"은 /api/team/today 로 실시간 계산본을 본다 (보냈는지는 DB 가 기준)
 */
import { list, put } from '@vercel/blob';
import { supabase } from './supabase';
import { listJobs } from './jobs';
import { followUpMessage, followUpSmsKey, followUpLabel } from '@/config/sms-templates';
import { TEAM, type WorkerKey } from '@/config/ai-team';
import { todaySeoul, addDaysISO, toSeoulISO } from './local-date';
import { buildWeeklyStats, weeklySummaryLine, type WeeklyStats } from './weekly-stats';
import { buildMissedReport, missedSummaryLine, type MissedReport } from './checkups';

export interface TeamItem {
  followUpId: string;
  type: string;
  label: string;
  name: string;
  phone: string;
  car: string;
  scheduledDate: string;
  /** 0 = 오늘, 양수 = 며칠 지남 */
  overdueDays: number;
  message: string;
  smsKey: string;
  sent: boolean;
}

export interface WorkerLine {
  key: WorkerKey;
  name: string;
  time: string;
  status: 'ready' | 'done' | 'idle' | 'prepared';
  summary: string;
  items?: TeamItem[];
  /** 더 오래 밀린 건수 (14일 넘음) */
  olderCount?: number;
  waitingFor?: string;
  /** 문자 없이 보여 주기만 하는 줄 (빠진 것 확인, 2026-11-19) */
  notes?: { label: string; where: string; lines: string[] }[];
}

export interface DailyBrief {
  date: string;
  generatedAt: string;
  lines: WorkerLine[];
  totals: { toSend: number; sent: number };
  /** 월요일에만: 지난주(월~일) 숫자 한 묶음 (2026-11-18 주간 집계) */
  weekly?: WeeklyStats;
  weeklyLine?: string;
  /** 빠진 것 확인 (매일 계산, 푸시는 금요일) 2026-11-19 */
  missed?: MissedReport;
}

const OVERDUE_WINDOW_DAYS = 14;

interface FollowUpRow {
  id: string;
  customer_id: string | null;
  follow_up_type: string;
  scheduled_date: string;
  is_completed: boolean;
  memo: string | null;
  sms_sent: Record<string, boolean> | null;
  customer: { name: string; phone: string | null } | null;
  service: { service_type: string } | null;
}

const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00+09:00').getTime() - new Date(a + 'T00:00:00+09:00').getTime()) / 86400000);

function toItem(f: FollowUpRow, today: string): TeamItem | null {
  const head = (f.memo || '').split('\n')[0];
  const headPhone = head.match(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/)?.[0] || '';
  const toDealer = f.follow_up_type === '입고안내' && /\(딜러\)/.test(head); // 딜러가 넣어 준 차의 입고 안내는 딜러 번호로 (2026-11-23)
  const phone = (toDealer ? headPhone : '') || f.customer?.phone || headPhone;
  if (!phone) return null;
  const name = toDealer ? `${head.split(' ')[0].replace('(딜러)', '')} 딜러 (${f.customer?.name || '고객'})` : f.customer?.name || head.split(' ')[0] || '고객';
  const car = (head.includes('·') ? head.split('·')[1].trim() : '') || f.service?.service_type || '';
  const key = followUpSmsKey(f.follow_up_type);
  return {
    followUpId: f.id,
    type: f.follow_up_type,
    label: followUpLabel(f.follow_up_type),
    name, phone, car,
    scheduledDate: f.scheduled_date,
    overdueDays: Math.max(0, daysBetween(f.scheduled_date, today)),
    message: followUpMessage(f.follow_up_type, f.memo),
    smsKey: key,
    sent: Boolean(f.sms_sent?.[key]),
  };
}

export async function buildDailyBrief(date = todaySeoul()): Promise<DailyBrief> {
  const since = addDaysISO(date, -OVERDUE_WINDOW_DAYS);
  const { data, error } = await supabase
    .from('follow_ups')
    .select('id, customer_id, follow_up_type, scheduled_date, is_completed, memo, sms_sent, customer:customers(name, phone), service:services(service_type)')
    .eq('is_completed', false)
    .lte('scheduled_date', date)
    .order('scheduled_date', { ascending: false });
  if (error) throw new Error(`사후관리 조회 실패: ${error.message}`);
  const rows0 = (data || []) as unknown as FollowUpRow[];

  // 방문 예약이 잡힌 QC·메인터넌스(2026-11-22 방문 예약 흐름)는 "문자 보낼 것"이 아니라 "오늘 방문"이다 — 이미 오기로 한 손님에게 "QC 시기가 되어 연락드립니다"가 나가면 안 된다
  const visitByFollowUp = new Map<string, { date: string; memo: string }>();
  {
    let va = (await supabase.from('appointments').select('id, appointment_date, status, follow_up_id, memo').in('service_type', ['QC점검', '메인터넌스']).in('status', ['예약확정', '시공중', '상담중'])).data as { appointment_date: string; follow_up_id?: string | null; memo: string | null }[] | null;
    if (!va) va = (await supabase.from('appointments').select('id, appointment_date, status, memo').in('service_type', ['QC점검', '메인터넌스']).in('status', ['예약확정', '시공중', '상담중'])).data as typeof va;
    for (const a of va || []) {
      const fid = a.follow_up_id || (a.memo || '').match(/사후관리:([0-9a-f-]{36})/)?.[1];
      if (fid) visitByFollowUp.set(fid, { date: a.appointment_date, memo: (a.memo || '').replace(/ · 사후관리:[0-9a-f-]{36}/, '') });
    }
  }
  const visitsToday = rows0.filter(r => visitByFollowUp.get(r.id)?.date === date);
  const rows = rows0.filter(r => !visitByFollowUp.has(r.id));

  const isConsult = (t: string) => t === '견적재연락' || t === '견적마무리';
  const recent = rows.filter(r => r.scheduled_date >= since);
  const older = rows.filter(r => r.scheduled_date < since);

  const aftercareItems = recent.filter(r => !isConsult(r.follow_up_type)).map(r => toItem(r, date)).filter((x): x is TeamItem => Boolean(x));
  const consultItems = recent.filter(r => isConsult(r.follow_up_type)).map(r => toItem(r, date)).filter((x): x is TeamItem => Boolean(x));

  const countBy = (items: TeamItem[]) => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.label, (m.get(it.label) || 0) + 1);
    return Array.from(m.entries()).map(([k, v]) => `${k} ${v}`).join(' · ');
  };
  const unsent = (items: TeamItem[]) => items.filter(i => !i.sent);

  const lines: WorkerLine[] = [];
  const w = (k: WorkerKey) => TEAM.find(t => t.key === k)!;

  {
    const u = unsent(aftercareItems);
    lines.push({
      key: 'aftercare', name: w('aftercare').name, time: '07:00',
      status: aftercareItems.length === 0 ? 'idle' : u.length === 0 ? 'done' : 'ready',
      summary: aftercareItems.length === 0
        ? '오늘 보낼 사후관리 문자가 없습니다'
        : u.length === 0
          ? `오늘 문자 ${aftercareItems.length}건 모두 보냈습니다`
          : `오늘 보낼 문자 ${u.length}건 준비 (${countBy(u)})`,
      items: aftercareItems,
      olderCount: older.filter(r => !isConsult(r.follow_up_type)).length,
      notes: visitsToday.length ? [{ label: `오늘 방문 ${visitsToday.length}건`, where: '예약/일정 → 점검 완료', lines: visitsToday.map(r => `${r.customer?.name || '고객'} · ${followUpLabel(r.follow_up_type)}${visitByFollowUp.get(r.id)?.memo ? ` · ${visitByFollowUp.get(r.id)!.memo}` : ''}`) }] : undefined,
    });
  }
  {
    const u = unsent(consultItems);
    lines.push({
      key: 'consult', name: w('consult').name, time: '07:00',
      status: consultItems.length === 0 ? 'idle' : u.length === 0 ? 'done' : 'ready',
      summary: consultItems.length === 0
        ? '오늘 재연락할 견적 문의가 없습니다'
        : u.length === 0
          ? `견적 재연락 ${consultItems.length}건 모두 보냈습니다`
          : `견적 재연락 ${u.length}건 준비 (${countBy(u)})`,
      items: consultItems,
      olderCount: older.filter(r => isConsult(r.follow_up_type)).length,
    });
  }
  // 시공기 작가: 오늘 완성·진행 중
  try {
    const jobs = await listJobs(30);
    const doneToday = jobs.filter(j => j.status === 'done' && toSeoulISO(new Date(j.updated_at)) === date);
    const running = jobs.filter(j => ['queued', 'researching', 'facts', 'confirming', 'writing', 'channels'].includes(j.status));
    const titles = doneToday.map(j => j.result?.draft?.title).filter(Boolean).slice(0, 3).join(' / ');
    lines.push({
      key: 'writer', name: w('writer').name, time: '요청 시',
      status: running.length > 0 ? 'ready' : doneToday.length > 0 ? 'done' : 'idle',
      summary: running.length > 0
        ? `${running.length}편 쓰는 중${doneToday.length ? ` · 오늘 ${doneToday.length}편 완성` : ''}`
        : doneToday.length > 0 ? `오늘 ${doneToday.length}편 완성: ${titles}` : '오늘 요청된 시공기가 없습니다',
    });
  } catch {
    lines.push({ key: 'writer', name: w('writer').name, time: '요청 시', status: 'idle', summary: '작업 목록을 읽지 못했습니다' });
  }
  // 빠진 것 확인 (2026-11-19): 홈에는 매일 계산해 보이고, 푸시는 금요일에만 (크론이 missed 를 보고 보낸다)
  let missed: MissedReport | undefined;
  try {
    missed = await buildMissedReport(date);
    lines.push({
      key: 'checkup', name: w('checkup').name, time: '매주 금',
      status: missed.total === 0 ? 'done' : 'ready',
      summary: missedSummaryLine(missed),
      notes: missed.groups.map(g => ({ label: `${g.label} ${g.count}`, where: g.where, lines: g.lines })),
    });
  } catch {
    lines.push({ key: 'checkup', name: w('checkup').name, time: '매주 금', status: 'idle', summary: '확인하지 못했습니다' });
  }
  for (const t of TEAM.filter(t => t.status === 'prepared')) {
    lines.push({ key: t.key, name: t.name, time: t.time, status: 'prepared', summary: t.role, waitingFor: t.waitingFor });
  }

  // 월요일 아침이면 지난주(월~일) 숫자를 같이 준비한다 (실장님 주간 미팅 표의 서초 칸)
  let weekly: WeeklyStats | undefined;
  let weeklyLine: string | undefined;
  if (new Date(`${date}T12:00:00+09:00`).getUTCDay() === 1) {
    try {
      weekly = await buildWeeklyStats(addDaysISO(date, -1), 7);
      weeklyLine = weeklySummaryLine(weekly);
    } catch { /* 집계 실패해도 브리핑은 나간다 */ }
  }

  const all = [...aftercareItems, ...consultItems];
  return {
    date,
    generatedAt: new Date().toISOString(),
    lines,
    totals: { toSend: all.filter(i => !i.sent).length, sent: all.filter(i => i.sent).length },
    weekly,
    weeklyLine,
    missed,
  };
}

/** 크론이 남기는 기록 (문자 본문은 빼고) */
export async function saveTeamLog(brief: DailyBrief): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const slim = { ...brief, lines: brief.lines.map(l => ({ ...l, items: l.items?.map(({ message: _m, ...rest }) => rest) })) };
  const b = await put(`team/${brief.date}.json`, JSON.stringify(slim), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
  return b.url;
}

export async function listTeamLogs(limit = 7): Promise<{ date: string; url: string }[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  const { blobs } = await list({ prefix: 'team/', limit: 60 });
  return blobs
    .map(b => ({ date: b.pathname.replace(/^team\//, '').replace(/\.json$/, ''), url: b.url }))
    .filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}
