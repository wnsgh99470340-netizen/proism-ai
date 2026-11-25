'use client';

import Link from 'next/link';

/** 예약/일정 탭 (2026-11-23 page.tsx 에서 분리 — 동작 변경 없음). 상태·핸들러는 page.tsx 에 있고 props 로 받는다 */
import Btn from '@/components/ui/Btn';
import type { Dispatch, SetStateAction } from 'react';
import { toSeoulISO } from '@/lib/local-date';
import { CRM_SERVICE_TO_KEY } from '@/config/blog-options';
import { LINKS } from '@/config/links';
import { vehicleLabel } from '@/lib/vehicles';
import { type Appointment, CARE_VISIT_TYPES, RETOUCH_TYPE, APPOINTMENT_STATUSES } from '@/lib/crm-shared';

interface AppointmentsTabProps {
  today: string;
  isDemo: boolean;
  appointments: Appointment[];
  calendarView: 'calendar' | 'list';
  setCalendarView: (v: 'calendar' | 'list') => void;
  managerFilter: '전체' | '대표' | '이팀장님' | '김막내';
  calendarMonth: { year: number; month: number };
  setCalendarMonth: Dispatch<SetStateAction<{ year: number; month: number }>>;
  selectedDate: string | null;
  setSelectedDate: (v: string | null) => void;
  setShowCalendarSub: (v: boolean) => void;
  setShowShotImport: (v: boolean) => void;
  setShotMonth: (v: string) => void;
  setShowAddAppointment: (v: boolean) => void;
  hasWarrantyIssued: (memo: string | null) => boolean;
  reviewSentFor: (customerId: string) => Record<string, boolean>;
  handleEditCustomerFromAppointment: (a: Appointment) => void;
  handleWriteBlogFromAppointment: (a: Appointment) => void;
  handleOpenCareVisit: (a: Appointment) => void;
  handleOpenRetouch: (a: Appointment) => void;
  handleOpenWorkOrder: (a: Appointment) => void;
  handleOpenWarranty: (a: Appointment) => void;
  handleReviewSmsFromAppointment: (a: Appointment, key: 'proism' | 'bmw' | 'audi') => void;
  handleStatusChange: (a: Appointment, newStatus: string) => void;
  openDateEdit: (a: Appointment) => void;
  handleDeleteAppointment: (id: string) => void;
}

export default function AppointmentsTab({
  today, isDemo, appointments, calendarView, setCalendarView, managerFilter, calendarMonth, setCalendarMonth, selectedDate, setSelectedDate,
  setShowCalendarSub, setShowShotImport, setShotMonth, setShowAddAppointment, hasWarrantyIssued, reviewSentFor,
  handleEditCustomerFromAppointment, handleWriteBlogFromAppointment, handleOpenCareVisit, handleOpenRetouch, handleOpenWorkOrder, handleOpenWarranty,
  handleReviewSmsFromAppointment, handleStatusChange, openDateEdit, handleDeleteAppointment,
}: AppointmentsTabProps) {
  const { year: cY, month: cM } = calendarMonth;
  const firstDay = new Date(cY, cM, 1).getDay();
  const daysInMonth = new Date(cY, cM + 1, 0).getDate();
  const prevMonthDays = new Date(cY, cM, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');

  // 이전달 끝자락 + 이번달 + 다음달 시작 포함한 전체 셀 구성
  type CalCell = { day: number; month: 'prev' | 'current' | 'next'; dateStr: string };
  const cells: CalCell[] = [];
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const pm = cM === 0 ? 11 : cM - 1;
    const py = cM === 0 ? cY - 1 : cY;
    cells.push({ day: d, month: 'prev', dateStr: `${py}-${pad(pm + 1)}-${pad(d)}` });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month: 'current', dateStr: `${cY}-${pad(cM + 1)}-${pad(d)}` });
  }
  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) {
    const nm = cM === 11 ? 0 : cM + 1;
    const ny = cM === 11 ? cY + 1 : cY;
    for (let d = 1; d <= remaining; d++) {
      cells.push({ day: d, month: 'next', dateStr: `${ny}-${pad(nm + 1)}-${pad(d)}` });
    }
  }

  const apptByDate = (dateStr: string) => appointments.filter((a) => {
    const start = a.appointment_date;
    const end = a.end_date || a.appointment_date;
    return dateStr >= start && dateStr <= end;
  });

  // 담당자 자동 분류: 틴팅 → 이팀장님, 나머지 → 대표
  const getManager = (a: Appointment): '대표' | '이팀장님' | '김막내' => {
    // memo JSON에 수동 배정된 담당자가 있으면 우선
    try { const m = JSON.parse(a.memo || '{}'); if (m.manager === '김막내') return '김막내'; } catch { /* */ }
    const svc = (a.service_type || '').toLowerCase();
    return svc.includes('틴팅') || svc.includes('썬팅') ? '이팀장님' : '대표';
  };

  const baseAppointments = calendarView === 'calendar' && selectedDate
    ? apptByDate(selectedDate)
    : appointments;

  const displayAppointments = managerFilter === '전체'
    ? baseAppointments
    : baseAppointments.filter((a) => getManager(a) === managerFilter);

  // 일별/주별 건수
  // 기간 예약(end_date)은 진행 중인 날도 센다 (2026-11-18: 3박 4일 PPF 두 대가 있는데 "오늘 0건"으로 보이던 문제)
  const todayCount = appointments.filter((a) => a.appointment_date <= today && (a.end_date || a.appointment_date) >= today && a.status !== '완료' && a.status !== '취소').length;
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()));
  const weekEndStr = toSeoulISO(weekEnd);
  const weekCount = appointments.filter((a) => a.appointment_date <= weekEndStr && (a.end_date || a.appointment_date) >= today && a.status !== '완료' && a.status !== '취소').length;

  const goToday = () => {
    const now = new Date();
    setCalendarMonth({ year: now.getFullYear(), month: now.getMonth() });
    setSelectedDate(today);
  };

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const chip = (status: string) =>
    status === '완료' ? 'bg-ok/10 text-ok'
    : status === '시공중' ? 'bg-[var(--c-text-1)] text-[var(--c-card)]'
    : status === '예약확정' ? 'bg-info/10 text-info'
    : 'bg-[var(--c-subtle)] text-[var(--c-text-2)] border border-[var(--c-border)]';
  const pill = 'text-xs font-semibold rounded-full px-3 py-1.5 border border-[var(--c-border)] bg-[var(--c-card)] hover:bg-[var(--c-subtle)] text-[var(--c-text-1)] transition-colors whitespace-nowrap';
  const selLabel = selectedDate ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }) : '';

  return (
    <div className="space-y-5">
      {/* 상단 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setCalendarMonth((p) => { const d = new Date(p.year, p.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })} className="w-9 h-9 rounded-full border border-[var(--c-border)] bg-[var(--c-card)] hover:bg-[var(--c-subtle)] flex items-center justify-center text-[var(--c-text-2)] text-lg leading-none transition-colors" aria-label="이전 달">‹</button>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight text-[var(--c-text-1)] min-w-[130px] text-center">{cY}년 {cM + 1}월</h2>
          <button onClick={() => setCalendarMonth((p) => { const d = new Date(p.year, p.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })} className="w-9 h-9 rounded-full border border-[var(--c-border)] bg-[var(--c-card)] hover:bg-[var(--c-subtle)] flex items-center justify-center text-[var(--c-text-2)] text-lg leading-none transition-colors" aria-label="다음 달">›</button>
          <button onClick={goToday} className={`${pill} ml-1`}>오늘</button>
          <div className="ml-2 flex bg-[var(--c-subtle)] rounded-full p-1">
            {(['calendar', 'list'] as const).map((v) => (
              <button key={v} onClick={() => setCalendarView(v)} className={`text-sm font-semibold rounded-full px-3.5 py-1.5 transition-colors ${calendarView === v ? 'bg-[var(--c-text-1)] text-[var(--c-card)]' : 'text-[var(--c-text-3)] hover:text-[var(--c-text-1)]'}`}>{v === 'calendar' ? '달력' : '리스트'}</button>
            ))}
          </div>
          <span className="ml-2 text-sm text-[var(--c-text-3)]">오늘 <b className="text-[var(--c-text-1)]">{todayCount}</b>건 · 이번 주 <b className="text-[var(--c-text-1)]">{weekCount}</b>건</span>
        </div>
        <div className="flex items-center gap-2">
          <Btn icon="rss" onClick={() => setShowCalendarSub(true)}>캘린더 구독</Btn>
          <Btn icon="camera" onClick={() => { setShowShotImport(true); setShotMonth(`${cY}-${String(cM + 1).padStart(2, '0')}`); }} title="타임트리 캡처·카톡 대화 사진에서 일정을 읽어 예약으로 넣기">캡처로 추가</Btn>
          <Btn icon="plus" variant="primary" onClick={() => setShowAddAppointment(true)}>예약 추가</Btn>
        </div>
      </div>

      {/* 달력 뷰 */}
      {calendarView === 'calendar' && (
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl overflow-hidden">
          <div className="grid grid-cols-7 border-b border-[var(--c-border)] bg-[var(--c-subtle)]/60">
            {dayNames.map((d, i) => (
              <div key={d} className={`py-2.5 text-center text-xs font-semibold ${i === 0 ? 'text-danger' : i === 6 ? 'text-info' : 'text-[var(--c-text-3)]'}`}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((cell, i) => {
              const dayAppts = apptByDate(cell.dateStr);
              const isT = cell.dateStr === today;
              const isSel = cell.dateStr === selectedDate;
              const isCurrent = cell.month === 'current';
              const dow = i % 7;
              const numColor = dow === 0 ? 'text-danger' : dow === 6 ? 'text-info' : 'text-[var(--c-text-1)]';
              const lastRow = i >= cells.length - 7;
              return (
                <button
                  key={cell.dateStr + cell.month}
                  onClick={() => setSelectedDate(isSel ? null : cell.dateStr)}
                  className={`relative min-h-[96px] md:min-h-[116px] p-2 text-left align-top border-[var(--c-border)] transition-colors ${dow !== 6 ? 'border-r' : ''} ${!lastRow ? 'border-b' : ''} ${isSel ? 'bg-[var(--c-subtle)]' : 'hover:bg-[var(--c-subtle)]/60'} ${!isCurrent ? 'opacity-35' : ''}`}
                >
                  <span className={`inline-flex w-7 h-7 items-center justify-center rounded-full text-[13px] ${isT ? 'bg-[var(--c-text-1)] text-[var(--c-card)] font-bold' : `font-medium ${numColor}`}`}>{cell.day}</span>
                  {isCurrent && dayAppts.length > 0 && (
                    <div className="mt-1.5 flex flex-col gap-1">
                      {dayAppts.slice(0, 3).map((a) => {
                        const isStart = a.appointment_date === cell.dateStr;
                        return (
                          <div key={a.id} className={`truncate rounded-md px-1.5 py-1 text-[11px] font-semibold ${chip(a.status)}`}>
                            {isStart ? `${a.customer?.name || '?'}${a.service_type ? ` · ${a.service_type}` : ''}` : `→ ${a.customer?.name || '?'}`}
                          </div>
                        );
                      })}
                      {dayAppts.length > 3 && <div className="text-[11px] text-[var(--c-text-3)] pl-1">+{dayAppts.length - 3}건</div>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 선택한 날짜 / 리스트 */}
      {(calendarView === 'list' || (calendarView === 'calendar' && selectedDate)) && (
        <div>
          {calendarView === 'calendar' && selectedDate && (
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-lg font-bold text-[var(--c-text-1)]">{selLabel}</h3>
              <span className="text-sm text-[var(--c-text-3)]">{apptByDate(selectedDate).length}건</span>
            </div>
          )}
          <div className="space-y-2.5">
            {displayAppointments.map((a) => {
              const isToday = a.appointment_date === today;
              const isPast = a.appointment_date < today;
              const dim = a.status === '완료' ? 'opacity-60' : a.status === '취소' ? 'opacity-40' : isPast ? 'opacity-70' : '';
              let memoDisplay = a.memo;
              try { if (a.memo && JSON.parse(a.memo)?.car_number !== undefined) memoDisplay = null; } catch { /* not JSON */ }
              const d = new Date(a.appointment_date + 'T00:00:00');
              return (
                <div key={a.id} className={`bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl p-4 md:p-5 flex flex-wrap items-center justify-between gap-3 group ${dim}`}>
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="text-center w-14 shrink-0">
                      <div className={`text-2xl font-bold leading-none ${isToday ? 'text-brand' : 'text-[var(--c-text-1)]'}`}>{d.getDate()}</div>
                      <div className="text-[11px] text-[var(--c-text-3)] mt-1">
                        {d.getMonth() + 1}월 {dayNames[d.getDay()]}
                        {a.end_date && a.end_date !== a.appointment_date ? ` ~${new Date(a.end_date + 'T00:00:00').getDate()}일` : ''}
                      </div>
                    </div>
                    <div className="h-10 w-px bg-[var(--c-border)]" />
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold text-[var(--c-text-1)] truncate">
                        {a.customer?.name || '(삭제된 고객)'}
                        {a.customer?.phone && <span className="text-[var(--c-text-3)] ml-2 font-normal text-sm">{a.customer.phone}</span>}
                      </div>
                      <div className="text-sm text-[var(--c-text-3)] mt-0.5 truncate">
                        {a.service_type || '시공 미정'}
                        {a.vehicle && vehicleLabel(a.vehicle) ? <span className="ml-2 text-[var(--c-text-2)]">{vehicleLabel(a.vehicle)}</span> : null}
                        {a.amount ? <span className="ml-2 text-[var(--c-text-1)] font-medium">{a.amount.toLocaleString()}원</span> : null}
                        {memoDisplay && <span className="ml-2">· {memoDisplay}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
                    <span className={`text-xs font-semibold px-2.5 py-1.5 rounded-full ${chip(a.status)}`}>{a.status}</span>
                    {/* 고객 정보 = 고객 상세 페이지로 (2026-11-25 사장님 "수정 창이 아니라 상세로"). 수정은 상세에서 */}
                    {a.customer_id && (
                      <Link href={`/crm/${a.customer_id}`} className={pill} title="고객 상세 페이지로 (타임라인·수정·연락처)">고객 정보</Link>
                    )}
                    {!isDemo && a.service_type && CRM_SERVICE_TO_KEY[a.service_type] && (
                      <button onClick={() => handleWriteBlogFromAppointment(a)} className={pill} title="이 시공으로 블로그 시공기 폼 채우기">시공기</button>
                    )}
                    {CARE_VISIT_TYPES.includes(a.service_type || '') ? (
                      <button onClick={() => handleOpenCareVisit(a)} className={a.status === '완료' ? 'text-xs font-semibold rounded-full px-3 py-1.5 bg-ok text-white whitespace-nowrap' : pill} title="점검 기록을 남기면 사후관리도 함께 완료됩니다">{a.status === '완료' ? '✓ 점검 기록됨' : '점검 완료'}</button>
                    ) : a.service_type === RETOUCH_TYPE ? (
                      <button onClick={() => handleOpenRetouch(a)} className={a.status === '완료' ? 'text-xs font-semibold rounded-full px-3 py-1.5 bg-ok text-white whitespace-nowrap' : pill} title="새 시공 기록 없이 원래 시공 기록 밑에 리터치 한 건으로 남깁니다">{a.status === '완료' ? '✓ 리터치 기록됨 · 더 남기기' : '리터치 완료'}</button>
                    ) : (<>
                    <button onClick={() => handleOpenWorkOrder(a)} className={pill}>작업 내역서</button>
                    <button onClick={() => handleOpenWarranty(a)} className={hasWarrantyIssued(a.memo) ? 'text-xs font-semibold rounded-full px-3 py-1.5 bg-ok text-white whitespace-nowrap' : pill}>{hasWarrantyIssued(a.memo) ? '✓ 보증서 발급' : '보증서'}</button>
                    <a href={LINKS.threeMWarrantyCheck} target="_blank" rel="noopener noreferrer" className={pill} title="한국쓰리엠 소비자 보증서 확인 페이지 새 창으로">3M 보증서 ↗</a>
                    </>)}
                    {a.customer?.phone && (() => {
                      const sent = reviewSentFor(a.customer_id);
                      const anySent = Object.values(sent).some(Boolean);
                      return (
                        <div className={`flex items-center rounded-full border overflow-hidden ${anySent ? 'border-ok/40 bg-ok/10' : 'border-[var(--c-border)] bg-[var(--c-card)]'}`} title={anySent ? '후기 요청 문자를 보냈습니다' : '후기 요청 문자 보내기'}>
                          <span className={`text-[11px] font-semibold pl-3 pr-2 py-1.5 ${anySent ? 'text-ok' : 'text-[var(--c-text-3)]'}`}>{anySent ? '후기 보냄' : '후기'}</span>
                          {(['proism', 'audi', 'bmw'] as const).map((k) => (
                            <button key={k} onClick={(e) => { e.stopPropagation(); handleReviewSmsFromAppointment(a, k); }} className={`text-xs font-semibold px-2.5 py-1.5 transition-colors border-l ${sent[k] ? 'bg-ok/15 text-ok border-ok/30' : 'text-[var(--c-text-1)] hover:bg-[var(--c-subtle)] border-[var(--c-border)]'}`}>
                              {sent[k] ? '✓ ' : ''}{k === 'proism' ? '프로이즘' : k === 'audi' ? '아우디' : 'BMW'}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                    {a.status !== '완료' && (
                      <select value="" onChange={(e) => { if (e.target.value) handleStatusChange(a, e.target.value); }} className={`${pill} appearance-none pr-3 cursor-pointer outline-none`}>
                        <option value="">상태 변경</option>
                        {APPOINTMENT_STATUSES.filter((st) => st !== a.status).map((st) => (<option key={st} value={st}>{st}</option>))}
                      </select>
                    )}
                    {a.status !== '완료' && a.status !== '취소' && <button onClick={() => openDateEdit(a)} className={pill} title="시작·종료일 바꾸기 (QC·메인터넌스 방문이면 사후관리 날짜도 함께)">날짜</button>}
                    <button onClick={() => handleDeleteAppointment(a.id)} className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-full flex items-center justify-center text-[var(--c-text-3)] hover:text-danger hover:bg-danger/10 transition-all text-xs" title="삭제">✕</button>
                  </div>
                </div>
              );
            })}
            {displayAppointments.length === 0 && (
              <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl text-center py-12 text-sm text-[var(--c-text-3)]">
                {calendarView === 'calendar' && selectedDate ? '이 날짜에 예약이 없습니다' : '등록된 예약이 없습니다'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
