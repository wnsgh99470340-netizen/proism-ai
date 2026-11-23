'use client';

/**
 * CRM 목록 상태 + 불러오기 (2026-11-23 page.tsx 탭 분리 — 동작 변경 없음)
 * page.tsx 에 있던 customers·appointments·followUps·consultations·allCustomers·vehiclesByCustomer·
 * 마케팅팀 브리핑·월 숫자 상태와 fetch 함수, 탭이 바뀔 때 읽는 effect 를 그대로 옮김.
 * 핸들러(저장·완료 처리 등)와 창 상태는 page.tsx 에 남아 있다.
 */
import { useState, useEffect, useCallback } from 'react';
import { todaySeoul } from '@/lib/local-date';
import { supabase } from '@/lib/supabase';
import type { DailyBrief } from '@/lib/team';
import type { WeeklyStats, SourceTable } from '@/lib/weekly-stats';
import { loadAllVehicles, type Vehicle } from '@/lib/vehicles';
import { advanceAppointmentsForToday } from '@/lib/appointments-flow';
import { type Customer, type Appointment, type FollowUp, type Consultation, type Tab, CARE_VISIT_TYPES } from '@/lib/crm-shared';

export type PickerCustomer = { id: string; name: string; phone: string | null; car_brand?: string | null; car_model?: string | null; car_color?: string | null; memo?: string | null };

export function useCrmData(activeTab: Tab) {
  // Customer state
  const [customers, setCustomers] = useState<Customer[]>([]);
  // Appointment state
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  // 고객 목록 "외 N대" 표시용
  const [vehiclesByCustomer, setVehiclesByCustomer] = useState<Map<string, Vehicle[]>>(new Map());
  // Follow-up state
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  // 홈 "오늘 AI가 한 일" (2026-11-12): 사후관리·상담 담당이 준비한 문자를 건마다 보낸다
  const [teamBrief, setTeamBrief] = useState<DailyBrief | null>(null);
  const [teamOpen, setTeamOpen] = useState<string | null>(null);
  // 홈 "이번 주 숫자"·유입경로 표 (2026-11-18): 시트에 손으로 적던 집계를 CRM 기록으로 자동 계산
  const [stats, setStats] = useState<{ weekly: WeeklyStats; table: SourceTable } | null>(null);
  const [statsMonth, setStatsMonth] = useState<string>(() => todaySeoul().slice(0, 7));
  const [statsDays, setStatsDays] = useState(false);
  const fetchStats = useCallback(async (month: string) => {
    try {
      const res = await fetch(`/api/stats?month=${month}&range=month`, { cache: 'no-store' }); // 월간 (2026-11-23)
      const d = await res.json();
      if (res.ok && d.weekly) setStats({ weekly: d.weekly as WeeklyStats, table: d.table as SourceTable });
    } catch { /* 카드만 비움 */ }
  }, []);
  const fetchTeamBrief = useCallback(async () => {
    try {
      const res = await fetch('/api/team/today', { cache: 'no-store' });
      const d = await res.json();
      if (res.ok && d.brief) {
        setTeamBrief(d.brief as DailyBrief);
        setTeamOpen((cur) => cur ?? ((d.brief as DailyBrief).lines.find((l) => l.status === 'ready')?.key ?? null));
      }
    } catch { /* 홈 카드만 비움 */ }
  }, []);

  // Consultation state
  const [consultations, setConsultations] = useState<Consultation[]>([]);

  // Customer picker state (shared)
  const [allCustomers, setAllCustomers] = useState<PickerCustomer[]>([]);

  // ─── Data Fetching ──────────────────────────────────────
  const fetchCustomers = useCallback(async () => {
    loadAllVehicles().then(setVehiclesByCustomer);
    const { data } = await supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) {
      // 최근 시공: 완료된 시공(services)이 있으면 그것, 없으면 예약(appointments, 취소 제외)을 "예약"으로 표시
      // (2026-11-18 사장님: 예약에 PPF 를 넣었는데 목록 최근 시공이 비어 있던 문제. 고객마다 따로 묻던 쿼리도 두 번으로 줄임)
      const [{ data: services }, { data: appts }] = await Promise.all([
        supabase.from('services').select('customer_id, service_type, service_date').order('service_date', { ascending: false }),
        supabase.from('appointments').select('customer_id, service_type, appointment_date, status').neq('status', '취소').order('appointment_date', { ascending: false }),
      ]);
      const svcBy = new Map<string, { service_type: string; service_date: string }[]>();
      for (const sv of services || []) { const k = sv.customer_id as string; if (!svcBy.has(k)) svcBy.set(k, []); svcBy.get(k)!.push(sv as { service_type: string; service_date: string }); }
      const apptBy = new Map<string, { service_type: string | null; appointment_date: string; status: string }>();
      for (const a of appts || []) { const k = a.customer_id as string; if (k && !apptBy.has(k)) apptBy.set(k, a as { service_type: string | null; appointment_date: string; status: string }); }
      setCustomers(data.map((c) => {
        const sv = svcBy.get(c.id) || [];
        const ap = apptBy.get(c.id);
        if (sv.length > 0) return { ...c, latest_service: sv[0].service_type, latest_service_date: sv[0].service_date, latest_is_booking: false, latest_status: null, service_count: sv.length };
        return { ...c, latest_service: ap ? (ap.service_type || '시공 미정') : null, latest_service_date: ap?.appointment_date ?? null, latest_is_booking: !!ap, latest_status: ap?.status ?? null, service_count: 0 };
      }));
    }
  }, []);

  const fetchAllCustomers = useCallback(async () => {
    const { data } = await supabase.from('customers').select('id, name, phone, car_brand, car_model, car_color, memo').order('name');
    if (data) setAllCustomers(data);
  }, []);

  const fetchAppointments = useCallback(async () => {
    await advanceAppointmentsForToday().catch(() => 0); // 시작일이 된 예약확정 → 시공중 (2026-11-22). 크론도 같은 함수를 돈다
    let { data } = await supabase
      .from('appointments')
      .select('*, customer:customers(name, phone), vehicle:vehicles(brand, model, plate)')
      .order('appointment_date', { ascending: true });
    if (!data) { // vehicles 표가 아직 없으면 join 이 실패 → 예전 쿼리로
      const r = await supabase.from('appointments').select('*, customer:customers(name, phone)').order('appointment_date', { ascending: true });
      data = r.data;
    }
    if (data) {
      // 오늘 기준 가까운 예약이 위로: 오늘/미래 → 날짜 오름차순, 과거 → 날짜 내림차순 (아래로)
      const todayStr = todaySeoul();
      const upcoming = (data as Appointment[]).filter((a) => a.appointment_date >= todayStr);
      const past = (data as Appointment[]).filter((a) => a.appointment_date < todayStr).reverse();
      setAppointments([...upcoming, ...past]);
    }
  }, []);

  const fetchFollowUps = useCallback(async () => {
    const { data } = await supabase
      .from('follow_ups')
      .select('*, customer:customers(name, phone), service:services(service_type)')
      .order('scheduled_date', { ascending: true });
    if (!data) return;
    // 방문 예약(QC·메인터넌스) 붙이기: follow_up_id 열이 있으면 그걸로, 없으면 memo 의 "사후관리:<id>"
    const visits = new Map<string, { id: string; appointment_date: string; status: string }>();
    type VisitRow = { id: string; appointment_date: string; status: string; follow_up_id?: string | null; memo: string | null };
    let va: VisitRow[] | null = (await supabase.from('appointments').select('id, appointment_date, status, follow_up_id, memo').in('service_type', CARE_VISIT_TYPES).neq('status', '취소')).data as VisitRow[] | null;
    if (!va) va = (await supabase.from('appointments').select('id, appointment_date, status, memo').in('service_type', CARE_VISIT_TYPES).neq('status', '취소')).data as VisitRow[] | null; // follow_up_id 열이 아직 없으면 memo 로만
    for (const a of va || []) {
      const fid = a.follow_up_id || (a.memo || '').match(/사후관리:([0-9a-f-]{36})/)?.[1];
      if (fid && !visits.has(fid)) visits.set(fid, { id: a.id, appointment_date: a.appointment_date, status: a.status });
    }
    setFollowUps((data as FollowUp[]).map((f) => ({ ...f, visit: visits.get(f.id) || null })));
  }, []);

  const fetchConsultations = useCallback(async () => {
    const { data } = await supabase
      .from('consultations')
      .select('*, customer:customers(name, phone)')
      .order('consultation_date', { ascending: false });
    if (data) setConsultations(data as Consultation[]);
  }, []);

  useEffect(() => {
    fetchAllCustomers();
  }, [fetchAllCustomers]);

  useEffect(() => {
    if (activeTab === 'home') { fetchAppointments(); fetchFollowUps(); fetchTeamBrief(); fetchStats(statsMonth); }
    else if (activeTab === 'customers') fetchCustomers();
    else if (activeTab === 'appointments') { fetchAppointments(); fetchFollowUps(); } // 후기 보낸 표시(sms_sent)를 예약 줄에도 보여 주려고 같이 읽음
    else if (activeTab === 'followups') fetchFollowUps();
    else if (activeTab === 'consultations') fetchConsultations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, fetchCustomers, fetchAppointments, fetchFollowUps, fetchConsultations]);

  return {
    customers, appointments, followUps, consultations, allCustomers, vehiclesByCustomer,
    teamBrief, teamOpen, setTeamOpen,
    stats, statsMonth, setStatsMonth, statsDays, setStatsDays,
    fetchCustomers, fetchAllCustomers, fetchAppointments, fetchFollowUps, fetchConsultations, fetchTeamBrief, fetchStats,
  };
}
