'use client';

/** 홈 탭 (2026-11-23 page.tsx 에서 분리 — 동작 변경 없음). 상태·핸들러는 page.tsx 에 있고 props 로 받는다 */
import Btn from '@/components/ui/Btn';
import type { Dispatch, SetStateAction } from 'react';
import { addDaysISO } from '@/lib/local-date';
import { quoteForDate } from '@/config/daily-quotes';
import type { DailyBrief, TeamItem, WorkerLine } from '@/lib/team';
import type { WeeklyStats, SourceTable } from '@/lib/weekly-stats';
import SourceChart from '@/components/crm/SourceChart';
import type { QuoteSmsInitial } from '@/components/crm/QuoteSmsModal';
import { overdueAppointments } from '@/lib/appointments-flow';
import { type Appointment, type FollowUp, type Tab, CARE_VISIT_TYPES, RETOUCH_TYPE, HOME_BANNER_IMAGE, statusColor } from '@/lib/crm-shared';

interface HomeTabProps {
  today: string;
  isDemo: boolean;
  appointments: Appointment[];
  followUps: FollowUp[];
  allCustomers: { id: string }[];
  teamBrief: DailyBrief | null;
  teamOpen: string | null;
  setTeamOpen: (key: string | null) => void;
  fetchTeamBrief: () => void;
  stats: { weekly: WeeklyStats; table: SourceTable } | null;
  statsMonth: string;
  setStatsMonth: (month: string) => void;
  fetchStats: (month: string) => void;
  statsDays: boolean;
  setStatsDays: Dispatch<SetStateAction<boolean>>;
  handleStatusChange: (appointment: Appointment, newStatus: string) => void;
  openDateEdit: (appointment: Appointment) => void;
  handleTeamSms: (item: TeamItem) => void;
  setShowAddCustomer: (v: boolean) => void;
  setShowAddAppointment: (v: boolean) => void;
  setQuoteSms: (v: QuoteSmsInitial | null) => void;
  setShowInquiry: (v: boolean) => void;
  setActiveTab: (tab: Tab) => void;
}

export default function HomeTab({
  today, isDemo, appointments, followUps, allCustomers,
  teamBrief, teamOpen, setTeamOpen, fetchTeamBrief,
  stats, statsMonth, setStatsMonth, fetchStats, statsDays, setStatsDays,
  handleStatusChange, openDateEdit, handleTeamSms,
  setShowAddCustomer, setShowAddAppointment, setQuoteSms, setShowInquiry, setActiveTab,
}: HomeTabProps) {
  const fmtDot = (d: string) => d.replace(/-/g, '.');
  const plus = (n: number) => addDaysISO(today, n);
  const todayAppts = appointments.filter((a) => a.appointment_date <= today && (a.end_date || a.appointment_date) >= today && a.status !== '취소');
  const overdueAppts = overdueAppointments(appointments, today); // 끝난 날이 지났는데 완료 안 된 예약 (2026-11-22 점검 3-3)
  const weekAppts = appointments.filter((a) => a.appointment_date > today && a.appointment_date <= plus(7) && a.status !== '취소').slice(0, 5);
  const pendingCount = followUps.filter((f) => !f.is_completed).length;
  const upcoming3 = followUps.filter((f) => !f.is_completed && f.scheduled_date > today && f.scheduled_date <= plus(3)).length;
  const statusDot = (st: WorkerLine['status']) => st === 'ready' ? 'bg-brand' : st === 'done' ? 'bg-ok' : st === 'prepared' ? 'bg-[var(--c-border)]' : 'bg-[var(--c-text-4)]';
  const quick: { icon: string; label: string; desc: string; onClick: () => void }[] = [
    { icon: '👤', label: '고객 등록', desc: '새 고객 추가', onClick: () => setShowAddCustomer(true) },
    { icon: '📅', label: '예약 등록', desc: '입고 일정 잡기', onClick: () => setShowAddAppointment(true) },
    { icon: '📩', label: '견적 문자', desc: '통화 직후 견적 보내기', onClick: () => setQuoteSms({}) },
    { icon: '💬', label: '문의 답변', desc: '카페·문자 문의 답장 만들기', onClick: () => setShowInquiry(true) },
    ...(isDemo ? [] : [{ icon: '✍️', label: '시공기 쓰기', desc: '블로그 탭에서 작성', onClick: () => setActiveTab('blog') }]),
  ];
  const card = 'bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl';
  const quote = quoteForDate(today);
  return (
    <div className="space-y-6 md:space-y-8">
      {/* 홈 상단: 배너 사진이 있으면 사진 위에 인사말, 없으면 글자만 (2026-11-11 사장님: 배너용 사진 나중에 보내줌 → HOME_BANNER_IMAGE 에 경로만 넣으면 됨) */}
      {HOME_BANNER_IMAGE ? (
        <div className="relative rounded-2xl overflow-hidden border border-[var(--c-border)] min-h-[200px] md:min-h-[240px] flex items-end">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HOME_BANNER_IMAGE} alt="3M 프로이즘 강남서초점" className="absolute inset-0 w-full h-full object-cover object-[center_35%]" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/35 to-black/5" />
          <div className="relative p-6 md:p-8 text-white">
            <div className="text-xs md:text-sm font-semibold tracking-wide text-white/80 mb-1">3M PROIZM · 강남 서초점</div>
            <h1 className="text-2xl md:text-[30px] font-bold tracking-tight drop-shadow">안녕하세요, 강남 서초점 👋</h1>
            <p className="text-sm md:text-[15px] text-white/85 mt-2">
              오늘은 {fmtDot(today)} · 등록 고객 {allCustomers.length}명 · 미처리 사후관리 <span className={pendingCount > 0 ? 'text-white font-bold underline decoration-brand decoration-2 underline-offset-4' : ''}>{pendingCount}건</span>
            </p>
            <div className="mt-5 max-w-2xl">
              {quote.head && <div className="text-xs font-bold tracking-wide text-white/70 mb-1.5">{quote.head}</div>}
              {quote.lines.map((l, i) => <p key={i} className="text-base md:text-lg text-white/90 leading-snug">{l}</p>)}
              <p className="text-lg md:text-[22px] font-bold leading-snug text-white mt-1.5 drop-shadow">{quote.key}</p>
              {quote.by && <div className="text-sm text-white/60 mt-1.5">— {quote.by}</div>}
            </div>
          </div>
        </div>
      ) : (
        <div>
          <h1 className="text-2xl md:text-[28px] font-bold text-[var(--c-text-1)] tracking-tight">안녕하세요, 강남 서초점 👋</h1>
          <p className="text-sm md:text-[15px] text-[var(--c-text-3)] mt-1.5">
            오늘은 {fmtDot(today)} · 등록 고객 {allCustomers.length}명 · 미처리 사후관리 <span className={pendingCount > 0 ? 'text-brand font-semibold' : ''}>{pendingCount}건</span>
          </p>
          <div className="mt-5 rounded-2xl border border-[var(--c-border)] bg-[var(--c-card)] px-5 md:px-7 py-5 md:py-6 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-brand" />
            <div className="text-[11px] font-bold tracking-widest text-[var(--c-text-3)] mb-2.5">오늘의 한 줄{quote.head ? ` · ${quote.head}` : ''}</div>
            <div className="max-w-3xl">
              {quote.lines.map((l, i) => <p key={i} className="text-[17px] md:text-xl font-medium leading-snug text-[var(--c-text-2)]">{l}</p>)}
              <p className="text-xl md:text-[26px] font-bold leading-snug tracking-tight text-brand mt-2">{quote.key}</p>
            </div>
            {quote.by && <div className="text-sm text-[var(--c-text-3)] mt-2.5">— {quote.by}</div>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
        {quick.map((q) => (
          <button key={q.label} onClick={q.onClick} className={`${card} py-6 md:py-8 px-4 flex flex-col items-center gap-2 hover:border-[var(--c-text-1)] hover:shadow-sm transition-all group`}>
            <span className="text-3xl md:text-[34px] leading-none">{q.icon}</span>
            <span className="font-bold text-[15px] text-[var(--c-text-1)] mt-1">{q.label}</span>
            <span className="text-xs text-[var(--c-text-3)]">{q.desc}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5 items-start min-w-0 [&>section]:min-w-0 [&>section]:overflow-hidden">
        {/* 오늘 예약 */}
        <section className={`${card} p-5 md:p-6`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-[var(--c-text-1)]">오늘 예약 <span className="text-[var(--c-text-3)] text-sm font-medium ml-1">{todayAppts.length}건</span></h2>
            <button onClick={() => setActiveTab('appointments')} className="text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-1)] transition-colors">전체 보기 →</button>
          </div>
          {overdueAppts.length > 0 && (
            <div className="mb-4 rounded-xl border border-warn/40 bg-warn/5 p-3">
              <div className="text-xs font-semibold text-warn mb-2">완료 처리할 예약 {overdueAppts.length}건 — 끝난 날이 지났는데 아직 {overdueAppts.some((a) => a.status === '시공중') ? '시공중·' : ''}예약확정입니다</div>
              <ul className="space-y-1.5">
                {overdueAppts.slice(0, 5).map((a) => (
                  <li key={a.id} className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="font-medium text-[var(--c-text-1)]">{a.customer?.name || '(삭제된 고객)'}</span>
                    <span className="text-xs text-[var(--c-text-3)]">{a.service_type || '시공 미정'} · {a.appointment_date.slice(5).replace('-', '/')}{a.end_date && a.end_date !== a.appointment_date ? `~${a.end_date.slice(5).replace('-', '/')}` : ''}</span>
                    <span className="ml-auto flex items-center gap-1">
                      <button onClick={() => handleStatusChange(a, '완료')} className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-ok text-white">{CARE_VISIT_TYPES.includes(a.service_type || '') ? '점검 완료' : a.service_type === RETOUCH_TYPE ? '리터치 완료' : '완료 처리'}</button>
                      <button onClick={() => openDateEdit(a)} className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-[var(--c-border)] text-[var(--c-text-2)]">날짜</button>
                      <button onClick={() => { if (confirm(`${a.customer?.name || '이'} 예약을 취소로 바꿀까요?`)) handleStatusChange(a, '취소'); }} className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-[var(--c-border)] text-[var(--c-text-3)]">취소</button>
                    </span>
                  </li>
                ))}
              </ul>
              {overdueAppts.length > 5 && <div className="text-[11px] text-[var(--c-text-3)] mt-2">외 {overdueAppts.length - 5}건은 예약/일정 탭에서</div>}
            </div>
          )}
          {todayAppts.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--c-text-3)]">오늘 예약이 없습니다.</div>
          ) : (
            <ul className="divide-y divide-[var(--c-border)]">
              {todayAppts.map((a) => (
                <li key={a.id} className="py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-[15px] text-[var(--c-text-1)] truncate">{a.customer?.name || '(삭제된 고객)'} <span className="text-[var(--c-text-3)] text-sm font-normal ml-1">{a.customer?.phone || ''}</span></div>
                    <div className="text-sm text-[var(--c-text-3)] mt-0.5">{a.service_type || '시공 미정'}{a.end_date && a.end_date !== a.appointment_date ? ` · ~${fmtDot(a.end_date).slice(5)}` : ''}{a.amount ? ` · ${a.amount.toLocaleString()}원` : ''}</div>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${statusColor(a.status)}`}>{a.status}</span>
                </li>
              ))}
            </ul>
          )}
          {weekAppts.length > 0 && (
            <div className="mt-4 pt-4 border-t border-[var(--c-border)]">
              <div className="text-xs font-semibold text-[var(--c-text-3)] mb-2">다가오는 7일</div>
              <ul className="space-y-1.5">
                {weekAppts.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 text-sm">
                    <span className="text-brand font-bold tabular-nums w-14 shrink-0">{fmtDot(a.appointment_date).slice(5)}</span>
                    <span className="font-medium text-[var(--c-text-1)] truncate">{a.customer?.name || '-'}</span>
                    <span className="text-[var(--c-text-3)] truncate">{a.service_type || ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* 마케팅팀 오늘 한 일 (2026-11-12 마케팅팀 1주차: 사후관리·상담 담당이 07시에 준비, 사장님은 건마다 보내기) */}
        <section className={`${card} p-5 md:p-6`}>
          <div className="flex items-center justify-between mb-4 gap-3">
            <h2 className="text-lg font-bold text-[var(--c-text-1)]">마케팅팀 오늘 한 일 <span className="text-[var(--c-text-3)] text-sm font-medium ml-1">{fmtDot(today).slice(5)}</span></h2>
            <div className="flex items-center gap-2 shrink-0">
              {teamBrief && teamBrief.totals.toSend > 0 && <span className="text-xs font-semibold text-brand">보낼 문자 {teamBrief.totals.toSend}건</span>}
              <Btn size="sm" variant="ghost" icon="refresh" onClick={fetchTeamBrief}>새로고침</Btn>
            </div>
          </div>
          {!teamBrief ? (
            <div className="py-10 text-center text-sm text-[var(--c-text-3)]">{isDemo ? "둘러보기에서는 비어 있습니다" : "마케팅팀이 준비한 일을 읽는 중…"}</div>
          ) : (
            <ul className="divide-y divide-[var(--c-border)]">
              {teamBrief.lines.map((l) => {
                const hasNotes = (l.notes?.length ?? 0) > 0;
                const open = teamOpen === l.key && ((l.items?.length ?? 0) > 0 || hasNotes);
                const unsent = (l.items || []).filter((i) => !i.sent).length;
                const noteCount = (l.notes || []).reduce((a, n) => a + n.lines.length, 0);
                return (
                  <li key={l.key} className="py-3">
                    <button
                      onClick={() => setTeamOpen(open ? null : l.key)}
                      disabled={!((l.items && l.items.length > 0) || hasNotes)}
                      className="w-full flex items-center gap-3 text-left disabled:cursor-default"
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(l.status)}`} />
                      <span className="text-xs text-[var(--c-text-4)] tabular-nums w-14 shrink-0">{l.time}</span>
                      <span className={`font-semibold text-[15px] shrink-0 ${l.status === 'prepared' ? 'text-[var(--c-text-3)]' : 'text-[var(--c-text-1)]'}`}>{l.name}</span>
                      <span className={`text-sm truncate ${l.status === 'prepared' ? 'text-[var(--c-text-4)]' : 'text-[var(--c-text-2)]'}`}>{l.status === 'prepared' ? `대기 · ${l.waitingFor || ''}` : l.summary}</span>
                      {l.items && l.items.length > 0 && (
                        <span className={`ml-auto shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${unsent > 0 ? 'bg-brand text-white' : 'bg-ok/10 text-ok'}`}>{unsent > 0 ? `${unsent}건 ${open ? '접기' : '보기'}` : '✓ 완료'}</span>
                      )}
                      {hasNotes && (
                        <span className="ml-auto shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-brand text-white">{noteCount}건 {open ? '접기' : '보기'}</span>
                      )}
                      {l.key === 'writer' && l.status !== 'idle' && (
                        <span onClick={(e) => { e.stopPropagation(); setActiveTab('blog'); }} className="ml-auto shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border border-[var(--c-border)] text-[var(--c-text-1)] hover:bg-[var(--c-subtle)]">열기</span>
                      )}
                    </button>
                    {open && hasNotes && (
                      <div className="mt-2 ml-5 md:ml-[4.5rem] border-t border-[var(--c-border)]">
                        {l.notes!.map((n) => (
                          <div key={n.label} className="py-2.5 border-b border-[var(--c-border)] last:border-b-0">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="font-semibold text-[15px] text-[var(--c-text-1)]">{n.label}</span>
                              <span className="text-xs text-[var(--c-text-4)] truncate">{n.where}</span>
                            </div>
                            <ul className="mt-1 space-y-0.5">
                              {n.lines.map((s, i) => <li key={i} className="text-sm text-[var(--c-text-2)]">{s}</li>)}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                    {open && !hasNotes && (
                      <ul className="mt-2 ml-5 md:ml-[4.5rem] divide-y divide-[var(--c-border)] border-t border-[var(--c-border)]">
                        {(l.items || []).map((it) => (
                          <li key={it.followUpId} className="py-2.5 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className={`text-sm font-bold tabular-nums shrink-0 ${it.overdueDays > 0 ? 'text-brand' : 'text-[var(--c-text-1)]'}`}>{it.overdueDays > 0 ? `${it.overdueDays}일 지남` : '오늘'}</span>
                              <span className="font-semibold text-[15px] text-[var(--c-text-1)] truncate">{it.name}</span>
                              <span className="text-sm text-[var(--c-text-3)] truncate">{it.label}{it.car ? ` · ${it.car}` : ''}</span>
                            </div>
                            <button onClick={() => handleTeamSms(it)} className={`shrink-0 text-xs font-semibold px-3.5 py-1.5 rounded-full transition-colors ${it.sent ? 'bg-[var(--c-subtle)] text-[var(--c-text-3)] hover:bg-[var(--c-hover)]' : 'bg-brand hover:bg-brand-dark text-white'}`}>
                              {it.sent ? '✓ 보냄 · 다시' : '💬 보내기'}
                            </button>
                          </li>
                        ))}
                        {(l.olderCount ?? 0) > 0 && (
                          <li className="py-2 text-xs text-[var(--c-text-4)]">2주 넘게 밀린 {l.olderCount}건은 사후관리 탭에서 정리하세요</li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 pt-3 border-t border-[var(--c-border)] flex items-center justify-between text-xs text-[var(--c-text-4)]">
            <span>다가오는 3일 {upcoming3}건 · 미처리 전체 {pendingCount}건</span>
            <button onClick={() => setActiveTab('followups')} className="hover:text-[var(--c-text-1)] transition-colors">사후관리 탭 →</button>
          </div>
        </section>
      </div>

      {/* 이번 주 숫자 · 유입경로 표 (2026-11-18): 구글 시트에 손으로 적던 집계를 CRM 기록으로 자동 계산, 표 복사로 시트에 붙이기 */}
      <section className={`${card} p-5 md:p-6`}>
        <div className="flex items-center justify-between mb-4 gap-3">
          <h2 className="text-lg font-bold text-[var(--c-text-1)]">{Number(statsMonth.slice(5))}월 숫자 <span className="text-[var(--c-text-3)] text-sm font-medium ml-1">{stats ? `${stats.weekly.from.slice(5).replace('-', '.')}~${stats.weekly.to.slice(5).replace('-', '.')}` : ''}</span></h2>
          <Btn size="sm" variant="ghost" icon="refresh" onClick={() => fetchStats(statsMonth)}>새로고침</Btn>
        </div>
        {!stats ? (
          <div className="py-8 text-center text-sm text-[var(--c-text-3)]">{isDemo ? "둘러보기에서는 비어 있습니다" : "지난 7일 기록을 세는 중…"}</div>
        ) : (
          <>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5">
              {[
                { k: '블로그 발행', v: stats.weekly.blogPublished, sub: stats.weekly.blogGenerated ? `생성 ${stats.weekly.blogGenerated}` : '' },
                { k: '상담 기록', v: stats.weekly.consultations, sub: `문의 답변 ${stats.weekly.inquiryReplies}` },
                { k: '견적 문자', v: stats.weekly.quoteSms, sub: stats.weekly.quoteOutcome ? [stats.weekly.quoteOutcome.booked ? `입고 ${stats.weekly.quoteOutcome.booked}` : '', stats.weekly.quoteOutcome.lost ? `타사 ${stats.weekly.quoteOutcome.lost}` : '', stats.weekly.quoteOutcome.noReply ? `무응답 ${stats.weekly.quoteOutcome.noReply}` : '', stats.weekly.quoteAvgMan ? `평균 ${stats.weekly.quoteAvgMan}만` : ''].filter(Boolean).join(' · ') : '' },
                { k: '새 고객', v: stats.weekly.newCustomers, sub: stats.weekly.sources.slice(0, 2).map((x) => `${x.label} ${x.count}`).join(' · ') },
                { k: '후기 받음', v: stats.weekly.reviewReceived, sub: `요청 ${stats.weekly.reviewRequested}건` },
                { k: 'QC · 메인터넌스', v: stats.weekly.qcDone + stats.weekly.maintenanceDone, sub: `입고 ${stats.weekly.appointments}` },
              ].map((t) => (
                <div key={t.k} className="rounded-xl bg-[var(--c-subtle)] px-3 py-3">
                  <div className="text-[11px] text-[var(--c-text-3)]">{t.k}</div>
                  <div className="text-2xl font-bold text-[var(--c-text-1)] tabular-nums leading-tight mt-0.5">{t.v}</div>
                  {t.sub && <div className="text-[11px] text-[var(--c-text-4)] truncate mt-0.5">{t.sub}</div>}
                </div>
              ))}
            </div>
            {stats.weekly.errors.length > 0 && <div className="mt-2 text-xs text-warn">읽지 못한 항목: {stats.weekly.errors.join(', ')}</div>}
            <div className="mt-5 pt-4 border-t border-[var(--c-border)]">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <button onClick={() => { const [y, m] = statsMonth.split('-').map(Number); const d = new Date(y, m - 2, 1); const mm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; setStatsMonth(mm); fetchStats(mm); }} className="w-7 h-7 rounded-full border border-[var(--c-border)] text-[var(--c-text-2)] hover:bg-[var(--c-subtle)]">‹</button>
                  <span className="font-semibold text-[15px] text-[var(--c-text-1)]">{Number(statsMonth.slice(5))}월 유입경로 <span className="text-[var(--c-text-3)] text-sm font-medium">{stats.table.total}명</span></span>
                  <button onClick={() => { const [y, m] = statsMonth.split('-').map(Number); const d = new Date(y, m, 1); const mm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; if (mm <= today.slice(0, 7)) { setStatsMonth(mm); fetchStats(mm); } }} className="w-7 h-7 rounded-full border border-[var(--c-border)] text-[var(--c-text-2)] hover:bg-[var(--c-subtle)]">›</button>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setStatsDays((v) => !v)} className="text-xs font-medium px-3 py-1.5 rounded-full border border-[var(--c-border)] text-[var(--c-text-2)] hover:bg-[var(--c-subtle)]">{statsDays ? '일별 닫기' : '일별 보기'}</button>
                  <button onClick={async () => { try { const r = await fetch(`/api/stats?month=${statsMonth}`, { cache: 'no-store' }); const d = await r.json(); await navigator.clipboard.writeText(d.tsv || ''); alert('표를 복사했습니다. 구글 시트에 붙여 넣으면 됩니다.'); } catch { alert('복사하지 못했습니다'); } }} className="text-xs font-medium px-3 py-1.5 rounded-full bg-[var(--c-text-1)] text-[var(--c-page)] hover:opacity-90">표 복사</button>
                </div>
              </div>
              {/* 시트의 "유입경로 분석"처럼: 도넛 + 건수·비율 요약, 일별 표는 펼쳤을 때만 (2026-11-18) */}
              <SourceChart table={stats.table} />
              {statsDays && (
                <div className="overflow-x-auto mt-4 pt-3 border-t border-dashed border-[var(--c-border)]">
                  <table className="w-full text-sm tabular-nums whitespace-nowrap">
                    <thead>
                      <tr className="text-[11px] text-[var(--c-text-3)]">
                        <th className="text-left py-1.5 pr-2 font-medium w-10">일</th>
                        {stats.table.labels.map((l) => <th key={l} className="text-right py-1.5 px-2 font-medium">{l}</th>)}
                        <th className="text-right py-1.5 pl-2 font-medium">합계</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.table.rows.filter((r) => r.total > 0).map((r) => (
                        <tr key={r.day} className="border-t border-[var(--c-border)]">
                          <td className="py-1.5 pr-2 text-[var(--c-text-3)]">{r.day}</td>
                          {r.counts.map((c, i) => <td key={i} className={`text-right py-1.5 px-2 ${c ? 'text-[var(--c-text-1)] font-semibold' : 'text-[var(--c-text-4)]'}`}>{c || ''}</td>)}
                          <td className="text-right py-1.5 pl-2 font-semibold text-[var(--c-text-1)]">{r.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {stats.table.blankSource > 0 && <div className="mt-2 text-xs text-[var(--c-text-4)]">유입경로가 비어 있는 고객 {stats.table.blankSource}명은 기타로 셌습니다. 고객 카드에서 채워 주세요.</div>}
              {statsDays && stats.table.rows.every((r) => r.total === 0) && <div className="py-3 text-center text-xs text-[var(--c-text-4)]">이 달에 등록된 고객이 없습니다</div>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
