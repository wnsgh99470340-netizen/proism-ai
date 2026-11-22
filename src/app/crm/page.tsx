'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { todaySeoul, toSeoulISO, addDaysISO } from '@/lib/local-date';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { quoteForDate } from '@/config/daily-quotes';
import { BLOG_PREFILL_KEY, CRM_SERVICE_TO_KEY, type BlogPrefill } from '@/config/blog-options';
import { useTheme } from '@/components/ThemeProvider';
import QuoteSmsModal, { type QuoteSmsInitial } from '@/components/crm/QuoteSmsModal';
import InquiryReplyModal from '@/components/crm/InquiryReplyModal';
import { QC_SMS, MAINT_SMS, REVIEW_SMS } from '@/config/sms-templates';
import type { DailyBrief, TeamItem, WorkerLine } from '@/lib/team';
import type { WeeklyStats, SourceTable } from '@/lib/weekly-stats';
import type { ImportCandidate } from '@/lib/appointment-import';
import SourceChart from '@/components/crm/SourceChart';
import { LINKS } from '@/config/links';
import BlogWorkspace from '@/components/BlogWorkspace';
import HelpModal from '@/components/HelpModal';
import PushToggle from '@/components/PushToggle';
import Link from 'next/link';
import CustomerFormModal, { EMPTY_CUSTOMER_FORM, loadCustomerForm, saveCustomerEdit } from '@/components/crm/CustomerFormModal';
import { linkReferral, loadReferralsFor, markThanksSent, grantPointForReferred, loadPoints } from '@/lib/referrals';
import { MEMBERSHIP, POINTS } from '@/config/membership';
import { getOrCreateMemberLink, memberLinkSms } from '@/lib/member-links';
import { workDetailsText, workItems, ppfProduct, type WorkOrderJson } from '@/lib/work-order';
import CareCompleteModal from '@/components/crm/CareCompleteModal';
import { appendCareLog, parseCareLog, stripCareLog } from '@/lib/care-log';
import { isDemoClient } from '@/lib/demo';
import { scheduleNextMaintenance, markFollowUpSkipped, closeQuoteFollowUpsFor, isSkipped } from '@/lib/followups';
import { loadVehicles, loadAllVehicles, ensurePrimaryVehicle, fillPlateIfEmpty, vehicleLabel, addVehicle, type Vehicle } from '@/lib/vehicles';

// ─── Types ───────────────────────────────────────────────
interface Customer {
  id: string;
  name: string;
  phone: string | null;
  car_brand: string | null;
  car_model: string | null;
  car_year: string | null;
  car_color: string | null;
  source: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
  latest_service: string | null;
  latest_service_date: string | null;
  /** 완료된 시공이 없고 예약만 있을 때 true → 목록에 "PPF 예약 (날짜)" 로 보임 */
  latest_is_booking?: boolean;
  latest_status?: string | null;
  service_count: number;
}

interface Appointment {
  id: string;
  customer_id: string;
  /** 어느 차에 한 작업인지 (2026-11-22 차량 N대). 표가 없으면 undefined */
  vehicle_id?: string | null;
  /** QC·메인터넌스 방문 예약이 묶인 사후관리 (열이 없으면 memo 의 "사후관리:<id>") */
  follow_up_id?: string | null;
  vehicle?: { brand: string | null; model: string | null; plate: string | null } | null;
  appointment_date: string;
  end_date?: string | null;
  service_type: string | null;
  status: string;
  memo: string | null;
  amount?: number | null;
  created_at: string;
  updated_at: string;
  customer?: { name: string; phone: string | null };
}

interface FollowUp {
  id: string;
  service_id: string;
  customer_id: string;
  follow_up_type: string;
  scheduled_date: string;
  is_completed: boolean;
  completed_date: string | null;
  memo: string | null;
  created_at: string;
  customer?: { name: string; phone: string | null };
  service?: { service_type: string };
  sms_sent?: Record<string, boolean> | null;
  /** 잡힌 방문 예약 (2026-11-22) */
  visit?: { id: string; appointment_date: string; status: string } | null;
}

interface Consultation {
  id: string;
  customer_id: string;
  consultation_date: string;
  content: string | null;
  estimate: string | null;
  interested_services: string | null;
  memo: string | null;
  created_at: string;
  customer?: { name: string; phone: string | null };
}

type Tab = 'home' | 'blog' | 'customers' | 'appointments' | 'followups' | 'consultations';
const TAB_KEYS: Tab[] = ['home', 'blog', 'customers', 'appointments', 'followups', 'consultations'];

const SERVICE_TYPES = ['PPF', '컬러PPF', 'PWF', '랩핑', '크롬죽이기', '썬팅', '유리막코팅', '가죽코팅', '실내PPF', '신차패키지', '리터치', 'QC점검', '메인터넌스'];
/** QC·메인터넌스 방문 예약 (2026-11-22): 사후관리 한 건에 묶인 달력 예약. 완료하면 점검 기록 창 → 그 사후관리도 완료 */
const CARE_VISIT_TYPES = ['QC점검', '메인터넌스'];
/** 리터치(2026-11-22): 완료해도 새 시공 기록을 만들지 않고 원래 시공 기록 밑에 관리 이력 한 건으로 붙는다 */
const RETOUCH_TYPE = '리터치';
const APPOINTMENT_STATUSES = ['상담중', '예약확정', '시공중', '완료', '취소']; // 취소(2026-11-22): 삭제하면 "예약했다 취소했다" 기록이 사라지므로 상태로 남긴다. 홈·오늘 예약·손님 페이지에서는 이미 거른다
const FOLLOW_UP_TYPES = ['QC점검', '메인터넌스', '후기요청'];
/** 홈 상단 배너 사진 경로(public 기준, 예: '/img/home-banner.jpg'). 비우면 글자만 표시. 사장님이 배너용 사진 주면 넣는다 */
const HOME_BANNER_IMAGE = '';
/** QC(2주)·메인터넌스(6개월) 안내 문자 */
/** 폰 문자 앱 열기 (iOS는 &body=, Android는 ?body=) */
function openSmsApp(phone: string, msg: string) {
  const p = phone.replace(/[^\d]/g, '');
  const cleanMsg = msg.replace(/\\n/g, '\n').trim();
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  window.open(isIOS ? `sms:${p}&body=${encodeURIComponent(cleanMsg)}` : `sms:${p}?body=${encodeURIComponent(cleanMsg)}`);
}



const TEMPLATE_KEYS = ['크롬죽이기', 'PPF', '신차패키지', '랩핑'];

// 사후관리 자동 생성 로직
async function createAutoFollowUps(
  serviceId: string,
  customerId: string,
  serviceType: string,
  completionDate: string,
  /** 작업 내역서에 PPF 항목이 있으면(신차패키지 안의 프론트 패키지 등) QC 를 잡는다. 2026-11-19 사장님 "QC 는 PPF·컬러PPF 에만" */
  hasPpf = false
) {
  const base = new Date(completionDate + 'T00:00:00+09:00');
  const followUps: { service_id: string; customer_id: string; follow_up_type: string; scheduled_date: string; memo: string }[] = [];

  const needsQC = ['PPF', '컬러PPF', 'PWF'].includes(serviceType) || hasPpf;

  if (needsQC) {
    const qcDate = new Date(base);
    qcDate.setDate(qcDate.getDate() + 14);
    followUps.push({
      service_id: serviceId,
      customer_id: customerId,
      follow_up_type: 'QC점검',
      scheduled_date: toSeoulISO(qcDate),
      memo: `${serviceType} 시공 완료 후 2주 QC점검`,
    });
  }

  const maintDate = new Date(base);
  maintDate.setMonth(maintDate.getMonth() + 6);
  followUps.push({
    service_id: serviceId,
    customer_id: customerId,
    follow_up_type: '메인터넌스',
    scheduled_date: toSeoulISO(maintDate),
    memo: `${serviceType} 시공 완료 후 6개월 메인터넌스`,
  });

  // 후기요청: 시공 완료 3일 후
  const reviewDate = new Date(base);
  reviewDate.setDate(reviewDate.getDate() + 3);
  followUps.push({
    service_id: serviceId,
    customer_id: customerId,
    follow_up_type: '후기요청',
    scheduled_date: toSeoulISO(reviewDate),
    memo: `${serviceType} 시공 완료 후 후기 요청`,
  });

  if (followUps.length > 0) {
    // 같은 시공 기록에 이미 사후관리가 있으면 만들지 않는다 (2026-11-22 "한 작업당 무조건 한 번만"). 유형별로 빠진 것만 채운다
    const { data: have } = await supabase.from('follow_ups').select('follow_up_type').eq('service_id', serviceId);
    const haveTypes = new Set((have || []).map((h) => h.follow_up_type as string));
    const missing = followUps.filter((f) => !haveTypes.has(f.follow_up_type));
    if (missing.length > 0) await supabase.from('follow_ups').insert(missing);
  }
}

// ─── Helper ──────────────────────────────────────────────
function formatDate(dateStr: string | null) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function statusColor(status: string) {
  switch (status) {
    case '상담중': return 'bg-[var(--c-hover)] text-[var(--c-text-2)]';
    case '예약확정': return 'bg-info/20 text-info';
    case '시공중': return 'bg-warn/20 text-warn';
    case '완료': return 'bg-ok/20 text-ok';
    case '취소': return 'bg-danger/10 text-danger line-through';
    default: return 'bg-[var(--c-hover)] text-[var(--c-text-2)]';
  }
}

// ─── Main Page ───────────────────────────────────────────
declare global {
  interface Window {
    Kakao?: {
      isInitialized: () => boolean;
      init: (key: string) => void;
      Share: {
        sendDefault: (options: {
          objectType: string;
          text: string;
          link: { mobileWebUrl: string; webUrl: string };
          buttonTitle?: string;
        }) => void;
      };
    };
  }
}

export default function CRMPage() {
  const router = useRouter();
  const { theme, toggle: toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [isDemo, setIsDemo] = useState(false);
  useEffect(() => { setIsDemo(isDemoClient()); }, []);
  // 블로그 AI 탭 (2026-11-12): 한 번 열면 다른 탭을 봐도 대화·초안을 유지하기 위해 숨기기만 한다
  const [blogVisited, setBlogVisited] = useState(false);
  const [prefillNonce, setPrefillNonce] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => { if (activeTab === 'blog') { if (isDemo) setActiveTab('home'); else setBlogVisited(true); } }, [activeTab, isDemo]);
  // 주소 ?tab=blog 로 바로 열기, ?warranty=<예약 id> 면 그 예약의 보증서 창까지 (고객 상세 화면 "보증서 만들기" 링크, 2026-11-18)
  const pendingWarrantyId = useRef<string | null>(null);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const t = q.get('tab');
      if (t && (TAB_KEYS as string[]).includes(t)) setActiveTab(t as Tab);
      pendingWarrantyId.current = q.get('warranty');
    } catch { /* ignore */ }
  }, []);

  // 카카오 SDK 동적 로드 + 초기화
  useEffect(() => {
    const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_KEY || '';
    const initKakao = () => {
      if (window.Kakao && !window.Kakao.isInitialized() && KAKAO_KEY) {
        window.Kakao.init(KAKAO_KEY);
      }
    };
    if (window.Kakao) { initKakao(); return; }
    if (document.getElementById('kakao-sdk')) return;
    const script = document.createElement('script');
    script.id = 'kakao-sdk';
    script.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';
    script.crossOrigin = 'anonymous';
    script.onload = initKakao;
    document.head.appendChild(script);
  }, []);

  // Customer state
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [editCustomerId, setEditCustomerId] = useState<string | null>(null);
  // 고객 수정 창에 최근 예약(시공·시작·종료·금액)을 같이 보여 주고 고친다 (2026-11-18 사장님: 등록 창과 수정 창이 달라 헷갈림)
  const [editLatestApptId, setEditLatestApptId] = useState<string | null>(null);
  // 멤버십(2026-11-18): 고객 창에서 고른 "소개한 분". 저장 때 referrals 에 연결
  const [customerReferrerId, setCustomerReferrerId] = useState<string | null>(null);
  const [customerForm, setCustomerForm] = useState({
    name: '', phone: '', car_brand: '', car_model: '', car_year: '', car_color: '', source: '', memo: '',
    appointment_start_date: '', appointment_end_date: '', appointment_service_type: '', appointment_amount: '', appointment_memo: '',
  });

  // Appointment state
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [showAddAppointment, setShowAddAppointment] = useState(false);
  // 스크린샷으로 예약 등록 (2026-11-18 사장님 "스크린샷 예약 해보자"): 타임트리 캡처·카톡 대화 → /api/appointments/from-image → 표 확인 → 등록
  type ShotRow = ImportCandidate & { include: boolean; mode: 'existing' | 'new' };
  const [showShotImport, setShowShotImport] = useState(false);
  const [shotBusy, setShotBusy] = useState(false);
  const [shotRows, setShotRows] = useState<ShotRow[]>([]);
  const [shotHidden, setShotHidden] = useState<{ date: string; count: number }[]>([]);
  const [shotMonth, setShotMonth] = useState<string>(() => todaySeoul().slice(0, 7));
  const shotFileRef = useRef<HTMLInputElement>(null);
  const [appointmentForm, setAppointmentForm] = useState({
    customer_id: '', appointment_date: '', end_date: '', service_type: '', amount: '', memo: '', vehicle_id: '',
  });
  // 예약 추가 창: 고른 고객의 차량 목록 (2026-11-22 차량 N대). 한 대면 자동, 여러 대면 고르게
  const [apptVehicles, setApptVehicles] = useState<Vehicle[]>([]);
  useEffect(() => {
    let alive = true;
    if (!appointmentForm.customer_id) { setApptVehicles([]); return; }
    loadVehicles(appointmentForm.customer_id).then((v) => {
      if (!alive) return;
      setApptVehicles(v);
      const primary = v.find((x) => x.is_primary) || v[0];
      setAppointmentForm((f) => (f.customer_id ? { ...f, vehicle_id: primary ? primary.id : '' } : f));
    });
    return () => { alive = false; };
  }, [appointmentForm.customer_id]);
  // 고객 목록 "외 N대" 표시용
  const [vehiclesByCustomer, setVehiclesByCustomer] = useState<Map<string, Vehicle[]>>(new Map());
  const [calendarView, setCalendarView] = useState<'calendar' | 'list'>('calendar');
  const [managerFilter] = useState<'전체' | '대표' | '이팀장님' | '김막내'>('전체');
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Follow-up state
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [followUpFilter, setFollowUpFilter] = useState<'all' | 'QC점검' | '메인터넌스' | '후기요청' | '견적재연락' | '견적마무리'>('all');
  // 견적 문자 생성 창 (2026-11-11): 전화 상담 뒤 보내는 문자 + 재연락 2회 자동 등록
  const [quoteSms, setQuoteSms] = useState<QuoteSmsInitial | null>(null);
  // 문의 답변 창 (2026-11-12): 카페·문자 문의 글 → 시장 평균가 기준 답장
  const [showInquiry, setShowInquiry] = useState(false);
  // 사후관리 달력·검색 (2026-11-11): 기본은 오늘 보낼 사람만, 검색하면 날짜 무관, 밀린 건은 접어 둠
  const [followSearch, setFollowSearch] = useState('');
  const [followDate, setFollowDate] = useState<string>(() => todaySeoul());
  const [followMonth, setFollowMonth] = useState<{ y: number; m: number }>(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [showOverdue, setShowOverdue] = useState(false);
  // 홈 "오늘 AI가 한 일" (2026-11-12): 사후관리·상담 담당이 준비한 문자를 건마다 보낸다
  const [teamBrief, setTeamBrief] = useState<DailyBrief | null>(null);
  const [teamOpen, setTeamOpen] = useState<string | null>(null);
  // 홈 "이번 주 숫자"·유입경로 표 (2026-11-18): 시트에 손으로 적던 집계를 CRM 기록으로 자동 계산
  const [stats, setStats] = useState<{ weekly: WeeklyStats; table: SourceTable } | null>(null);
  const [statsMonth, setStatsMonth] = useState<string>(() => todaySeoul().slice(0, 7));
  const [statsDays, setStatsDays] = useState(false);
  const fetchStats = useCallback(async (month: string) => {
    try {
      const res = await fetch(`/api/stats?month=${month}`, { cache: 'no-store' });
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
  const [showAddConsultation, setShowAddConsultation] = useState(false);
  // 상담은 아직 고객이 아닌 분이 대부분 → 고객 선택 없이 이름·전화만 적어도 저장 (2026-11-11 사장님 지적)
  const [consultationForm, setConsultationForm] = useState({
    customer_id: '', consultation_date: '', content: '', estimate: '', interested_services: '', memo: '', name: '', phone: '', car: '', photos: [] as string[],
  });
  const [consultPhotoBusy, setConsultPhotoBusy] = useState(false);
  const consultPhotoRef = useRef<HTMLInputElement>(null);
  // 캡처 사진 첨부: 브라우저에서 1600px 이하로 줄여 base64 로 보내면 서버가 Blob 저장 + 이름·전화·차종 읽어 줌
  const handleConsultPhoto = async (file: File | undefined) => {
    if (!file || !/^image\//.test(file.type)) return;
    setConsultPhotoBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const res = await fetch('/api/consult/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: dataUrl.split(',')[1], mediaType: 'image/jpeg', name: file.name }) });
      const j = await res.json();
      if (!res.ok || j.error) { alert(j.error || '사진 업로드 실패'); return; }
      setConsultationForm((f) => ({
        ...f,
        photos: [...f.photos, j.url as string],
        // 비어 있는 칸만 캡처에서 읽은 값으로 채움
        name: f.name || j.name || '',
        phone: f.phone || j.phone || '',
        car: f.car || j.car || '',
      }));
    } catch (e) {
      alert(e instanceof Error ? e.message : '사진 처리 실패');
    } finally {
      setConsultPhotoBusy(false);
      if (consultPhotoRef.current) consultPhotoRef.current.value = '';
    }
  };


  // Work order modal state
  const [showWorkOrder, setShowWorkOrder] = useState(false);
  const [workOrderAppointment, setWorkOrderAppointment] = useState<Appointment | null>(null);

  // Warranty modal state
  const [showWarranty, setShowWarranty] = useState(false);
  const [showCalendarSub, setShowCalendarSub] = useState(false);
  const [warrantyAppointment, setWarrantyAppointment] = useState<Appointment | null>(null);
  const [warrantyForm, setWarrantyForm] = useState({
    date: '', car_type: '', car_number: '', customer_name: '', phone: '',
    work_details: '', warranty_period: '시공일로부터 1년', price: '',
  });
  const [workOrder, setWorkOrder] = useState({
    car_number: '',
    amount: '',
    warranty_issued: false,
    crm_recorded: false,
    tinting: {
      vertex: { selected: [] as string[], density: '' },
      rainbow: { selected: [] as string[], density: '' },
      glasstint: { selected: [] as string[], density: '' },
      tinain: { selected: [] as string[], density: '' },
    },
    ppf: [] as string[],
    wrapping: [] as string[],
    coating: [] as string[],
    electrical: [] as string[],
    electrical_etc: '',
    polish: [] as string[],
    polish_etc: '',
    package_options: [] as string[],
    ppf_etc: '',
    wrapping_etc: '',
    notes: '',
  });


  // Customer picker state (shared)
  const [allCustomers, setAllCustomers] = useState<{ id: string; name: string; phone: string | null; car_brand?: string | null; car_model?: string | null; car_color?: string | null }[]>([]);
  const [customerPickerSearch, setCustomerPickerSearch] = useState('');

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
    const { data } = await supabase.from('customers').select('id, name, phone, car_brand, car_model, car_color').order('name');
    if (data) setAllCustomers(data);
  }, []);

  const fetchAppointments = useCallback(async () => {
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
  }, [activeTab, fetchCustomers, fetchAppointments, fetchFollowUps, fetchConsultations]);

  // ─── Customer Actions ───────────────────────────────────
  const handleAddCustomer = async () => {
    if (!customerForm.name.trim()) return;

    // 폼 값을 먼저 로컬 변수로 복사
    const formData = { ...customerForm };

    console.log('[CRM] === 고객 등록 시작 ===');
    console.log('[CRM] formData:', JSON.stringify(formData));

    // 0. 같은 전화번호의 고객이 이미 있으면 새 기록을 만들지 않고 그 분께 차량만 추가 (2026-11-22 사장님 "기존 고객인데 차종이 다르면 알아서 통합되나?")
    //    같은 번호를 쓰는 다른 사람(가족)일 수도 있어 한 번 묻는다. "아니요"면 예전처럼 새 기록
    let customerId: string | undefined;
    let mergedVehicleId: string | null = null;
    const phoneDigits = (formData.phone || '').replace(/\D/g, '');
    if (phoneDigits.length >= 10) {
      const { data: candidates } = await supabase.from('customers').select('id, name, phone, car_brand, car_model, memo').order('created_at', { ascending: true });
      const same = (candidates || []).find((c) => ((c.phone as string | null) || '').replace(/\D/g, '') === phoneDigits);
      if (same) {
        const existingCar = [same.car_brand, same.car_model].filter(Boolean).join(' ') || '차종 없음';
        const newCar = [formData.car_brand, formData.car_model].filter(Boolean).join(' ').trim();
        const ok = confirm(`같은 전화번호로 ${same.name} 고객님(${existingCar})이 이미 등록되어 있습니다.\n같은 분이면 새 기록을 만들지 않고 ${newCar ? `차량 "${newCar}"을(를) 그 분께 추가하고 ` : ''}예약도 그 분 이름으로 잡습니다.\n\n같은 분인가요? (취소 = 다른 사람이라 새 기록으로 등록)`);
        if (ok) {
          customerId = same.id as string;
          if (newCar) {
            const existingVehicles = await loadVehicles(customerId);
            const dup = existingVehicles.find((v) => (v.brand || '') === (formData.car_brand || '') && (v.model || '') === (formData.car_model || ''));
            const v = dup || await addVehicle(customerId, { brand: formData.car_brand || null, model: formData.car_model || null, year: formData.car_year || null, color: formData.car_color || null });
            mergedVehicleId = v?.id || null;
          }
          if (formData.memo) await supabase.from('customers').update({ memo: [same.memo || '', formData.memo].filter(Boolean).join('\n') }).eq('id', customerId);
          if (formData.source && formData.source !== '소개/재방문') { /* 유입경로는 첫 기록 것을 유지 */ }
          console.log('[CRM] 기존 고객에 합침:', customerId, '차량', mergedVehicleId);
        }
      }
    }

    // 1. 고객 등록 (기존 고객에 합친 경우는 건너뜀)
    const { data: insertData, error: insertError } = customerId ? { data: { id: customerId } as { id: string }, error: null } : await supabase
      .from('customers')
      .insert({
        name: formData.name,
        phone: formData.phone || null,
        car_brand: formData.car_brand || null,
        car_model: formData.car_model || null,
        car_year: formData.car_year || null,
        car_color: formData.car_color || null,
        source: formData.source || null,
        memo: formData.memo || null,
      })
      .select()
      .single();

    console.log('[CRM] customer insert result:', JSON.stringify(insertData), JSON.stringify(insertError));
    if (insertData?.id && !mergedVehicleId && !customerId) ensurePrimaryVehicle(insertData.id as string, { brand: formData.car_brand || null, model: formData.car_model || null, year: formData.car_year || null, color: formData.car_color || null }); // 차량 N대 (2026-11-22)

    customerId = customerId || insertData?.id;

    if (!customerId) {
      const { data: found } = await supabase
        .from('customers')
        .select('id')
        .eq('name', formData.name)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      customerId = found?.id;
      console.log('[CRM] fallback id:', customerId);
    }

    if (!customerId) {
      alert('고객 등록 실패');
      return;
    }

    console.log('[CRM] customerId:', customerId);
    // 멤버십(2026-11-18): 소개한 분이 골라져 있으면 연결하고 감사 문자 제안
    if (customerReferrerId) {
      const refErr = await linkReferral(customerId, customerReferrerId);
      if (refErr) alert(refErr);
      else {
        const ref = allCustomers.find((c) => c.id === customerReferrerId);
        if (ref?.phone && confirm(`${ref.name} 님께 소개 감사 문자를 보낼까요?`)) { openSmsApp(ref.phone, MEMBERSHIP.thanksSms(ref.name, formData.name)); markThanksSent(customerId); }
      }
      setCustomerReferrerId(null);
    }
    console.log('[CRM] appointment_start_date:', formData.appointment_start_date);
    console.log('[CRM] appointment_service_type:', formData.appointment_service_type);

    // 2. 예약 생성
    let appointmentForWorkOrder: Appointment | null = null;
    const hasDateAndType = !!(formData.appointment_start_date && formData.appointment_service_type);

    const apptAmount = formData.appointment_amount ? Number(formData.appointment_amount) : null;

    if (hasDateAndType) {
      const { data: apptData, error: apptError } = await supabase
        .from('appointments')
        .insert({
          customer_id: customerId,
          appointment_date: formData.appointment_start_date,
          end_date: formData.appointment_end_date || null,
          service_type: formData.appointment_service_type,
          status: '예약확정',
          amount: apptAmount,
          memo: formData.appointment_memo || null,
          ...(mergedVehicleId ? { vehicle_id: mergedVehicleId } : {}),
        })
        .select()
        .single();

      console.log('[CRM] appointment result:', JSON.stringify(apptData), JSON.stringify(apptError));

      if (apptData) {
        appointmentForWorkOrder = {
          ...apptData,
          customer: { name: formData.name, phone: formData.phone || null },
        } as Appointment;
      }
    } else if (formData.appointment_start_date) {
      await supabase.from('appointments').insert({
        customer_id: customerId,
        appointment_date: formData.appointment_start_date,
        end_date: formData.appointment_end_date || null,
        service_type: null,
        status: '상담중',
        amount: apptAmount,
        memo: formData.appointment_memo || null,
        ...(mergedVehicleId ? { vehicle_id: mergedVehicleId } : {}),
      });
      closeQuoteFollowUpsFor(customerId, formData.phone).then((n) => { if (n) fetchFollowUps(); }); // 2026-11-22
    }

    // 2.5. Notion에 예약 일정 동기화 (fire-and-forget)
    if (formData.appointment_start_date) {
      fetch('/api/notion/appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: formData.name,
          serviceType: formData.appointment_service_type || null,
          appointmentDate: formData.appointment_start_date,
          endDate: formData.appointment_end_date || null,
          status: hasDateAndType ? '예약확정' : '상담중',
          memo: formData.appointment_memo || null,
        }),
      })
        .then(async (res) => { const r = await res.json(); console.log('[CRM] Notion 예약 동기화:', res.ok ? r.pageId : r); })
        .catch((err) => console.warn('[CRM] Notion 예약 동기화 실패:', err));
    }

    // 2.6. Notion에 고객 정보 동기화 (fire-and-forget)
    const notionPayload = {
      name: formData.name,
      phone: formData.phone || null,
      car_brand: formData.car_brand || null,
      car_model: formData.car_model || null,
      service_type: formData.appointment_service_type || null,
      appointment_date: formData.appointment_start_date || null,
      status: hasDateAndType ? '예약확정' : formData.appointment_start_date ? '상담중' : null,
      memo: formData.memo || null,
    };
    console.log('[CRM] Notion 동기화 요청:', JSON.stringify(notionPayload));
    fetch('/api/notion/customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notionPayload),
    })
      .then(async (res) => {
        const result = await res.json();
        if (res.ok) {
          console.log('[CRM] Notion 동기화 완료:', result.pageId);
        } else {
          console.warn('[CRM] Notion 동기화 실패:', result);
        }
      })
      .catch((err) => console.warn('[CRM] Notion 요청 실패:', err));

    // 3. 폼 리셋 + 모달 닫기
    setCustomerForm({ name: '', phone: '', car_brand: '', car_model: '', car_year: '', car_color: '', source: '', memo: '', appointment_start_date: '', appointment_end_date: '', appointment_service_type: '', appointment_amount: '', appointment_memo: '' });
    setShowAddCustomer(false);
    fetchCustomers();
    fetchAllCustomers();
    fetchAppointments();

    // 4. .ics 캘린더 파일 자동 다운로드
    if (formData.appointment_start_date && appointmentForWorkOrder) {
      handleDownloadICS(appointmentForWorkOrder);
    }

    // 5. 작업 내역서 모달 또는 알림
    if (hasDateAndType && appointmentForWorkOrder) {
      console.log('[CRM] 작업 내역서 모달 열기!');
      resetWorkOrder();
      setWorkOrderAppointment(appointmentForWorkOrder);
      setTimeout(() => setShowWorkOrder(true), 200);
    } else if (formData.appointment_start_date) {
      alert('고객 등록 + 예약 완료 (캘린더 일정이 다운로드되었습니다)');
    } else {
      alert('고객 등록 완료');
    }
  };

  const generateICS = (appointment: Appointment): string => {
    const start = appointment.appointment_date.replace(/-/g, '');
    const endDate = appointment.end_date || appointment.appointment_date;
    const endNext = new Date(endDate + 'T00:00:00+09:00');
    endNext.setDate(endNext.getDate() + 1);
    const end = toSeoulISO(endNext).replace(/-/g, '');
    const name = appointment.customer?.name || '고객';
    const phone = appointment.customer?.phone || '';
    const serviceType = appointment.service_type || '시공';
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//3M PROIZM//CRM//KO',
      'BEGIN:VEVENT',
      `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:[프로이즘] ${name} - ${serviceType}`,
      `DESCRIPTION:고객: ${name}\\n연락처: ${phone}\\n시공: ${serviceType}${appointment.memo ? '\\n메모: ' + appointment.memo.replace(/\n/g, '\\n') : ''}`,
      'LOCATION:서울시 서초구 서초중앙로8길 82\\, 1동 1층 3M 프로이즘',
      `UID:${appointment.id}@proism-crm`,
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
  };

  // 홈 탭 '연락할 사후관리'에서 문자 보내기: 유형별 문구, 보냈다고 하면 보낸 표시
  const handleHomeFollowSms = async (f: FollowUp) => {
    const memoPhone = (f.memo || '').split('\n')[0].match(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/)?.[0] || '';
    const phone = f.customer?.phone || memoPhone;
    if (!phone) { alert('전화번호가 없는 고객입니다.'); return; }
    const t = f.follow_up_type;
    const msg = t === 'QC점검' ? QC_SMS : t === '메인터넌스' ? MAINT_SMS : t === '후기요청' ? REVIEW_SMS.proism : (f.memo || '').split('\n').slice(1).join('\n') || `안녕하세요 3M 프로이즘 대표 진준호입니다.\n${f.memo || ''}`;
    const key = t === 'QC점검' ? 'qc' : t === '메인터넌스' ? 'maintenance' : t === '후기요청' ? 'proism' : 'quote';
    openSmsApp(phone, msg);
    if (!confirm('문자를 전송하셨나요?')) return;
    await supabase.from('follow_ups').update({ sms_sent: { ...(f.sms_sent || {}), [key]: true } }).eq('id', f.id);
    fetchFollowUps();
  };
  // 홈 "오늘 AI가 한 일"에서 준비된 문자 보내기 (건마다 개별 전송, 2026-11-12 사장님 결정)
  const handleTeamSms = async (item: TeamItem) => {
    openSmsApp(item.phone, item.message);
    if (!confirm('문자를 전송하셨나요?')) return;
    const { data } = await supabase.from('follow_ups').select('sms_sent').eq('id', item.followUpId).single();
    await supabase.from('follow_ups').update({ sms_sent: { ...((data?.sms_sent as Record<string, boolean> | null) || {}), [item.smsKey]: true } }).eq('id', item.followUpId);
    fetchFollowUps();
    fetchTeamBrief();
  };
  // 예약/일정 상세 줄에서 후기 요청 문자 (프로이즘·아우디·BMW). 보냈다고 하면 그 고객의 후기요청 사후관리에도 보낸 표시
  const handleReviewSmsFromAppointment = async (a: Appointment, key: 'proism' | 'bmw' | 'audi') => {
    const phone = a.customer?.phone;
    if (!phone) return;
    openSmsApp(phone, REVIEW_SMS[key]);
    if (!confirm('문자를 전송하셨나요?')) return;
    const { data } = await supabase.from('follow_ups').select('id, sms_sent').eq('customer_id', a.customer_id).eq('follow_up_type', '후기요청').eq('is_completed', false);
    for (const f of data || []) {
      await supabase.from('follow_ups').update({ sms_sent: { ...((f.sms_sent as Record<string, boolean> | null) || {}), [key]: true } }).eq('id', f.id);
    }
    // 후기요청 사후관리가 없으면(완료 전에 보낸 경우 등) 하나 만들어 보낸 표시를 남긴다 (2026-11-18 사장님: 보낸 뒤 표시가 없어 헷갈림)
    if (!data || data.length === 0) {
      await supabase.from('follow_ups').insert({ customer_id: a.customer_id, follow_up_type: '후기요청', scheduled_date: todaySeoul(), memo: `${a.service_type || '시공'} 후기 요청 (예약 줄에서 보냄)`, sms_sent: { [key]: true } });
    }
    fetchFollowUps();
  };
  /** 이 예약 고객의 후기요청 사후관리에서 보낸 문자 종류를 모은다 (예약 줄 후기 버튼의 ✓ 표시용) */
  const reviewSentFor = (customerId: string): Record<string, boolean> => {
    const out: Record<string, boolean> = {};
    for (const f of followUps) if (f.customer_id === customerId && f.follow_up_type === '후기요청') Object.assign(out, f.sms_sent || {});
    return out;
  };
  const handleDownloadICS = (appointment: Appointment) => {
    const ics = generateICS(appointment);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `프로이즘_예약_${appointment.customer?.name || '고객'}_${appointment.appointment_date}.ics`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const hasWarrantyIssued = (memo: string | null): boolean => {
    if (!memo) return false;
    try { const p = JSON.parse(memo); return !!(p?.warranty_issued || p?.warranty); } catch { return false; }
  };

  const customerHasWarranty = (customerId: string): boolean => {
    return appointments.some((a) => a.customer_id === customerId && hasWarrantyIssued(a.memo));
  };

  const filteredCustomers = customers.filter((c) => {
    const q = customerSearch.toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      (c.car_brand?.toLowerCase().includes(q)) ||
      (c.car_model?.toLowerCase().includes(q)) ||
      (vehiclesByCustomer.get(c.id) || []).some((v) => `${v.brand || ''} ${v.model || ''} ${v.plate || ''}`.toLowerCase().includes(q)) // 두 번째 차로도 찾기 (2026-11-22)
    );
  });

  const handleDeleteCustomer = async (id: string, name: string) => {
    if (!confirm(`"${name}" 고객을 정말 삭제하시겠습니까?\n관련 예약, 시공, 상담, 사후관리도 모두 삭제됩니다.`)) return;
    await supabase.from('customers').delete().eq('id', id);
    fetchCustomers();
    fetchAllCustomers();
  };

  const handleEditCustomer = async (customer: Customer) => {
    // 공용 창: 고객 + 최근 예약을 한 번에 읽는다 (CustomerFormModal)
    const loaded = await loadCustomerForm(customer.id);
    if (!loaded) { alert('고객 정보를 불러오지 못했습니다'); return; }
    setCustomerForm(loaded.form);
    setEditLatestApptId(loaded.latestApptId);
    const refs = await loadReferralsFor(customer.id);
    setCustomerReferrerId(refs.receivedFrom?.referrer_id ?? null);
    setEditCustomerId(customer.id);
    setShowAddCustomer(true);
  };

  // 예약 줄에서 바로 고객 정보 수정 (2026-11-18 사장님: 타임트리에서 가져온 임시 고객의 이름·전화를 달력에서 채우려고)
  const handleEditCustomerFromAppointment = async (a: Appointment) => {
    if (!a.customer_id) return;
    const { data, error } = await supabase.from('customers').select('*').eq('id', a.customer_id).single();
    if (error || !data) { alert('고객 정보를 불러오지 못했습니다'); return; }
    await handleEditCustomer(data as Customer);
  };

  const handleUpdateCustomer = async () => {
    if (!editCustomerId) return;
    const err = await saveCustomerEdit(editCustomerId, customerForm, editLatestApptId);
    if (err) { alert(err); return; }
    if (customerReferrerId && customerForm.source === '소개/재방문') { const refErr = await linkReferral(editCustomerId, customerReferrerId); if (refErr) alert(refErr); }
    setCustomerReferrerId(null);
    setCustomerForm({ ...EMPTY_CUSTOMER_FORM });
    setEditCustomerId(null);
    setEditLatestApptId(null);
    setShowAddCustomer(false);
    fetchCustomers();
    fetchAllCustomers();
    fetchAppointments();
  };

  // 스크린샷 읽기: 브라우저에서 2000px 이하로 줄여 보내면 서버가 일정을 뽑고 고객·기존 예약과 맞춰 준다
  const handleShotFile = async (file: File | undefined | null) => {
    if (!file || !/^image\//.test(file.type)) return;
    setShotBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      const res = await fetch('/api/appointments/from-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: dataUrl.split(',')[1], mediaType: 'image/jpeg', baseMonth: shotMonth }) });
      const j = await res.json();
      if (!res.ok || j.error) { alert(j.error || '스크린샷을 읽지 못했습니다'); return; }
      const rows = ((j.candidates || []) as ImportCandidate[]).map((c): ShotRow => ({ ...c, include: !c.duplicateOf, mode: c.customerId ? 'existing' : 'new' }));
      setShotRows((prev) => [...prev, ...rows]);
      setShotHidden((prev) => [...prev, ...((j.hidden || []) as { date: string; count: number }[])]);
      if (j.month) setShotMonth(j.month);
      if (rows.length === 0) alert('이 이미지에서 일정을 찾지 못했습니다');
    } catch (e) {
      alert('스크린샷 읽기 실패: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setShotBusy(false);
      if (shotFileRef.current) shotFileRef.current.value = '';
    }
  };
  const updateShotRow = (key: string, patch: Partial<ShotRow>) => setShotRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const handleShotRegister = async () => {
    const rows = shotRows.filter((r) => r.include && /^\d{4}-\d{2}-\d{2}$/.test(r.start));
    if (rows.length === 0) return;
    setShotBusy(true);
    let made = 0, newCus = 0;
    const createdByName = new Map<string, string>(); // 같은 새 고객 이름이 두 줄이면 한 명만 만든다
    try {
      for (const r of rows) {
        let customerId = r.mode === 'existing' ? r.customerId : null;
        if (!customerId) {
          const name = (r.newCustomerName || '').trim() || `${r.car || '차량'} 고객`;
          customerId = createdByName.get(name) || null;
          if (!customerId) {
            const { data: c, error } = await supabase.from('customers').insert({ name, phone: r.phone || null, car_brand: r.brand || null, car_model: r.car || null, memo: `스크린샷 일정에서 가져온 고객(${todaySeoul()}). 전화·유입경로를 채워 주세요` }).select('id').single();
            if (error || !c) { alert(`${name} 고객 등록 실패: ${error?.message || ''}`); continue; }
            customerId = c.id as string; createdByName.set(name, customerId); newCus++;
            ensurePrimaryVehicle(customerId, { brand: r.brand || null, model: r.car || null });
          }
        }
        const memo = [r.label, r.time, r.note].filter(Boolean).join(' · ') + ` · 스크린샷에서 가져옴 ${todaySeoul()}`;
        const { error: e2 } = await supabase.from('appointments').insert({ customer_id: customerId, appointment_date: r.start, end_date: r.end || null, service_type: r.service || null, status: r.status, memo });
        if (e2) alert(`${r.label} 등록 실패: ${e2.message}`); else { made++; await closeQuoteFollowUpsFor(customerId, r.phone || null); } // 예약 잡히면 견적 재연락 닫기 (2026-11-22)
      }
      alert(`예약 ${made}건을 등록했습니다${newCus ? `. 새 고객 ${newCus}명은 이름·전화를 채워 주세요` : ''}`);
      setShowShotImport(false); setShotRows([]); setShotHidden([]);
      fetchAppointments(); fetchAllCustomers(); fetchCustomers();
    } finally {
      setShotBusy(false);
    }
  };

  const handleDeleteAppointment = async (id: string) => {
    if (!confirm('이 예약을 정말 삭제하시겠습니까?')) return;
    await supabase.from('appointments').delete().eq('id', id);
    fetchAppointments();
  };

  // ─── Appointment Actions ────────────────────────────────
  const handleAddAppointment = async () => {
    if (!appointmentForm.customer_id || !appointmentForm.appointment_date) return;
    await supabase.from('appointments').insert({
      customer_id: appointmentForm.customer_id,
      appointment_date: appointmentForm.appointment_date,
      end_date: appointmentForm.end_date || null,
      service_type: appointmentForm.service_type || null,
      amount: appointmentForm.amount ? Number(appointmentForm.amount) : null,
      memo: appointmentForm.memo || null,
      ...(appointmentForm.vehicle_id ? { vehicle_id: appointmentForm.vehicle_id } : {}), // 차량 표가 있을 때만 값이 생긴다
    });
    // 예약이 잡혔으니 이 손님의 열린 견적 재연락·마무리는 닫는다 (2026-11-22)
    closeQuoteFollowUpsFor(appointmentForm.customer_id, allCustomers.find((c) => c.id === appointmentForm.customer_id)?.phone).then((n) => { if (n) fetchFollowUps(); });
    // QC·메인터넌스를 직접 골랐으면 그 손님의 열린 같은 유형 사후관리에 묶고 날짜도 방문일로 (2026-11-22)
    if (CARE_VISIT_TYPES.includes(appointmentForm.service_type)) {
      const { data: openFu } = await supabase.from('follow_ups').select('id').eq('customer_id', appointmentForm.customer_id).eq('follow_up_type', appointmentForm.service_type).eq('is_completed', false).order('scheduled_date', { ascending: true }).limit(1);
      const fid = (openFu || [])[0]?.id as string | undefined;
      if (fid) {
        const { data: justMade } = await supabase.from('appointments').select('id, memo').eq('customer_id', appointmentForm.customer_id).eq('appointment_date', appointmentForm.appointment_date).eq('service_type', appointmentForm.service_type).order('created_at', { ascending: false }).limit(1);
        const ap = (justMade || [])[0];
        if (ap) { const { error } = await supabase.from('appointments').update({ follow_up_id: fid }).eq('id', ap.id); if (error) await supabase.from('appointments').update({ memo: `${ap.memo || ''} · 사후관리:${fid}`.replace(/^ · /, '') }).eq('id', ap.id); }
        await supabase.from('follow_ups').update({ scheduled_date: appointmentForm.appointment_date }).eq('id', fid);
        fetchFollowUps();
      }
    }

    // Notion 예약 일정 동기화 (fire-and-forget)
    const apptCustomer = allCustomers.find((c) => c.id === appointmentForm.customer_id);
    if (apptCustomer) {
      fetch('/api/notion/appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: apptCustomer.name,
          serviceType: appointmentForm.service_type || null,
          appointmentDate: appointmentForm.appointment_date,
          endDate: appointmentForm.end_date || null,
          status: appointmentForm.service_type ? '예약확정' : '상담중',
          memo: appointmentForm.memo || null,
        }),
      })
        .then(async (res) => { const r = await res.json(); console.log('[CRM] Notion 예약 동기화:', res.ok ? r.pageId : r); })
        .catch((err) => console.warn('[CRM] Notion 예약 동기화 실패:', err));
    }

    setAppointmentForm({ customer_id: '', appointment_date: '', end_date: '', service_type: '', amount: '', memo: '', vehicle_id: '' });
    setShowAddAppointment(false);
    fetchAppointments();
  };

  const resetWorkOrder = () => setWorkOrder({
    car_number: '', amount: '', warranty_issued: false, crm_recorded: false,
    tinting: {
      vertex: { selected: [], density: '' }, rainbow: { selected: [], density: '' },
      glasstint: { selected: [], density: '' }, tinain: { selected: [], density: '' },
    },
    ppf: [], wrapping: [], coating: [], electrical: [], electrical_etc: '',
    polish: [], polish_etc: '', package_options: [], ppf_etc: '', wrapping_etc: '', notes: '',
  });

  const handleStatusChange = async (appointment: Appointment, newStatus: string) => {
    // 완료 변경 시 작업 내역서 모달 표시 (기존 데이터 불러오기). 리터치는 작업 내역서 대신 리터치 완료 창
    if (newStatus === '완료') {
      if (appointment.service_type === RETOUCH_TYPE) handleOpenRetouch(appointment);
      else if (CARE_VISIT_TYPES.includes(appointment.service_type || '')) handleOpenCareVisit(appointment);
      else handleOpenWorkOrder(appointment);
      return;
    }

    await supabase.from('appointments').update({ status: newStatus }).eq('id', appointment.id);
    fetchAppointments();
  };

  // 이중 제출 가드 (2026-11-22): "시공 완료 처리"를 두 번 누르면(더블 클릭) 같은 초에 시공 기록·사후관리가 두 벌 생겼음(김수희 외 4쌍). 처리 중엔 버튼을 잠그고 두 번째 호출은 버린다
  const workOrderSubmitting = useRef(false);
  const [workOrderBusy, setWorkOrderBusy] = useState(false);
  const handleWorkOrderSubmit = async () => {
    if (workOrderSubmitting.current) return;
    workOrderSubmitting.current = true;
    setWorkOrderBusy(true);
    try { await doWorkOrderSubmit(); } finally { workOrderSubmitting.current = false; setWorkOrderBusy(false); }
  };

  const doWorkOrderSubmit = async () => {
    if (!workOrderAppointment) return;
    const appointment = workOrderAppointment;
    // 완료일 = 출고일(예약 종료일, 없으면 예약일). 버튼 누른 날이 아니다 (2026-11-22: 11/13 출고 차의 QC 가 12/6, 메인터넌스가 5/22 로 잡혔던 일 — 완료 처리를 11/22 에 눌렀기 때문)
    // 아직 끝나지 않은 예약을 미리 완료하면 오늘
    const completionDate = (() => { const end = appointment.end_date || appointment.appointment_date; const today = todaySeoul(); return end && end < today ? end : today; })();

    // 빠진 칸 한 번 묻기 (2026-11-22 사장님): 차량번호·금액·PPF 제품·썬팅 농도가 비면 회원 페이지 증명서 제품 줄과 월말 숫자가 비어 나온다
    {
      const wo = workOrder as WorkOrderJson & { amount?: string };
      const missing: string[] = [];
      if (!wo.car_number?.trim()) missing.push('차량번호');
      if (!(wo.amount && Number(wo.amount) > 0) && !appointment.amount) missing.push('금액');
      if ((wo.ppf || []).length > 0 && !ppfProduct(wo.ppf_etc)) missing.push('PPF 제품(기타 칸에 50·100·150·PRO200)');
      const tintNoDensity = Object.values(wo.tinting || {}).some((t) => (t?.selected || []).length > 0 && !t?.density?.trim());
      if (tintNoDensity) missing.push('썬팅 농도');
      if (missing.length > 0 && !confirm(`작업 내역서에 빠진 칸이 있습니다.\n- ${missing.join('\n- ')}\n\n빠진 채로 완료할까요? (취소하면 채우러 돌아갑니다)`)) return;
    }

    // 기존 memo에서 warranty 관련 데이터 보존
    let existingExtra: Record<string, unknown> = {};
    if (appointment.memo) {
      try {
        const parsed = JSON.parse(appointment.memo);
        if (parsed?.warranty) existingExtra.warranty = parsed.warranty;
        if (parsed?.warranty_issued) existingExtra.warranty_issued = parsed.warranty_issued;
      } catch { /* ignore */ }
    }
    const finalAmount = workOrder.amount ? Number(workOrder.amount) : (appointment.amount || null);

    // 회원 등록 = 보증서 발급 (2026-11-19 사장님 "멤버십 따로 보증서 따로가 아니라, 등록하면 자연스럽게 보증서까지")
    // 완료 저장과 동시에 warranty 를 작업 내역서에서 채우고 warranty_issued 로 표시 → 회원 페이지 시공 증명서에 바로 뜬다. 보증서 창(PNG)은 그대로 쓸 수 있음
    const { data: cust } = await supabase.from('customers').select('name, phone, car_brand, car_model').eq('id', appointment.customer_id).single();
    const memoObj: Record<string, unknown> = { ...workOrder, ...existingExtra };
    if (!memoObj.warranty) {
      memoObj.warranty = {
        date: appointment.appointment_date, customer_name: cust?.name || appointment.customer?.name || '', phone: cust?.phone || appointment.customer?.phone || '',
        car_type: (appointment.vehicle && vehicleLabel(appointment.vehicle)) || [cust?.car_brand, cust?.car_model].filter(Boolean).join(' '), car_number: workOrder.car_number || '',
        work_details: workDetailsText(workOrder as WorkOrderJson, appointment.service_type || '시공'), warranty_period: '시공일로부터 1년',
        price: finalAmount ? `₩${Number(finalAmount).toLocaleString()}` : '',
      };
    }
    memoObj.warranty_issued = true;
    const mergedMemo = JSON.stringify(memoObj);

    // 시공 이력 생성 (작업 내역서 데이터를 memo에 JSON으로 저장)
    // film_used·service_area 도 작업 내역서에서 채운다 (2026-11-22: 그동안 67건 중 4건만 채워져 회원 페이지 시공 줄에 제품이 비어 있었음)
    const woItems = workItems(workOrder as WorkOrderJson);
    const filmUsed = woItems.map((i) => i.product).filter(Boolean).join(' / ') || null;
    const serviceArea = woItems.map((i) => `${i.group} ${i.text}`).join(' / ').slice(0, 200) || null;

    // 같은 예약을 다시 완료 처리하면(내역 고치려고 다시 누르는 경우) 시공 기록을 새로 만들지 않고 기존 줄만 갱신한다 (2026-11-22)
    // 기준: 같은 고객·같은 시공일·같은 시공 종류. 사후관리·회원 문자·포인트는 처음 완료 때 이미 처리됐으므로 건너뛴다
    {
      const { data: existing } = await supabase.from('services').select('id').eq('customer_id', appointment.customer_id)
        .eq('service_date', appointment.appointment_date).eq('service_type', appointment.service_type || '기타').order('created_at', { ascending: true }).limit(1);
      const prev = existing && existing.length > 0 ? existing[0] : null;
      if (prev) {
        await supabase.from('services').update({ amount: finalAmount, film_used: filmUsed, service_area: serviceArea, memo: mergedMemo }).eq('id', prev.id);
        await supabase.from('appointments').update({ status: '완료', memo: mergedMemo }).eq('id', appointment.id);
        setShowWorkOrder(false);
        setWorkOrderAppointment(null);
        fetchAppointments();
        fetchFollowUps();
        alert('이미 완료 처리된 시공이라 작업 내역만 갱신했습니다. 사후관리 일정은 그대로입니다.');
        return;
      }
    }
    let { data: service } = await supabase
      .from('services')
      .insert({
        customer_id: appointment.customer_id,
        service_type: appointment.service_type || '기타',
        service_date: appointment.appointment_date,
        completion_date: completionDate,
        amount: finalAmount,
        film_used: filmUsed,
        service_area: serviceArea,
        memo: mergedMemo,
        ...(appointment.vehicle_id ? { vehicle_id: appointment.vehicle_id } : {}),
      })
      .select()
      .single();
    if (!service) {
      // DB 제약(docs/시공기록-한예약당-한줄-제약.sql)에 걸렸거나 동시에 두 번 들어온 경우: 방금 생긴 줄을 찾아 그걸 쓴다 → 절대 두 줄이 되지 않는다
      const { data: again } = await supabase.from('services').select('*').eq('customer_id', appointment.customer_id)
        .eq('service_date', appointment.appointment_date).eq('service_type', appointment.service_type || '기타').order('created_at', { ascending: true }).limit(1);
      service = again && again.length > 0 ? again[0] : null;
    }

    fillPlateIfEmpty(appointment.vehicle_id, workOrder.car_number); // 작업 내역서의 차량번호를 그 차에 적어 둔다
    // 사후관리 자동 생성 (시공 기록당 한 벌만 — createAutoFollowUps 안에서 이미 있는 유형은 건너뜀)
    if (service && appointment.service_type) {
      const hasPpf = (workOrder.ppf || []).length > 0 || !!workOrder.ppf_etc?.trim();
      await createAutoFollowUps(service.id, appointment.customer_id, appointment.service_type, completionDate, hasPpf);
    }

    // 예약 상태 완료로 변경 + memo 보존
    await supabase.from('appointments').update({ status: '완료', memo: mergedMemo }).eq('id', appointment.id);

    // 회원 페이지 링크(시공 증명서·보증·관리 일정) 문자 — 보증서 전달을 이 문자 하나로
    const custName = cust?.name || appointment.customer?.name || '고객';
    const custPhone = cust?.phone || appointment.customer?.phone || '';
    const link = await getOrCreateMemberLink(appointment.customer_id);
    if ('url' in link && custPhone && confirm(`${custName} 고객님을 회원으로 등록하고 보증서를 발급했습니다.\n시공 증명서·보증·관리 일정이 담긴 회원 페이지 링크를 문자로 보낼까요?`)) {
      openSmsApp(custPhone, memberLinkSms(custName, link.url));
      await supabase.from('consultations').insert({ customer_id: appointment.customer_id, consultation_date: todaySeoul(), content: `[회원 문자] 회원 등록·보증서 발급 링크\n${link.url}`, memo: '회원 문자' });
    }

    // 소개 포인트 (2026-11-19): 이 손님이 소개받고 온 분이면 소개한 분에게 1포인트 (소개 1건당 한 번)
    const granted = await grantPointForReferred(appointment.customer_id);
    if (granted) {
      const pts = await loadPoints(granted.referrerId);
      const { data: refc } = await supabase.from('customers').select('phone').eq('id', granted.referrerId).maybeSingle();
      const refPhone = (refc?.phone as string | null) || '';
      if (refPhone && confirm(`${granted.referrerName} 고객님(소개한 분)께 소개 포인트 1점을 적립했습니다 (지금 ${pts.balance}점).\n감사 문자를 보낼까요?`)) {
        openSmsApp(refPhone, `${MEMBERSHIP.thanksSms(granted.referrerName, granted.referredName)}\n${POINTS.smsLine(pts.balance)}`);
        await markThanksSent(appointment.customer_id);
        await supabase.from('consultations').insert({ customer_id: granted.referrerId, consultation_date: todaySeoul(), content: `[회원 문자] 소개 감사 + 포인트 적립 (${granted.referredName} 님 시공 완료, 잔액 ${pts.balance}점)`, memo: '회원 문자' });
      }
    }

    // Notion 시공 기록 + QC/메인터넌스 리마인더 동기화 (fire-and-forget)
    const customerName = appointment.customer?.name || '고객';
    const notionSync = async () => {
      try {
        // 시공 기록
        const svcRes = await fetch('/api/notion/service', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerName, carModel: null,
            service: appointment.service_type || '기타',
            serviceDate: appointment.appointment_date,
            amount: workOrder.amount ? Number(workOrder.amount) : (appointment.amount || null),
            status: '완료',
          }),
        });
        const svcResult = await svcRes.json();
        console.log('[CRM] Notion 시공 기록:', svcRes.ok ? svcResult.pageId : svcResult);

        // QC 알림: +2주
        const qcDate = new Date(completionDate + 'T00:00:00+09:00');
        qcDate.setDate(qcDate.getDate() + 14);
        const qcDateStr = toSeoulISO(qcDate);
        await fetch('/api/notion/appointment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerName, serviceType: appointment.service_type || '기타',
            appointmentDate: qcDateStr, status: '예정',
            memo: `QC 점검 - ${customerName} (시공완료: ${completionDate})`,
          }),
        });
        console.log('[CRM] Notion QC 알림 등록:', qcDateStr);

        // 메인터넌스 알림: +6개월
        const mtDate = new Date(completionDate + 'T00:00:00+09:00');
        mtDate.setMonth(mtDate.getMonth() + 6);
        const mtDateStr = toSeoulISO(mtDate);
        await fetch('/api/notion/appointment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerName, serviceType: appointment.service_type || '기타',
            appointmentDate: mtDateStr, status: '예정',
            memo: `메인터넌스 - ${customerName} (시공완료: ${completionDate})`,
          }),
        });
        console.log('[CRM] Notion 메인터넌스 알림 등록:', mtDateStr);

        // 포트폴리오 자동 생성
        const carInfo = appointment.customer ? [appointment.customer.name] : [];
        await fetch('/api/notion/portfolio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            carModel: null,
            service: appointment.service_type || '기타',
            serviceDate: completionDate,
            description: `${customerName} 차량 ${appointment.service_type || ''} 시공 완료`,
          }),
        });
        console.log('[CRM] Notion 포트폴리오 등록 완료');
      } catch (err) { console.warn('[CRM] Notion 동기화 실패:', err); }
    };
    notionSync();

    setShowWorkOrder(false);
    setWorkOrderAppointment(null);
    fetchAppointments();
    fetchFollowUps();
  };

  const handleWorkOrderSaveOnly = async () => {
    if (!workOrderAppointment) return;
    // 기존 memo에서 warranty 관련 데이터 보존
    let existingExtra: Record<string, unknown> = {};
    if (workOrderAppointment.memo) {
      try {
        const parsed = JSON.parse(workOrderAppointment.memo);
        if (parsed?.warranty) existingExtra.warranty = parsed.warranty;
        if (parsed?.warranty_issued) existingExtra.warranty_issued = parsed.warranty_issued;
      } catch { /* ignore */ }
    }
    const merged = { ...workOrder, ...existingExtra };
    if (workOrderAppointment.id) {
      await supabase.from('appointments')
        .update({ memo: JSON.stringify(merged), status: '예약확정' })
        .eq('id', workOrderAppointment.id);
    }
    setShowWorkOrder(false);
    setWorkOrderAppointment(null);
    fetchAppointments();
  };

  const handleOpenWorkOrder = (appointment: Appointment) => {
    // 기존 memo에 JSON 작업 내역서가 있으면 불러오기
    if (appointment.memo) {
      try {
        const parsed = JSON.parse(appointment.memo);
        if (parsed && typeof parsed === 'object' && 'car_number' in parsed) {
          // warranty 관련 키는 workOrder 상태에서 제외 (별도 관리)
          const { warranty, warranty_issued, ...workOrderData } = parsed;
          void warranty; void warranty_issued;
          setWorkOrder(workOrderData);
          setWorkOrderAppointment(appointment);
          setShowWorkOrder(true);
          return;
        }
      } catch { /* not JSON, ignore */ }
    }
    resetWorkOrder();
    // 예약 금액·그 차의 차량번호를 작업내역서 기본값으로
    if (appointment.amount) {
      setWorkOrder((prev) => ({ ...prev, amount: String(appointment.amount) }));
    }
    if (appointment.vehicle?.plate) setWorkOrder((prev) => ({ ...prev, car_number: prev.car_number || appointment.vehicle?.plate || '' }));
    setWorkOrderAppointment(appointment);
    setShowWorkOrder(true);
  };

  // ─── Warranty Actions ────────────────────────────────────
  const handleOpenWarranty = async (appointment: Appointment) => {
    // 고객 정보 직접 조회
    const { data: customerData } = await supabase
      .from('customers')
      .select('*')
      .eq('id', appointment.customer_id)
      .single();

    const custName = customerData?.name || appointment.customer?.name || '';
    const custPhone = customerData?.phone || appointment.customer?.phone || '';
    const carType = [customerData?.car_brand, customerData?.car_model].filter(Boolean).join(' ');

    // 기존 저장된 보증서 데이터 불러오기
    const { data: serviceData } = await supabase
      .from('services')
      .select('id, memo')
      .eq('customer_id', appointment.customer_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let saved: Record<string, string> | null = null;
    if (serviceData?.memo) {
      try {
        const parsed = JSON.parse(serviceData.memo);
        if (parsed?.warranty) saved = parsed.warranty;
      } catch { /* ignore */ }
    }

    // 기존 memo(work order)에서도 car_number 가져오기
    let carNumber = '';
    if (appointment.memo) {
      try {
        const parsed = JSON.parse(appointment.memo);
        if (parsed?.car_number) carNumber = parsed.car_number;
        if (parsed?.warranty) saved = parsed.warranty;
      } catch { /* ignore */ }
    }

    if (saved) {
      setWarrantyForm({
        date: saved.date || appointment.appointment_date || '',
        car_type: saved.car_type || carType,
        car_number: saved.car_number || carNumber,
        customer_name: saved.customer_name || custName,
        phone: saved.phone || custPhone,
        work_details: saved.work_details || '',
        warranty_period: saved.warranty_period || '시공일로부터 1년',
        price: saved.price || '',
      });
    } else {
      setWarrantyForm({
        date: appointment.appointment_date || todaySeoul(),
        car_type: carType,
        car_number: carNumber,
        customer_name: custName,
        phone: custPhone,
        work_details: '',
        warranty_period: '시공일로부터 1년',
        price: '',
      });
    }
    setWarrantyAppointment(appointment);
    setShowWarranty(true);
  };

  // ?warranty=<예약 id> 로 들어왔으면 예약을 읽은 뒤 그 보증서 창을 연다
  useEffect(() => {
    const id = pendingWarrantyId.current;
    if (!id || appointments.length === 0) return;
    const a = appointments.find((x) => x.id === id);
    if (!a) return;
    pendingWarrantyId.current = null;
    window.history.replaceState(null, '', '/crm?tab=appointments');
    handleOpenWarranty(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments]);

  const handleSaveWarranty = async () => {
    if (!warrantyAppointment) return;
    // 기존 memo에 warranty 키로 저장
    let existingMemo: Record<string, unknown> = {};
    if (warrantyAppointment.memo) {
      try { existingMemo = JSON.parse(warrantyAppointment.memo); } catch { /* ignore */ }
    }
    existingMemo.warranty = { ...warrantyForm };
    await supabase.from('appointments')
      .update({ memo: JSON.stringify(existingMemo) })
      .eq('id', warrantyAppointment.id);

    // services 테이블에도 저장
    const { data: serviceData } = await supabase
      .from('services')
      .select('id, memo')
      .eq('customer_id', warrantyAppointment.customer_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (serviceData) {
      let svcMemo: Record<string, unknown> = {};
      try { svcMemo = JSON.parse(serviceData.memo || '{}'); } catch { /* ignore */ }
      svcMemo.warranty = { ...warrantyForm };
      await supabase.from('services').update({ memo: JSON.stringify(svcMemo) }).eq('id', serviceData.id);
    }
    fetchAppointments();
  };

  const handleWarrantyDownloaded = async () => {
    if (!warrantyAppointment) return;
    let existingMemo: Record<string, unknown> = {};
    if (warrantyAppointment.memo) {
      try { existingMemo = JSON.parse(warrantyAppointment.memo); } catch { /* ignore */ }
    }
    existingMemo.warranty_issued = true;
    existingMemo.warranty = { ...warrantyForm };

    // 공개 보증서 URL 생성 (fire-and-forget)
    fetch('/api/notion/warranty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: warrantyForm.customer_name,
        phone: warrantyForm.phone,
        car_type: warrantyForm.car_type,
        car_number: warrantyForm.car_number,
        work_details: warrantyForm.work_details,
        warranty_period: warrantyForm.warranty_period,
        service_date: warrantyForm.date,
        price: warrantyForm.price,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (data.url) {
          existingMemo.warranty_url = data.url;
          const memo = JSON.stringify(existingMemo);
          await supabase.from('appointments').update({ memo }).eq('id', warrantyAppointment.id);
          console.log('[CRM] 보증서 공개 URL:', data.url);
        }
      })
      .catch((err) => console.warn('[CRM] 보증서 URL 생성 실패:', err));

    const updatedMemo = JSON.stringify(existingMemo);
    await supabase.from('appointments').update({ memo: updatedMemo }).eq('id', warrantyAppointment.id);
    setWarrantyAppointment({ ...warrantyAppointment, memo: updatedMemo });
    fetchAppointments();
  };

  const handleOpenWarrantyFromFollowUp = async (followUp: FollowUp) => {
    // 고객의 가장 최근 예약을 찾아서 보증서 모달 열기
    const { data: appt } = await supabase
      .from('appointments')
      .select('*, customer:customers(name, phone)')
      .eq('customer_id', followUp.customer_id)
      .order('appointment_date', { ascending: false })
      .limit(1)
      .single();
    if (appt) {
      handleOpenWarranty(appt as Appointment);
    } else {
      // 예약이 없으면 고객 정보만으로 모달 열기
      setWarrantyForm({
        date: todaySeoul(),
        car_type: '',
        car_number: '',
        customer_name: followUp.customer?.name || '',
        phone: followUp.customer?.phone || '',
        work_details: '',
        warranty_period: '시공일로부터 1년',
        price: '',
      });
      setWarrantyAppointment({ id: '', customer_id: followUp.customer_id, appointment_date: '', status: '', memo: null, created_at: '', updated_at: '', customer: followUp.customer } as Appointment);
      setShowWarranty(true);
    }
  };

  // ─── Follow-up Actions ──────────────────────────────────
  // 후기 받음 (2026-11-18): 후기요청을 완료 처리하면서 memo 에 "후기 받음 날짜 링크"를 남긴다 → 주간 집계 "후기 받음 N / 요청 N"
  const handleReviewReceived = async (f: FollowUp) => {
    const url = window.prompt('후기 링크가 있으면 붙여 넣어 주세요 (없으면 그냥 확인)', '');
    if (url === null) return;
    const line = `후기 받음 ${todaySeoul()}${url.trim() ? ` ${url.trim()}` : ''}`;
    await supabase.from('follow_ups').update({ is_completed: true, completed_date: todaySeoul(), memo: `${f.memo || ''}\n${line}`.trim() }).eq('id', f.id);
    fetchFollowUps();
    fetchStats(statsMonth);
  };

  // QC·메인터넌스 완료는 점검 기록 창을 거친다 (2026-11-22 사장님 "QC 완료가 체크 하나뿐 → 사진·한 줄을 남겨 손님 페이지에 보이게")
  const [careTarget, setCareTarget] = useState<FollowUp | null>(null);

  // 리터치 예약 완료 (2026-11-22 사장님 "리터치가 들어오면 기존 작업 기록에 연동돼서 업데이트돼야"):
  // 시공 기록을 새로 만들지 않고 고른 시공 기록(service_id) 밑에 follow_ups '리터치' 한 건(완료 상태, 점검 기록·사진)으로 붙인다. QC·메인터넌스·후기요청도 새로 안 생김
  const [retouchTarget, setRetouchTarget] = useState<Appointment | null>(null);
  const [retouchServices, setRetouchServices] = useState<{ id: string; label: string }[]>([]);
  const handleOpenRetouch = async (a: Appointment) => {
    const { data } = await supabase.from('services').select('id, service_type, service_date, service_area').eq('customer_id', a.customer_id).order('service_date', { ascending: false });
    setRetouchServices((data || []).map((s) => ({ id: s.id as string, label: `${s.service_date} ${s.service_type}${s.service_area ? ` · ${String(s.service_area).slice(0, 30)}` : ''}` })));
    setRetouchTarget(a);
  };
  const handleRetouchDone = async (a: Appointment, note: string, photos: string[], serviceId?: string | null) => {
    const date = todaySeoul();
    const memo = appendCareLog('리터치', { date, note, photos });
    await supabase.from('follow_ups').insert({ service_id: serviceId || null, customer_id: a.customer_id, follow_up_type: RETOUCH_TYPE, scheduled_date: date, is_completed: true, completed_date: date, memo });
    await supabase.from('appointments').update({ status: '완료' }).eq('id', a.id);
    setRetouchTarget(null);
    fetchAppointments();
    fetchFollowUps();
  };
  // 점검 기록 창이 방문 예약(달력)에서 열렸으면 그 예약도 같이 완료/취소 (2026-11-22)
  const [careVisitAppt, setCareVisitAppt] = useState<Appointment | null>(null);
  const handleCareDone = async (f: FollowUp, note: string, photos: string[]) => {
    const date = todaySeoul();
    const memo = note || photos.length ? appendCareLog(f.memo, { date, note, photos }) : (f.memo || null);
    await supabase.from('follow_ups').update({ is_completed: true, completed_date: date, memo }).eq('id', f.id);
    // 메인터넌스는 6개월마다 → 끝나면 같은 시공 기록에 다음 회차 자동 생성 (2026-11-22)
    const next = await scheduleNextMaintenance(f, date);
    const visitId = careVisitAppt?.id || f.visit?.id;
    if (visitId) await supabase.from('appointments').update({ status: '완료' }).eq('id', visitId);
    setCareTarget(null); setCareVisitAppt(null);
    fetchFollowUps(); if (visitId) fetchAppointments();
    if (next) alert(`다음 메인터넌스를 ${next} 에 잡아 두었습니다.`);
  };
  // 연락했는데 안 오신 분: '미방문'으로 정리 (예정으로 영원히 남지 않게). 메인터넌스면 다음 회차는 그대로 잡는다 (2026-11-22)
  const handleCareSkip = async (f: FollowUp, reason: string) => {
    await markFollowUpSkipped(f, reason);
    const visitId = careVisitAppt?.id || f.visit?.id;
    if (visitId) await supabase.from('appointments').update({ status: '취소' }).eq('id', visitId);
    setCareTarget(null); setCareVisitAppt(null);
    fetchFollowUps(); if (visitId) fetchAppointments();
  };

  // ─── QC·메인터넌스 방문 예약 (2026-11-22 사장님 "QC랑 메인터넌스 예약은 어떻게 등록해?") ───
  // 사후관리 카드 "방문 잡기" → 달력 예약(종류 QC점검/메인터넌스, 그 시공의 차, follow_up_id) + 사후관리 날짜를 방문일로
  const [careBook, setCareBook] = useState<FollowUp | null>(null);
  const [careBookForm, setCareBookForm] = useState({ date: '', time: '', memo: '' });
  const openCareBook = (f: FollowUp) => { setCareBookForm({ date: f.scheduled_date >= todaySeoul() ? f.scheduled_date : todaySeoul(), time: '', memo: '' }); setCareBook(f); };
  const handleBookCareVisit = async () => {
    const f = careBook; if (!f || !careBookForm.date) return;
    let vehicleId: string | null = null;
    if (f.service_id) { const { data: sv } = await supabase.from('services').select('*').eq('id', f.service_id).maybeSingle(); vehicleId = ((sv as { vehicle_id?: string | null } | null)?.vehicle_id) || null; }
    const memoText = [careBookForm.time.trim(), `${f.follow_up_type === 'QC점검' ? 'QC 점검' : '메인터넌스'} 방문`, careBookForm.memo.trim()].filter(Boolean).join(' · ');
    const base = { customer_id: f.customer_id, appointment_date: careBookForm.date, end_date: careBookForm.date, service_type: f.follow_up_type, status: '예약확정', ...(vehicleId ? { vehicle_id: vehicleId } : {}) };
    let { error } = await supabase.from('appointments').insert({ ...base, memo: memoText, follow_up_id: f.id });
    if (error) ({ error } = await supabase.from('appointments').insert({ ...base, memo: `${memoText} · 사후관리:${f.id}` })); // follow_up_id 열이 아직 없으면 memo 에
    if (error) { alert(`예약 저장 실패: ${error.message}`); return; }
    await supabase.from('follow_ups').update({ scheduled_date: careBookForm.date }).eq('id', f.id); // 사후관리 날짜 = 방문일 (손님 페이지 '다음 관리'도 이 날짜)
    setCareBook(null);
    fetchFollowUps(); fetchAppointments();
  };
  // 달력의 QC·메인터넌스 예약을 완료 → 묶인 사후관리를 찾아 점검 기록 창. 없으면 같은 고객·같은 유형의 열린 사후관리, 그것도 없으면 새로 만들어 완료
  const handleOpenCareVisit = async (a: Appointment) => {
    const fid = a.follow_up_id || (a.memo || '').match(/사후관리:([0-9a-f-]{36})/)?.[1] || null;
    let f: FollowUp | null = null;
    if (fid) { const { data } = await supabase.from('follow_ups').select('*, customer:customers(name, phone), service:services(service_type)').eq('id', fid).maybeSingle(); f = (data as FollowUp | null) || null; }
    if (!f) { const { data } = await supabase.from('follow_ups').select('*, customer:customers(name, phone), service:services(service_type)').eq('customer_id', a.customer_id).eq('follow_up_type', a.service_type || '').eq('is_completed', false).order('scheduled_date', { ascending: true }).limit(1); f = ((data || [])[0] as FollowUp | undefined) || null; }
    if (!f) {
      const { data: sv } = await supabase.from('services').select('id').eq('customer_id', a.customer_id).order('service_date', { ascending: false }).limit(1);
      const { data: made } = await supabase.from('follow_ups').insert({ service_id: (sv || [])[0]?.id || null, customer_id: a.customer_id, follow_up_type: a.service_type, scheduled_date: a.appointment_date, memo: `${a.service_type} (달력 예약에서 바로 기록)` }).select('*, customer:customers(name, phone), service:services(service_type)').single();
      f = (made as FollowUp | null) || null;
    }
    if (!f) { alert('묶을 사후관리를 찾지 못했습니다'); return; }
    setCareVisitAppt(a);
    setCareTarget(f);
  };

  const handleToggleFollowUp = async (followUp: FollowUp) => {
    const newCompleted = !followUp.is_completed;
    if (newCompleted && (followUp.follow_up_type === 'QC점검' || followUp.follow_up_type === '메인터넌스')) {
      setCareTarget(followUp);
      return;
    }
    await supabase
      .from('follow_ups')
      .update({
        is_completed: newCompleted,
        completed_date: newCompleted ? todaySeoul() : null,
        // 완료를 되돌리면 점검 기록도 같이 지운다 (잘못 눌렀을 때)
        ...(newCompleted ? {} : { memo: stripCareLog(followUp.memo) || null }),
      })
      .eq('id', followUp.id);
    fetchFollowUps();
  };

  const today = todaySeoul();
  const filteredFollowUps = followUps
    .filter((f) => {
      if (followUpFilter === 'all') return true;
      if (followUpFilter === '견적재연락') return f.follow_up_type === '견적재연락' || f.follow_up_type === '견적마무리';
      return f.follow_up_type === followUpFilter;
    })
    .sort((a, b) => {
      // 미처리 우선, 그 안에서 날짜 임박순
      if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
      return a.scheduled_date.localeCompare(b.scheduled_date);
    });

  /** 견적 문자로만 남은 미등록 문의를 고객 목록에 추가 (며칠 뒤 예약이 잡혔을 때). 같은 번호의 상담 기록·재연락을 그 고객에 연결 */
  const handleAddCustomerFromQuote = async (who: string) => {
    // who: "이름 010-0000-0000 · 차종 · 요약" 또는 "이름 010-0000-0000"
    const head = who.split(' · ')[0].trim();
    const phoneMatch = head.match(/01[016789]-?\d{3,4}-?\d{4}/);
    if (!phoneMatch) { alert('전화번호를 찾지 못했습니다.'); return; }
    const digits = phoneMatch[0].replace(/[^\d]/g, '');
    const formatted = digits.length === 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}` : phoneMatch[0];
    const name = head.replace(phoneMatch[0], '').trim() || `전화문의 ${digits.slice(-4)}`;
    const car = (who.split(' · ')[1] || '').trim();
    const [brand, ...rest] = car.split(/\s+/);
    let customerId: string | null = null;
    const { data: found } = await supabase.from('customers').select('id').or(`phone.eq.${formatted},phone.eq.${digits}`).limit(1);
    const existed = !!(found && found.length > 0);
    if (existed) {
      customerId = found![0].id as string;
    } else {
      const { data: created, error } = await supabase.from('customers').insert({
        name, phone: formatted, car_brand: brand || null, car_model: rest.join(' ') || null, source: '경로X', memo: '견적 문자 문의 → 고객 등록',
      }).select('id').single();
      if (error || !created) { alert(`고객 등록 실패: ${error?.message || ''}`); return; }
      customerId = created.id as string;
    }
    // 같은 번호로 남은 미연결 상담 기록·재연락을 전부 이 고객에 연결
    const { data: cons } = await supabase.from('consultations').select('id, memo, content').is('customer_id', null);
    const consIds = (cons || []).filter((c) => `${c.memo || ''} ${c.content || ''}`.replace(/-/g, '').includes(digits)).map((c) => c.id);
    if (consIds.length) await supabase.from('consultations').update({ customer_id: customerId }).in('id', consIds);
    const { data: fus } = await supabase.from('follow_ups').select('id, memo').is('customer_id', null);
    const fuIds = (fus || []).filter((f) => (f.memo || '').split('\n')[0].replace(/-/g, '').includes(digits)).map((f) => f.id);
    if (fuIds.length) await supabase.from('follow_ups').update({ customer_id: customerId }).in('id', fuIds);
    alert(`${name} 고객을 ${existed ? '기존 고객으로 연결' : '고객 목록에 추가'}했습니다. (상담 ${consIds.length}건, 재연락 ${fuIds.length}건 연결)`);
    fetchCustomers();
    fetchConsultations();
    fetchFollowUps();
  };

  // ─── Consultation Actions ───────────────────────────────
  const handleAddConsultation = async () => {
    const f = consultationForm;
    const date = f.consultation_date || today;
    const phoneDigits = f.phone.replace(/[^\d]/g, '');
    if (!f.customer_id && !phoneDigits && f.photos.length === 0) { alert('고객을 고르거나, 전화번호를 적거나, 캡처 사진을 붙여 주세요.'); return; }
    // 고객 미선택: 메모 첫 칸을 "이름 전화 · 차종" 으로 (견적 문자 기록과 같은 형식). 나중에 '＋ 고객 목록에 추가'로 연결 가능
    const phoneFmt = phoneDigits.length === 11 ? `${phoneDigits.slice(0, 3)}-${phoneDigits.slice(3, 7)}-${phoneDigits.slice(7)}` : f.phone.trim();
    const who = f.customer_id ? '' : `${f.name.trim() || '전화문의'} ${phoneFmt}`.trim();
    const photoPart = f.photos.length ? `사진: ${f.photos.join(' ')}` : '';
    const memo = f.customer_id
      ? [f.memo.trim(), photoPart].filter(Boolean).join(' · ') || null
      : [who, f.car.trim(), f.memo.trim(), photoPart].filter(Boolean).join(' · ');
    const { error } = await supabase.from('consultations').insert({
      customer_id: f.customer_id || null,
      consultation_date: date,
      content: f.content || null,
      estimate: f.estimate || null,
      interested_services: f.interested_services || null,
      memo,
    });
    if (error) { alert(`저장 실패: ${error.message}`); return; }

    // Notion 상담 기록 동기화 (fire-and-forget)
    const consultCustomer = allCustomers.find((c) => c.id === consultationForm.customer_id);
    if (consultCustomer) {
      const contentParts = [consultationForm.content, consultationForm.estimate ? `견적: ${consultationForm.estimate}` : '', consultationForm.interested_services ? `관심: ${consultationForm.interested_services}` : '', consultationForm.memo].filter(Boolean);
      fetch('/api/notion/consultation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: consultCustomer.name,
          consultationDate: consultationForm.consultation_date,
          consultationType: null,
          content: contentParts.join(' | ') || null,
        }),
      })
        .then(async (res) => { const r = await res.json(); console.log('[CRM] Notion 상담 기록:', res.ok ? r.pageId : r); })
        .catch((err) => console.warn('[CRM] Notion 상담 기록 실패:', err));
    }

    setConsultationForm({ customer_id: '', consultation_date: '', content: '', estimate: '', interested_services: '', memo: '', name: '', phone: '', car: '', photos: [] });
    setShowAddConsultation(false);
    fetchConsultations();
  };

  // ─── Customer Picker ────────────────────────────────────
  const filteredPickerCustomers = allCustomers.filter((c) => {
    const q = customerPickerSearch.toLowerCase();
    if (!q) return true;
    // 이름·전화 + 차종(대표 차와 두 번째 차, 2026-11-22)
    return c.name.toLowerCase().includes(q) || (c.phone?.includes(q)) || `${c.car_brand || ''} ${c.car_model || ''}`.toLowerCase().includes(q) || (vehiclesByCustomer.get(c.id) || []).some((v) => `${v.brand || ''} ${v.model || ''}`.toLowerCase().includes(q));
  });

  const CustomerPicker = ({ value, onChange }: { value: string; onChange: (id: string) => void }) => {
    const selected = allCustomers.find((c) => c.id === value);
    const [open, setOpen] = useState(false);

    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => { setOpen(!open); setCustomerPickerSearch(''); }}
          className="w-full text-left bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] hover:border-gold/50 transition-colors"
        >
          {selected ? `${selected.name}${selected.phone ? ` (${selected.phone})` : ''}` : '고객 선택...'}
        </button>
        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg shadow-2xl z-50 max-h-48 overflow-y-auto">
            <div className="p-2 border-b border-[var(--c-border)]">
              <input
                type="text"
                placeholder="이름·연락처·차종 검색..."
                value={customerPickerSearch}
                onChange={(e) => setCustomerPickerSearch(e.target.value)}
                className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded px-2 py-1.5 text-xs text-[var(--c-text-1)] outline-none focus:border-gold/50"
                autoFocus
              />
            </div>
            {filteredPickerCustomers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onChange(c.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm text-[var(--c-text-1)] hover:bg-[var(--c-subtle)] transition-colors"
              >
                {c.name} {c.phone && <span className="text-[var(--c-text-3)]">({c.phone})</span>}
                {(() => { const cars = (vehiclesByCustomer.get(c.id) || []).map((v) => vehicleLabel(v)).filter(Boolean); const label = cars.length ? cars.join(' · ') : `${c.car_brand || ''} ${c.car_model || ''}`.trim(); return label ? <span className="ml-2 text-xs text-[var(--c-text-3)]">{label}</span> : null; })()}
              </button>
            ))}
            {filteredPickerCustomers.length === 0 && (
              <div className="px-3 py-2 text-xs text-[var(--c-text-3)]">검색 결과 없음</div>
            )}
          </div>
        )}
      </div>
    );
  };

  /**
   * 예약/시공 기록 → 블로그 폼 미리 채우기 (PPF·컬러PPF·랩핑·크롬죽이기만)
   * 차량·시공 종류·범위는 채우고, 제품 등급과 참고 메모는 사장님이 직접 넣는다
   */
  const handleWriteBlogFromAppointment = (a: Appointment) => {
    const key = a.service_type ? CRM_SERVICE_TO_KEY[a.service_type] : undefined;
    if (!key) return;
    const c = allCustomers.find((x) => x.id === a.customer_id);
    let wo: { ppf?: string[]; ppf_etc?: string; wrapping?: string[]; wrapping_etc?: string; notes?: string } = {};
    try { wo = JSON.parse(a.memo || '{}'); } catch { /* 일반 메모 */ }
    const plainMemo = a.memo && !a.memo.trim().startsWith('{') ? a.memo.trim() : '';

    let range: string | undefined;
    const noteParts: string[] = [];
    if (key === 'PPF') {
      const parts = [...(wo.ppf || []), wo.ppf_etc || ''].filter(Boolean);
      if (parts.some((x) => x.includes('전체'))) range = '전체';
      else if (parts.some((x) => x.includes('프론트'))) range = '프론트(보닛·범퍼·펜더)';
      else if (parts.length > 0) range = '부분';
      if (parts.length > 0) noteParts.push(`시공 범위: ${parts.join(', ')}`);
    } else if (key === '랩핑' || key === '컬러PPF') {
      const parts = [...(wo.wrapping || []), wo.wrapping_etc || ''].filter(Boolean);
      if (parts.some((x) => x.includes('전체'))) range = '전체';
      else if (parts.length > 0) range = '부분';
      if (parts.length > 0) noteParts.push(`시공 범위: ${parts.join(', ')}`);
    }
    if (wo.notes) noteParts.push(wo.notes);
    if (plainMemo) noteParts.push(plainMemo);

    const dateLabel = new Date(a.appointment_date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
    const prefill: BlogPrefill = {
      brand: c?.car_brand || undefined,
      model: c?.car_model || undefined,
      color: c?.car_color || undefined,
      serviceKey: key,
      range,
      notes: noteParts.join('\n'),
      source: `CRM ${dateLabel} ${a.customer?.name || ''} ${a.service_type}`.trim(),
    };
    try { sessionStorage.setItem(BLOG_PREFILL_KEY, JSON.stringify(prefill)); } catch { /* ignore */ }
    setPrefillNonce((n) => n + 1);
    setActiveTab('blog');
  };

  // ─── Render ─────────────────────────────────────────────
  // 둘러보기에서는 블로그 탭을 뺀다 (2026-11-22 사장님) — 글 생성은 API 가 막혀 있어 보여 줄 것도 없음
  const tabs: { key: Tab; label: string }[] = [
    { key: 'home', label: '홈' },
    ...(isDemo ? [] : [{ key: 'blog' as Tab, label: '✍️ 블로그' }]),
    { key: 'customers', label: '고객 목록' },
    { key: 'appointments', label: '예약/일정' },
    { key: 'followups', label: '사후관리' },
    { key: 'consultations', label: '상담 기록' },
  ];

  return (
    <div className="h-dvh flex flex-col bg-[var(--c-page)]">
      {/* 둘러보기 띠 (2026-11-22): /demo 로 들어온 화면. 고객 데이터 없이 구조만 보이고 저장 안 됨. 사장님 기기에서 열었다면 "나가기"로 돌아온다 */}
      {isDemo && (
        <div className="bg-brand text-white text-xs md:text-sm px-4 py-2 flex items-center justify-center gap-3 shrink-0 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <span className="font-semibold">둘러보기 모드</span>
          <span className="opacity-90">고객 정보 없이 화면 구조만 보입니다 · 입력해도 저장되지 않습니다</span>
          <a href="/demo?off=1" className="ml-2 px-2.5 py-1 rounded-full bg-white/20 hover:bg-white/30 font-medium">나가기</a>
        </div>
      )}
      {/* Header (2026-11-11 하남점 페이지 톤: 3M 레드 사각 로고 + 알약형 탭, 가운데 컨테이너) */}
      <header className={`bg-[var(--c-card)] border-b border-[var(--c-border)] shrink-0 ${isDemo ? '' : 'pt-[env(safe-area-inset-top)]'}`}>
        <div className="mx-auto max-w-[1360px] px-4 md:px-6">
          <div className="h-14 md:h-16 flex items-center justify-between gap-3">
            <button type="button" onClick={() => setActiveTab('home')} className="flex items-center gap-2.5 min-w-0 hover:opacity-80 transition-opacity text-left">
              <span className="w-9 h-9 rounded-lg bg-brand text-white font-extrabold text-[13px] tracking-tight flex items-center justify-center shrink-0">3M</span>
              <span className="font-bold text-[15px] md:text-base text-[var(--c-text-1)] whitespace-nowrap truncate">프로이즘 강남 서초점{activeTab === 'blog' && <span className="text-[var(--c-text-3)] font-medium ml-1 hidden sm:inline">블로그</span>}</span>
            </button>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={toggleTheme}
                className="w-8 h-8 rounded-full border border-[var(--c-border)] bg-[var(--c-card)] flex items-center justify-center hover:bg-[var(--c-subtle)] transition-colors text-sm"
                title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
              >
                {theme === 'dark' ? '🌙' : '☀️'}
              </button>
              {activeTab === 'blog' && (
                <button
                  onClick={() => setHelpOpen(true)}
                  className="w-8 h-8 rounded-full border border-[var(--c-border)] bg-[var(--c-card)] flex items-center justify-center text-[var(--c-text-3)] hover:text-[var(--c-text-1)] hover:bg-[var(--c-subtle)] transition-colors text-sm"
                  title="블로그 사용 가이드"
                >
                  ?
                </button>
              )}
              <PushToggle />
            </div>
          </div>
          {/* Tabs */}
          <nav className="flex gap-1.5 pb-3 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3.5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  activeTab === tab.key
                    ? 'bg-[var(--c-text-1)] text-[var(--c-card)]'
                    : 'text-[var(--c-text-2)] hover:bg-[var(--c-subtle)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
            {/* 회원 한눈에 보기는 별도 페이지 (2026-11-18 멤버십) */}
            <Link href="/crm/membership" className="px-3.5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap shrink-0 transition-colors text-[var(--c-text-2)] hover:bg-[var(--c-subtle)]">회원</Link>
          </nav>
        </div>
      </header>

      {/* Content */}
      <div className={activeTab === 'blog' ? 'hidden' : 'flex-1 overflow-y-auto px-4 md:px-6 py-5 md:py-6 [&>*]:mx-auto [&>*]:max-w-[1360px]'}>
        {/* ─── TAB: 홈 (2026-11-11 하남점 페이지 구조: 인사 → 빠른 실행 → 오늘 예약 / 연락할 사후관리) ─── */}
        {activeTab === 'home' && (() => {
          const fmtDot = (d: string) => d.replace(/-/g, '.');
          const plus = (n: number) => addDaysISO(today, n);
          const todayAppts = appointments.filter((a) => a.appointment_date <= today && (a.end_date || a.appointment_date) >= today && a.status !== '취소');
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

              <div className="grid lg:grid-cols-2 gap-4 md:gap-5 items-start">
                {/* 오늘 예약 */}
                <section className={`${card} p-5 md:p-6`}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-[var(--c-text-1)]">오늘 예약 <span className="text-[var(--c-text-3)] text-sm font-medium ml-1">{todayAppts.length}건</span></h2>
                    <button onClick={() => setActiveTab('appointments')} className="text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-1)] transition-colors">전체 보기 →</button>
                  </div>
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
                      <button onClick={fetchTeamBrief} className="text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-1)] transition-colors">↻ 새로고침</button>
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
                  <h2 className="text-lg font-bold text-[var(--c-text-1)]">이번 주 숫자 <span className="text-[var(--c-text-3)] text-sm font-medium ml-1">{stats ? `${stats.weekly.from.slice(5).replace('-', '.')}~${stats.weekly.to.slice(5).replace('-', '.')}` : ''}</span></h2>
                  <button onClick={() => fetchStats(statsMonth)} className="text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-1)] transition-colors">↻ 새로고침</button>
                </div>
                {!stats ? (
                  <div className="py-8 text-center text-sm text-[var(--c-text-3)]">{isDemo ? "둘러보기에서는 비어 있습니다" : "지난 7일 기록을 세는 중…"}</div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5">
                      {[
                        { k: '블로그 발행', v: stats.weekly.blogPublished, sub: stats.weekly.blogGenerated ? `생성 ${stats.weekly.blogGenerated}` : '' },
                        { k: '상담 기록', v: stats.weekly.consultations, sub: `문의 답변 ${stats.weekly.inquiryReplies}` },
                        { k: '견적 문자', v: stats.weekly.quoteSms, sub: '' },
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
        })()}

        {/* ─── TAB: 고객 목록 ──────────────────────────────── */}
        {activeTab === 'customers' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="이름, 차종으로 검색..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] w-64 outline-none focus:border-gold/50 transition-colors placeholder:text-[var(--c-text-3)]"
                />
                <span className="text-xs text-[var(--c-text-3)]">{filteredCustomers.length}명</span>
              </div>
              <button
                onClick={() => { setEditCustomerId(null); setCustomerForm({ name: '', phone: '', car_brand: '', car_model: '', car_year: '', car_color: '', source: '', memo: '', appointment_start_date: '', appointment_end_date: '', appointment_service_type: '', appointment_amount: '', appointment_memo: '' }); setShowAddCustomer(true); }}
                className="bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
              >
                + 고객 추가
              </button>
            </div>

            <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-x-auto">
              <table className="w-full whitespace-nowrap md:whitespace-normal">
                <thead>
                  <tr className="border-b border-[var(--c-border)]">
                    <th className="text-left px-4 py-3 text-xs font-medium text-[var(--c-text-3)]">이름</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-[var(--c-text-3)]">연락처</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-[var(--c-text-3)]">차종</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-[var(--c-text-3)]">최근 시공</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-[var(--c-text-3)]">등록일</th>
                    <th className="w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => router.push(`/crm/${c.id}`)}
                      className="border-b border-[var(--c-border)] last:border-b-0 hover:bg-[var(--c-page)] cursor-pointer transition-colors group"
                    >
                      <td className="px-4 py-3 text-sm text-[var(--c-text-1)] font-medium">
                        {c.name}
                        {c.service_count >= 2 && <span className="ml-1.5 text-[9px] bg-gold/20 text-gold px-1.5 py-0.5 rounded-full font-medium">재방문</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--c-text-2)]">{c.phone || '-'}</td>
                      <td className="px-4 py-3 text-sm text-[var(--c-text-2)]">
                        {c.car_brand || c.car_model
                          ? `${c.car_brand || ''} ${c.car_model || ''}`.trim()
                          : '-'}
                        {(vehiclesByCustomer.get(c.id)?.length || 0) > 1 && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--c-subtle)] text-[var(--c-text-3)]">외 {(vehiclesByCustomer.get(c.id)?.length || 1) - 1}대</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--c-text-2)]">
                        {c.latest_service
                          ? <>{c.latest_service}{c.latest_is_booking && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-info/10 text-info align-middle">{c.latest_status || '예약'}</span>} <span className="text-[var(--c-text-3)]">({formatDate(c.latest_service_date)})</span></>
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--c-text-3)]">{formatDate(c.created_at)}</td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEditCustomer(c); }}
                            className="w-6 h-6 rounded flex items-center justify-center text-[var(--c-text-3)] hover:text-gold hover:bg-gold/10 transition-all text-xs"
                            title="수정"
                          >✎</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteCustomer(c.id, c.name); }}
                            className="w-6 h-6 rounded flex items-center justify-center text-[var(--c-text-3)] hover:text-danger hover:bg-danger/10 transition-all text-xs"
                            title="삭제"
                          >✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredCustomers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-sm text-[var(--c-text-3)]">
                        {customerSearch ? '검색 결과가 없습니다' : '등록된 고객이 없습니다'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── TAB: 예약/일정 ──────────────────────────────── */}
        {activeTab === 'appointments' && (() => {
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
                  <button onClick={() => setShowCalendarSub(true)} className={`${pill} py-2 px-4 text-sm`}>캘린더 구독</button>
                  <button onClick={() => { setShowShotImport(true); setShotMonth(`${cY}-${String(cM + 1).padStart(2, '0')}`); }} className={`${pill} py-2 px-4 text-sm`} title="타임트리 캡처·카톡 대화 사진에서 일정을 읽어 예약으로 넣기">📷 스크린샷으로 추가</button>
                  <button onClick={() => setShowAddAppointment(true)} className="bg-brand hover:bg-brand-dark text-white text-sm font-semibold rounded-full px-4 py-2 transition-colors whitespace-nowrap">+ 예약 추가</button>
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
                            {a.customer_id && (
                              <button onClick={() => handleEditCustomerFromAppointment(a)} className={pill} title="이름·전화·차량·유입경로 수정">👤 고객 정보</button>
                            )}
                            {!isDemo && a.service_type && CRM_SERVICE_TO_KEY[a.service_type] && (
                              <button onClick={() => handleWriteBlogFromAppointment(a)} className={pill} title="이 시공으로 블로그 시공기 폼 채우기">✍️ 시공기</button>
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
        })()}

        {/* ─── TAB: 사후관리 ──────────────────────────────── */}
        {activeTab === 'followups' && (
          <div>
            {/* 상단 요약 카드 */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {([
                { label: '미처리', count: followUps.filter((f) => !f.is_completed).length, color: '#EF4444', bg: '#EF4444' },
                { label: '임박 (3일 이내)', count: followUps.filter((f) => { if (f.is_completed) return false; const d = Math.ceil((new Date(f.scheduled_date).getTime() - new Date(today).getTime()) / 86400000); return d >= 0 && d <= 3; }).length, color: '#F59E0B', bg: '#F59E0B' },
                { label: '처리완료', count: followUps.filter((f) => f.is_completed).length, color: '#10B981', bg: '#10B981' },
              ]).map((s) => (
                <div key={s.label} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-3 text-center">
                  <div className="text-xs text-[var(--c-text-3)] mb-1">{s.label}</div>
                  <div className="text-xl font-bold" style={{ color: s.color }}>{s.count}<span className="text-xs font-normal text-[var(--c-text-3)] ml-0.5">건</span></div>
                </div>
              ))}
            </div>

            {/* 필터 버튼 (유형별) */}
            <div className="flex items-center gap-2 mb-4">
              {([
                { key: 'all' as const, label: '전체', count: followUps.length, style: 'bg-gold/20 text-gold' },
                { key: 'QC점검' as const, label: 'QC', count: followUps.filter((f) => f.follow_up_type === 'QC점검').length, style: 'bg-info/20 text-info' },
                { key: '메인터넌스' as const, label: '메인터넌스', count: followUps.filter((f) => f.follow_up_type === '메인터넌스').length, style: 'bg-violet/20 text-violet' },
                { key: '후기요청' as const, label: '후기요청', count: followUps.filter((f) => f.follow_up_type === '후기요청').length, style: 'bg-warn/20 text-warn' },
                { key: '견적재연락' as const, label: '견적 재연락', count: followUps.filter((f) => f.follow_up_type === '견적재연락' || f.follow_up_type === '견적마무리').length, style: 'bg-gold/20 text-gold' },
              ]).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFollowUpFilter(f.key)}
                  className={`text-sm px-3 py-1.5 rounded-lg transition-colors font-medium ${
                    followUpFilter === f.key
                      ? f.style
                      : 'bg-[var(--c-subtle)] text-[var(--c-text-3)] hover:text-[var(--c-text-2)]'
                  }`}
                >
                  {f.label}
                  <span className={`ml-1.5 text-xs ${followUpFilter === f.key ? 'opacity-80' : 'text-[var(--c-text-4)]'}`}>{f.count}</span>
                </button>
              ))}
            </div>

            {/* 달력 + 검색 + 그날 목록 */}
            {(() => {
              const renderFollowUp = (f: FollowUp) => {
                const isQuote = f.follow_up_type === '견적재연락' || f.follow_up_type === '견적마무리';
                // 견적 재연락은 고객 등록이 없을 수 있어 메모 첫 줄("이름 전화 · 차종 시공")에서 전화를 읽는다
                const memoPhone = isQuote ? (f.memo || '').split('\n')[0].match(/01[016789]-?\d{3,4}-?\d{4}/)?.[0] : undefined;
                const phone = f.customer?.phone || memoPhone;
                const quoteHead = isQuote ? (f.memo || '').split('\n')[0] : '';
                const quoteBody = isQuote ? (f.memo || '').split('\n').slice(1).join('\n') : '';
                const daysUntil = Math.ceil((new Date(f.scheduled_date).getTime() - new Date(today).getTime()) / 86400000);
                const isUrgent = !f.is_completed && daysUntil >= 0 && daysUntil <= 3;
                const isOverdue = !f.is_completed && f.scheduled_date < today;

                const smsQC = QC_SMS;
                const smsMaint = MAINT_SMS;
                const smsReviewProism = REVIEW_SMS.proism;
                const smsReviewBMW = REVIEW_SMS.bmw;
                const smsReviewAudi = REVIEW_SMS.audi;
                const sent = f.sms_sent || {};
                const markSent = async (key: string) => {
                  const updated = { ...sent, [key]: true };
                  await supabase.from('follow_ups').update({ sms_sent: updated }).eq('id', f.id);
                  fetchFollowUps();
                };
                const sendSms = (msg: string, key: string) => {
                  if (!phone) return;
                  const cleanMsg = msg.replace(/\\n/g, '\n').trim();
                  // iOS: sms:번호&body= / Android: sms:번호?body=
                  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
                  const smsUrl = isIOS
                    ? `sms:${phone}&body=${encodeURIComponent(cleanMsg)}`
                    : `sms:${phone}?body=${encodeURIComponent(cleanMsg)}`;
                  window.open(smsUrl);
                  if (confirm('문자를 전송하셨나요?')) markSent(key);
                };
                const sendKakao = (msg: string, key: string) => {
                  if (!phone) return;
                  // \n 리터럴을 실제 줄바꿈으로, 연속 줄바꿈 정리
                  const cleanMsg = msg.replace(/\\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
                  if (window.Kakao?.isInitialized()) {
                    try {
                      window.Kakao.Share.sendDefault({
                        objectType: 'text',
                        text: cleanMsg,
                        link: { mobileWebUrl: 'https://blog.naver.com/roice_', webUrl: 'https://blog.naver.com/roice_' },
                        buttonTitle: '블로그 방문',
                      });
                    } catch {
                      // SDK 에러 시 카카오톡 커스텀 URL scheme fallback
                      const kakaoLink = `https://sharer.kakao.com/talk/friends/picker/link?url=${encodeURIComponent('https://blog.naver.com/roice_')}&text=${encodeURIComponent(cleanMsg)}`;
                      window.open(kakaoLink, '_blank', 'width=480,height=600');
                    }
                  } else {
                    navigator.clipboard.writeText(cleanMsg);
                    alert('카카오 SDK 로딩 중입니다. 문구가 복사되었으니 카톡에 직접 붙여넣기 해주세요.');
                  }
                  if (confirm('카톡을 전송하셨나요?')) markSent(key);
                };
                const copyMsg = (msg: string) => {
                  navigator.clipboard.writeText(msg);
                  alert('문구가 복사되었습니다.');
                };

                const typeBadgeClass = f.follow_up_type === 'QC점검'
                  ? 'bg-info/20 text-info'
                  : f.follow_up_type === RETOUCH_TYPE
                  ? 'bg-ok/20 text-ok'
                  : f.follow_up_type === '후기요청'
                    ? 'bg-warn/20 text-warn'
                    : isQuote
                      ? 'bg-gold/20 text-gold'
                      : 'bg-violet/20 text-violet';

                const statusBadge = f.is_completed
                  ? (isSkipped(f.memo) ? { text: '미방문', class: 'bg-[var(--c-hover)] text-[var(--c-text-3)]' } : { text: '처리완료', class: 'bg-ok/20 text-ok' })
                  : isOverdue
                    ? { text: `${Math.abs(daysUntil)}일 지남`, class: 'bg-danger/20 text-danger' }
                    : isUrgent
                      ? { text: daysUntil === 0 ? '오늘' : `D-${daysUntil}`, class: 'bg-warn/20 text-warn' }
                      : { text: '미처리', class: 'bg-danger/15 text-danger' };

                const cardBorder = isOverdue
                  ? 'border-danger/40'
                  : isUrgent
                    ? 'border-warn/40'
                    : f.is_completed
                      ? 'border-ok/20'
                      : 'border-[var(--c-border)]';

                const sentBtn = 'bg-ok/15 text-ok';
                const qcBtn = phone ? (sent.qc ? sentBtn : 'bg-info/15 text-info hover:bg-info/25') : 'bg-[var(--c-subtle)] text-[var(--c-text-3)]/40 cursor-not-allowed';
                const maintBtn = phone ? (sent.maintenance ? sentBtn : 'bg-violet/15 text-violet hover:bg-violet/25') : 'bg-[var(--c-subtle)] text-[var(--c-text-3)]/40 cursor-not-allowed';
                const reviewBtn = (key: string) => phone ? (sent[key] ? sentBtn : 'bg-warn/15 text-warn hover:bg-warn/25') : 'bg-[var(--c-subtle)] text-[var(--c-text-3)]/40 cursor-not-allowed';

                return (
                  <div
                    key={f.id}
                    className={`bg-[var(--c-card)] border rounded-xl p-4 ${cardBorder} ${isUrgent ? 'ring-1 ring-warn/20' : ''}`}
                  >
                    {/* 카드 상단: 유형 + 상태 뱃지 */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${typeBadgeClass}`}>
                          {f.follow_up_type}
                        </span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusBadge.class}`}>
                          {statusBadge.text}
                        </span>
                      </div>
                      <button
                        onClick={() => handleToggleFollowUp(f)}
                        className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors shrink-0 ${
                          f.is_completed
                            ? 'bg-ok border-ok text-white'
                            : 'border-[var(--c-text-4)] hover:border-gold'
                        }`}
                      >
                        {f.is_completed && <span className="text-xs font-bold">✓</span>}
                      </button>
                    </div>

                    {/* 카드 본문: 고객 정보 */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--c-text-1)]">{f.customer?.name || '-'}</span>
                          {phone && <span className="text-xs text-[var(--c-text-4)]">{phone}</span>}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-[var(--c-text-3)]">
                          <span className="bg-[var(--c-subtle)] px-2 py-0.5 rounded">{f.service?.service_type || '-'}</span>
                          <span>{formatDate(f.scheduled_date)}</span>
                          {f.scheduled_date === today && <span className="text-warn font-medium">(오늘)</span>}
                        </div>
                        {f.memo && !isQuote && stripCareLog(f.memo) && <div className="text-xs text-[var(--c-text-4)] mt-1">{stripCareLog(f.memo)}</div>}
                        {(() => {
                          const log = parseCareLog(f.memo);
                          if (!log) return null;
                          return (
                            <div className="mt-1.5 rounded-lg bg-ok/10 px-2.5 py-1.5">
                              <div className="text-xs text-ok font-medium">점검 기록{log.date ? ` ${formatDate(log.date)}` : ''}{log.note ? ` · ${log.note}` : ''}</div>
                              {log.photos.length > 0 && <div className="flex gap-1.5 mt-1.5">{log.photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="w-12 h-12 object-cover rounded-md border border-[var(--c-border)]" /></a>)}</div>}
                            </div>
                          );
                        })()}
                        {isQuote && (
                          <div className="text-xs text-[var(--c-text-4)] mt-1">
                            {quoteHead}
                            <details className="mt-1"><summary className="cursor-pointer text-[var(--c-text-3)]">보낼 문자 보기</summary><pre className="whitespace-pre-wrap font-sans mt-1 text-[var(--c-text-2)]">{quoteBody}</pre></details>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 카드 하단: 액션 버튼 */}
                    <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-[var(--c-border)]">
                      {f.follow_up_type === 'QC점검' && (
                        <>
                        <button onClick={() => sendKakao(smsQC, 'qc')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.qc ? sentBtn : 'bg-[#FEE500] text-[#191919] hover:bg-[#FDD835]'}`}>{sent.qc ? '✓ 카톡완료' : '카톡'}</button>
                        <button onClick={() => sendSms(smsQC, 'qc')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${qcBtn}`}>{sent.qc ? '✓ 문자완료' : '문자'}</button>
                        <button onClick={() => copyMsg(smsQC)} className="text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors bg-[var(--c-subtle)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)]">복사</button>
                        </>
                      )}
                      {f.follow_up_type === '메인터넌스' && (
                        <>
                        <button onClick={() => sendKakao(smsMaint, 'maintenance')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.maintenance ? sentBtn : 'bg-[#FEE500] text-[#191919] hover:bg-[#FDD835]'}`}>{sent.maintenance ? '✓ 카톡완료' : '카톡'}</button>
                        <button onClick={() => sendSms(smsMaint, 'maintenance')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${maintBtn}`}>{sent.maintenance ? '✓ 문자완료' : '문자'}</button>
                        <button onClick={() => copyMsg(smsMaint)} className="text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors bg-[var(--c-subtle)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)]">복사</button>
                        </>
                      )}
                      {f.follow_up_type === '후기요청' && (
                        <>
                        <button onClick={() => sendKakao(smsReviewProism, 'proism')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.proism ? sentBtn : 'bg-[#FEE500] text-[#191919] hover:bg-[#FDD835]'}`}>{sent.proism ? '✓ 프로이즘 카톡' : '프로이즘 카톡'}</button>
                        <button onClick={() => sendSms(smsReviewProism, 'proism')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${reviewBtn('proism')}`}>{sent.proism ? '✓ 프로이즘 문자' : '프로이즘 문자'}</button>
                        <button onClick={() => sendKakao(smsReviewBMW, 'bmw')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.bmw ? sentBtn : 'bg-[#FEE500] text-[#191919] hover:bg-[#FDD835]'}`}>{sent.bmw ? '✓ BMW 카톡' : 'BMW 카톡'}</button>
                        <button onClick={() => sendSms(smsReviewBMW, 'bmw')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${reviewBtn('bmw')}`}>{sent.bmw ? '✓ BMW 문자' : 'BMW 문자'}</button>
                        <button onClick={() => sendKakao(smsReviewAudi, 'audi')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.audi ? sentBtn : 'bg-[#FEE500] text-[#191919] hover:bg-[#FDD835]'}`}>{sent.audi ? '✓ 아우디 카톡' : '아우디 카톡'}</button>
                        <button onClick={() => sendSms(smsReviewAudi, 'audi')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${reviewBtn('audi')}`}>{sent.audi ? '✓ 아우디 문자' : '아우디 문자'}</button>
                        <button onClick={() => handleReviewReceived(f)} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${/후기 받음/.test(f.memo || '') ? 'bg-ok/15 text-ok' : 'bg-violet/15 text-violet hover:bg-violet/25'}`}>{/후기 받음/.test(f.memo || '') ? '✓ 후기 받음' : '후기 받음'}</button>
                        </>
                      )}
                      {isQuote && !f.customer_id && (
                        <button onClick={() => handleAddCustomerFromQuote(quoteHead)} className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-ok/15 hover:bg-ok/25 text-ok transition-colors">＋ 고객 목록에 추가</button>
                      )}
                      {isQuote && (
                        <>
                        <button onClick={() => sendSms(quoteBody, 'quote')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.quote ? sentBtn : 'bg-gold/20 text-gold hover:bg-gold/30'}`}>{sent.quote ? '✓ 문자완료' : (f.follow_up_type === '견적재연락' ? '재연락 문자' : '마무리 문자')}</button>
                        <button onClick={() => copyMsg(quoteBody)} className="text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors bg-[var(--c-subtle)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)]">복사</button>
                        </>
                      )}
                      {(f.follow_up_type === 'QC점검' || f.follow_up_type === '메인터넌스') && !f.is_completed && (
                        f.visit
                          ? <button onClick={() => { setActiveTab('appointments'); }} className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-info/15 text-info" title="예약/일정 달력에 잡힌 방문">📅 {f.visit.appointment_date.slice(5).replace('-', '/')} 방문</button>
                          : <button onClick={() => openCareBook(f)} className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-[var(--c-subtle)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)]" title="손님과 잡은 날짜로 달력 예약을 만듭니다">📅 방문 잡기</button>
                      )}
                      <button
                        onClick={() => handleToggleFollowUp(f)}
                        className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ml-auto ${
                          f.is_completed
                            ? 'bg-ok/15 text-ok'
                            : 'bg-[var(--c-subtle)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)]'
                        }`}
                      >
                        {f.is_completed ? '✓ 완료됨' : '완료 처리'}
                      </button>
                      <button onClick={() => handleOpenWarrantyFromFollowUp(f)} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${customerHasWarranty(f.customer_id) ? 'bg-ok text-white' : 'bg-ok/10 hover:bg-ok/20 text-ok'}`}>{customerHasWarranty(f.customer_id) ? '✓ 보증서' : '보증서'}</button>
                    </div>
                  </div>
                );
              };

              const q = followSearch.trim().replace(/-/g, '');
              const matchQ = (f: FollowUp) => {
                if (!q) return true;
                const hay = `${f.customer?.name || ''} ${(f.customer?.phone || '').replace(/-/g, '')} ${(f.memo || '').replace(/-/g, '')}`;
                return hay.includes(q);
              };
              const base = filteredFollowUps;
              const searched = q ? base.filter(matchQ) : [];
              const dayList = base.filter((f) => f.scheduled_date === followDate);
              const overdue = base.filter((f) => !f.is_completed && f.scheduled_date < today);
              const countByDate: Record<string, number> = {};
              base.forEach((f) => { if (!f.is_completed && !f.visit) countByDate[f.scheduled_date] = (countByDate[f.scheduled_date] || 0) + 1; }); // 방문 잡힌 건은 문자 대상이 아니라 숫자에서 뺌 (2026-11-22)
              const visitsOnDay = base.filter((f) => !f.is_completed && f.visit && f.visit.appointment_date === followDate);
              // 달력 셀
              const first = new Date(followMonth.y, followMonth.m, 1);
              const startPad = first.getDay();
              const daysInMonth = new Date(followMonth.y, followMonth.m + 1, 0).getDate();
              const cells: (string | null)[] = [...Array(startPad).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${followMonth.y}-${String(followMonth.m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)];
              while (cells.length % 7) cells.push(null);
              const goMonth = (d: number) => setFollowMonth(({ y, m }) => { const nd = new Date(y, m + d, 1); return { y: nd.getFullYear(), m: nd.getMonth() }; });
              const pickDate = (iso: string) => { setFollowDate(iso); setFollowSearch(''); };
              const dateLabel = (iso: string) => { const d = new Date(iso + 'T00:00:00'); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${['일', '월', '화', '수', '목', '금', '토'][d.getDay()]}요일`; };

              return (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
                    {/* 왼쪽: 검색 + 달력 */}
                    <div className="space-y-3">
                      <input
                        value={followSearch}
                        onChange={(e) => setFollowSearch(e.target.value)}
                        placeholder="고객 이름·전화번호로 찾기"
                        className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2.5 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50"
                      />
                      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <button onClick={() => goMonth(-1)} className="w-8 h-8 rounded-full border border-[var(--c-border)] hover:bg-[var(--c-subtle)] flex items-center justify-center text-[var(--c-text-2)] text-base leading-none transition-colors" aria-label="이전 달">‹</button>
                          <div className="text-sm font-semibold text-[var(--c-text-1)]">{followMonth.y}년 {followMonth.m + 1}월</div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => { const d = new Date(); setFollowMonth({ y: d.getFullYear(), m: d.getMonth() }); pickDate(today); }} className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-[var(--c-border)] text-[var(--c-text-2)] hover:bg-[var(--c-subtle)] transition-colors">오늘</button>
                            <button onClick={() => goMonth(1)} className="w-8 h-8 rounded-full border border-[var(--c-border)] hover:bg-[var(--c-subtle)] flex items-center justify-center text-[var(--c-text-2)] text-base leading-none transition-colors" aria-label="다음 달">›</button>
                          </div>
                        </div>
                        <div className="grid grid-cols-7 text-center text-[10px] text-[var(--c-text-4)] mb-1">{['일', '월', '화', '수', '목', '금', '토'].map((w) => <div key={w}>{w}</div>)}</div>
                        <div className="grid grid-cols-7 gap-1">
                          {cells.map((iso, i) => {
                            if (!iso) return <div key={`e${i}`} />;
                            const n = countByDate[iso] || 0;
                            const sel = iso === followDate && !q;
                            const isToday = iso === today;
                            const past = iso < today;
                            return (
                              <button key={iso} onClick={() => pickDate(iso)}
                                className={`relative aspect-square rounded-lg text-xs flex flex-col items-center justify-center gap-0.5 transition-colors ${sel ? 'bg-[var(--c-subtle)] ring-1 ring-[var(--c-border)] text-[var(--c-text-1)] font-semibold' : 'hover:bg-[var(--c-hover)] text-[var(--c-text-2)]'}`}>
                                <span className={`w-6 h-6 rounded-full flex items-center justify-center ${isToday ? 'bg-[var(--c-text-1)] text-[var(--c-card)] font-bold' : ''}`}>{Number(iso.slice(-2))}</span>
                                {n > 0 && <span className={`text-[9px] leading-none px-1.5 py-0.5 rounded-full ${past ? 'bg-danger/15 text-danger' : 'bg-info/15 text-info'}`}>{n}</span>}
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-2 text-[10px] text-[var(--c-text-4)]">숫자 = 그날 보낼 미처리 건수 · 빨간 숫자 = 지난 건</div>
                      </div>
                    </div>

                    {/* 오른쪽: 그날 목록 / 검색 결과 */}
                    <div className="space-y-3 min-w-0">
                      {q ? (
                        <>
                          <div className="text-sm text-[var(--c-text-2)]">"{followSearch.trim()}" 검색 결과 <span className="text-gold font-semibold">{searched.length}</span>건</div>
                          {searched.map(renderFollowUp)}
                          {searched.length === 0 && <div className="text-center py-12 text-sm text-[var(--c-text-3)]">일치하는 고객이 없습니다</div>}
                        </>
                      ) : (
                        <>
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold text-[var(--c-text-1)]">{dateLabel(followDate)}{followDate === today ? ' (오늘)' : ''} <span className="text-gold">{dayList.filter((f) => !f.visit || f.is_completed).length}</span>건{visitsOnDay.length > 0 && <span className="ml-2 text-xs font-medium text-info">📅 방문 {visitsOnDay.length}건</span>}</div>
                          </div>
                          {dayList.map(renderFollowUp)}
                          {dayList.length === 0 && <div className="text-center py-10 text-sm text-[var(--c-text-3)]">이 날 보낼 사후관리 문자가 없습니다</div>}
                          {overdue.length > 0 && (
                            <div className="pt-2">
                              <button onClick={() => setShowOverdue((v) => !v)} className="w-full text-left text-xs px-3 py-2 rounded-lg bg-danger/10 text-danger hover:bg-danger/15">
                                {showOverdue ? '▾' : '▸'} 지난 미처리 {overdue.length}건 {showOverdue ? '접기' : '보기'}
                              </button>
                              {showOverdue && <div className="space-y-3 mt-3">{overdue.map(renderFollowUp)}</div>}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}

            {/* 프로모션 발송 섹션 */}
            <div className="mt-6 bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gold mb-4">프로모션 발송</h3>
              {(() => {
                const month = new Date().getMonth() + 1;
                const promos = [
                  { season: '봄', months: [3,4,5], label: '신차 시즌 패키지', tpl: (n: string) => `${n}님, 3M 프로이즘입니다. 봄 신차 출고 시즌 맞이 신차패키지 특별 할인 진행 중입니다. PPF+썬팅+코팅 풀패키지 문의주세요! 010-7287-7140` },
                  { season: '여름', months: [6,7,8], label: '썬팅 시즌 할인', tpl: (n: string) => `${n}님, 3M 프로이즘입니다. 여름맞이 썬팅 특별가 진행 중입니다. 3M 크리스탈라인/루마 버텍스 시공 시 사이드미러 PPF 무료! 010-7287-7140` },
                  { season: '가을', months: [9,10,11], label: '컬러 체인지 시즌', tpl: (n: string) => `${n}님, 3M 프로이즘입니다. 가을 랩핑/컬러PPF 시즌 할인 진행 중입니다. 3M 2080/PWF로 새로운 컬러 체험해보세요! 010-7287-7140` },
                  { season: '겨울', months: [12,1,2], label: 'PPF 보호 시즌', tpl: (n: string) => `${n}님, 3M 프로이즘입니다. 겨울철 염화칼슘/비산먼지 대비 PPF 시공 특가 진행 중입니다. 프로200 풀랩 할인 문의주세요! 010-7287-7140` },
                  { season: '연중', months: [1,2,3,4,5,6,7,8,9,10,11,12], label: '재방문 고객 혜택', tpl: (n: string) => `${n}님, 3M 프로이즘입니다. 기존 고객님 대상 재시공 10% 할인 혜택 드립니다. 추가 시공이나 메인터넌스 문의주세요! 010-7287-7140` },
                ];
                const activePromos = promos.filter((p) => p.months.includes(month));

                return (
                  <div className="space-y-3">
                    {activePromos.map((promo) => (
                      <div key={promo.label} className="border border-[var(--c-border)] rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs bg-gold/20 text-gold px-2 py-0.5 rounded">{promo.season}</span>
                            <span className="text-sm text-[var(--c-text-1)] font-medium">{promo.label}</span>
                          </div>
                        </div>
                        <p className="text-xs text-[var(--c-text-3)] mb-3 leading-relaxed">{promo.tpl('{고객명}')}</p>
                        <div className="flex items-center gap-2">
                          <select id={`promo-cust-${promo.label}`} className="flex-1 bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--c-text-1)] outline-none">
                            <option value="">고객 선택</option>
                            {allCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>)}
                          </select>
                          {(() => {
                            const getPromoCustomer = () => {
                              const sel = document.getElementById(`promo-cust-${promo.label}`) as HTMLSelectElement;
                              const custId = sel?.value;
                              const cust = allCustomers.find((c) => c.id === custId);
                              if (!cust) { alert('고객을 선택해주세요.'); return null; }
                              return cust;
                            };
                            const trackPromo = (cust: { id: string; name: string }, msg: string) => {
                              fetch('/api/promotions', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ customer_id: cust.id, customer_name: cust.name, promotion_type: promo.label, message: msg }),
                              }).catch(() => {});
                            };
                            return (
                              <>
                                <button
                                  onClick={() => {
                                    const cust = getPromoCustomer();
                                    if (!cust) return;
                                    const msg = promo.tpl(cust.name).replace(/\\n/g, '\n').trim();
                                    if (window.Kakao?.isInitialized()) {
                                      try {
                                        window.Kakao.Share.sendDefault({
                                          objectType: 'text',
                                          text: msg,
                                          link: { mobileWebUrl: 'https://blog.naver.com/roice_', webUrl: 'https://blog.naver.com/roice_' },
                                          buttonTitle: '블로그 방문',
                                        });
                                      } catch {
                                        const kakaoLink = `https://sharer.kakao.com/talk/friends/picker/link?url=${encodeURIComponent('https://blog.naver.com/roice_')}&text=${encodeURIComponent(msg)}`;
                                        window.open(kakaoLink, '_blank', 'width=480,height=600');
                                      }
                                    } else {
                                      navigator.clipboard.writeText(msg);
                                      alert('카카오 SDK 로딩 중입니다. 문구가 복사되었으니 카톡에 직접 붙여넣기 해주세요.');
                                    }
                                    trackPromo(cust, msg);
                                  }}
                                  className="text-xs bg-[#FEE500] hover:bg-[#FDD835] text-[#191919] font-semibold rounded-lg px-3 py-1.5 transition-colors whitespace-nowrap"
                                >
                                  카톡
                                </button>
                                <button
                                  onClick={() => {
                                    const cust = getPromoCustomer();
                                    if (!cust || !cust.phone) { if (cust) alert('전화번호가 없습니다.'); return; }
                                    const msg = promo.tpl(cust.name);
                                    window.open(`sms:${cust.phone}&body=${encodeURIComponent(msg)}`);
                                    trackPromo(cust, msg);
                                  }}
                                  className="text-xs bg-info hover:bg-info text-white font-semibold rounded-lg px-3 py-1.5 transition-colors whitespace-nowrap"
                                >
                                  문자
                                </button>
                                <button
                                  onClick={() => {
                                    const cust = getPromoCustomer();
                                    if (!cust) return;
                                    const msg = promo.tpl(cust.name);
                                    navigator.clipboard.writeText(msg);
                                    trackPromo(cust, msg);
                                    alert(`${cust.name}님 문구가 복사되었습니다.`);
                                  }}
                                  className="text-xs bg-gold hover:bg-gold/90 text-white font-semibold rounded-lg px-3 py-1.5 transition-colors whitespace-nowrap"
                                >
                                  복사
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ─── TAB: 상담 기록 ──────────────────────────────── */}
        {activeTab === 'consultations' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm text-[var(--c-text-3)]">{consultations.length}건의 상담</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowInquiry(true)}
                  className="border border-[var(--c-border)] hover:bg-[var(--c-hover)] text-[var(--c-text-1)] text-sm font-medium rounded-lg px-4 py-2 transition-colors"
                  title="카페·문자로 온 문의 글을 붙여 넣으면 시장 평균가 기준 답장을 만듭니다"
                >
                  💬 문의 답변
                </button>
                <button
                  onClick={() => setQuoteSms({})}
                  className="bg-gold/15 hover:bg-gold/25 text-gold text-sm font-medium rounded-lg px-4 py-2 transition-colors"
                  title="전화 끊고 바로 보내는 견적 문자 (재연락 2회 자동 등록)"
                >
                  📩 견적 문자
                </button>
                <button
                  onClick={() => setShowAddConsultation(true)}
                  className="bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
                >
                  + 상담 추가
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {consultations.map((c) => (
                <div key={c.id} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--c-text-1)]">{c.customer?.name || (c.memo ? c.memo.split(' · ')[0] : '-')}</span>
                      {c.customer?.phone && <span className="text-xs text-[var(--c-text-3)]">{c.customer.phone}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {!c.customer_id && c.memo && /01[016789]-?\d{3,4}-?\d{4}/.test(c.memo) && (
                        <button onClick={() => handleAddCustomerFromQuote(c.memo!)} className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-ok/15 hover:bg-ok/25 text-ok transition-colors">＋ 고객 목록에 추가</button>
                      )}
                      <button
                        onClick={() => {
                          const cu = customers.find((x) => x.id === c.customer_id);
                          const parts = (c.memo || '').split(' · ');
                          const headPhone = parts[0]?.match(/01[016789]-?\d{3,4}-?\d{4}/)?.[0] || '';
                          const headName = headPhone ? parts[0].replace(headPhone, '').trim() : '';
                          setQuoteSms({ customerId: c.customer_id, name: c.customer?.name || cu?.name || headName, phone: c.customer?.phone || cu?.phone || headPhone, car: cu ? [cu.car_brand, cu.car_model].filter(Boolean).join(' ') : (headPhone ? parts[1] || '' : ''), service: c.interested_services || '' });
                        }}
                        className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-gold/10 hover:bg-gold/20 text-gold transition-colors"
                      >
                        📩 견적 문자
                      </button>
                      <span className="text-xs text-[var(--c-text-3)]">{formatDate(c.consultation_date)}</span>
                    </div>
                  </div>
                  {c.content && (/^\[(견적 문자 발송|문의 답변)\]/.test(c.content)
                    ? <details className="mb-2 text-sm text-[var(--c-text-2)]"><summary className="cursor-pointer">{c.content.split('\n')[0]} — 보낸 문자 보기</summary><pre className="whitespace-pre-wrap font-sans mt-2 text-xs text-[var(--c-text-2)] bg-[var(--c-input)] rounded-lg p-3">{c.content.split('\n').slice(1).join('\n')}</pre></details>
                    : <p className="text-sm text-[var(--c-text-2)] mb-2">{c.content}</p>)}
                  <div className="flex items-center gap-3 text-xs text-[var(--c-text-3)]">
                    {c.estimate && <span>견적: <span className="text-gold">{c.estimate}</span></span>}
                    {c.interested_services && <span>관심: <span className="text-[var(--c-text-2)]">{c.interested_services}</span></span>}
                    {c.memo && <span>메모: {c.memo.split(' · ').filter((seg) => !seg.startsWith('사진: ')).join(' · ') || '-'}</span>}
                  </div>
                  {c.memo && c.memo.includes('사진: ') && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {c.memo.split(' · ').filter((seg) => seg.startsWith('사진: ')).flatMap((seg) => seg.slice(4).trim().split(/\s+/)).filter(Boolean).map((u) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="상담 첨부 사진" className="w-20 h-20 object-cover rounded-lg border border-[var(--c-border)] hover:opacity-90" /></a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {consultations.length === 0 && (
                <div className="text-center py-12 text-sm text-[var(--c-text-3)]">등록된 상담 기록이 없습니다</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── TAB: 블로그 (2026-11-12 블로그 페이지를 CRM 탭으로 합침) ─── */}
      {blogVisited && !isDemo && (
        <div className={activeTab === 'blog' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
          <BlogWorkspace embedded prefillNonce={prefillNonce} />
        </div>
      )}
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* ─── Modal: 고객 추가 ────────────────────────────────── */}
      {showAddCustomer && (
        <CustomerFormModal
          mode={editCustomerId ? 'edit' : 'add'}
          form={customerForm}
          setForm={setCustomerForm}
          latestApptId={editLatestApptId}
          referrerId={customerReferrerId}
          setReferrerId={setCustomerReferrerId}
          excludeCustomerId={editCustomerId}
          onSubmit={editCustomerId ? handleUpdateCustomer : handleAddCustomer}
          onClose={() => { setShowAddCustomer(false); setEditCustomerId(null); setEditLatestApptId(null); setCustomerReferrerId(null); }}
        />
      )}

      {/* ─── Modal: 예약 추가 ────────────────────────────────── */}

      {/* 스크린샷으로 예약 등록 (2026-11-18): 사진 고르기 또는 붙여넣기(⌘V) → 읽은 일정 표에서 날짜·시공·고객 고쳐 → 등록 */}
      {showShotImport && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={() => { if (!shotBusy) { setShowShotImport(false); setShotRows([]); setShotHidden([]); } }}>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-3xl p-6 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto" onClick={(e) => e.stopPropagation()} onPaste={(e) => { const f = Array.from(e.clipboardData?.files || []).find((x) => /^image\//.test(x.type)); if (f) { e.preventDefault(); handleShotFile(f); } }} tabIndex={0}>
            <div className="flex items-center justify-between gap-3 mb-1">
              <h3 className="text-[var(--c-text-1)] font-semibold text-base">스크린샷으로 예약 추가</h3>
              <label className="text-xs text-[var(--c-text-3)] flex items-center gap-2">기준 월 <input type="month" value={shotMonth} onChange={(e) => setShotMonth(e.target.value)} className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-2 py-1 text-sm text-[var(--c-text-1)] outline-none" /></label>
            </div>
            <p className="text-xs text-[var(--c-text-3)] mb-4">타임트리 달력 캡처나 카톡 예약 대화를 올리면 날짜·차종·시공을 읽어 아래 표로 보여 줍니다. 표를 고친 뒤 등록을 누르면 예약에 들어갑니다. 이 창에서 ⌘V 로 붙여 넣어도 됩니다.</p>
            <div className="flex items-center gap-2 mb-4">
              <input ref={shotFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleShotFile(e.target.files?.[0])} />
              <button onClick={() => shotFileRef.current?.click()} disabled={shotBusy} className="bg-[var(--c-text-1)] text-[var(--c-page)] text-sm font-semibold rounded-full px-4 py-2 disabled:opacity-50">{shotBusy ? '읽는 중…' : shotRows.length ? '📷 사진 하나 더' : '📷 사진 고르기'}</button>
              {shotRows.length > 0 && <span className="text-xs text-[var(--c-text-3)]">{shotRows.length}건 읽음 · 체크한 {shotRows.filter((r) => r.include).length}건 등록</span>}
            </div>
            {shotHidden.length > 0 && <div className="text-xs text-warn mb-3">접혀서 못 읽은 일정: {shotHidden.map((h) => `${h.date.slice(5).replace('-', '/')} ${h.count}건`).join(', ')} — 그 날짜를 펼친 캡처를 하나 더 올려 주세요</div>}
            <div className="space-y-2">
              {shotRows.map((r) => (
                <div key={r.key} className={`rounded-xl border p-3 ${r.include ? 'border-[var(--c-border)] bg-[var(--c-card)]' : 'border-[var(--c-border)] bg-[var(--c-subtle)] opacity-60'}`}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={r.include} onChange={(e) => updateShotRow(r.key, { include: e.target.checked })} className="mt-1 w-4 h-4 accent-[var(--c-text-1)]" />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-[var(--c-text-1)]">{r.label}</span>
                        {r.time && <span className="text-xs text-[var(--c-text-3)]">{r.time}</span>}
                        {r.note && <span className="text-xs text-[var(--c-text-3)]">{r.note}</span>}
                        {r.duplicateOf && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-danger/10 text-danger">이미 같은 예약이 있음</span>}
                        {r.matchBy && r.mode === 'existing' && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-ok/10 text-ok">{r.matchBy === 'phone' ? '전화번호' : r.matchBy === 'name' ? '이름' : '차종'}으로 기존 고객 찾음</span>}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <label className="text-[11px] text-[var(--c-text-3)]">시작<input type="date" value={r.start} onChange={(e) => updateShotRow(r.key, { start: e.target.value })} className="mt-0.5 w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--c-text-1)] outline-none" /></label>
                        <label className="text-[11px] text-[var(--c-text-3)]">마지막 날<input type="date" value={r.end || ''} onChange={(e) => updateShotRow(r.key, { end: e.target.value || null })} className="mt-0.5 w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--c-text-1)] outline-none" /></label>
                        <label className="text-[11px] text-[var(--c-text-3)]">시공
                          <select value={r.service || ''} onChange={(e) => updateShotRow(r.key, { service: e.target.value || null })} className="mt-0.5 w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--c-text-1)] outline-none">
                            <option value="">미정</option>
                            {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </label>
                        <label className="text-[11px] text-[var(--c-text-3)]">상태
                          <select value={r.status} onChange={(e) => updateShotRow(r.key, { status: e.target.value as ShotRow['status'] })} className="mt-0.5 w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--c-text-1)] outline-none">
                            <option value="예약확정">예약확정</option>
                            <option value="시공중">시공중</option>
                          </select>
                        </label>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <label className="text-[11px] text-[var(--c-text-3)]">고객
                          <select value={r.mode === 'existing' && r.customerId ? r.customerId : '__new__'} onChange={(e) => { const v = e.target.value; if (v === '__new__') updateShotRow(r.key, { mode: 'new', customerId: null }); else { const c = allCustomers.find((x) => x.id === v); updateShotRow(r.key, { mode: 'existing', customerId: v, customerName: c?.name || null }); } }} className="mt-0.5 w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--c-text-1)] outline-none">
                            <option value="__new__">새 고객으로 등록</option>
                            {allCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.car_model ? ` · ${c.car_model}` : ''}{c.phone ? ` · ${c.phone.slice(-4)}` : ''}</option>)}
                          </select>
                        </label>
                        {r.mode === 'new' && (
                          <label className="text-[11px] text-[var(--c-text-3)]">새 고객 이름<input type="text" value={r.newCustomerName} onChange={(e) => updateShotRow(r.key, { newCustomerName: e.target.value })} placeholder="이름을 모르면 차 이름으로" className="mt-0.5 w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--c-text-1)] outline-none" /></label>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {shotRows.length === 0 && !shotBusy && <div className="py-10 text-center text-sm text-[var(--c-text-4)] border border-dashed border-[var(--c-border)] rounded-xl">사진을 고르거나 여기에 붙여 넣으세요</div>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => { setShowShotImport(false); setShotRows([]); setShotHidden([]); }} disabled={shotBusy} className="text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-1)] px-4 py-2 disabled:opacity-50">닫기</button>
              <button onClick={handleShotRegister} disabled={shotBusy || shotRows.filter((r) => r.include).length === 0} className="bg-brand hover:bg-brand-dark text-white text-sm font-semibold rounded-full px-5 py-2 disabled:opacity-40">{shotRows.filter((r) => r.include).length}건 등록</button>
            </div>
          </div>
        </div>
      )}
      {showAddAppointment && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={() => setShowAddAppointment(false)}>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--c-text-1)] font-semibold text-base mb-4">예약 추가</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">고객 *</label>
                <CustomerPicker value={appointmentForm.customer_id} onChange={(id) => setAppointmentForm({ ...appointmentForm, customer_id: id })} />
              </div>
              {apptVehicles.length > 1 && (
                <div>
                  <label className="text-xs text-[var(--c-text-3)] mb-1 block">어느 차 *</label>
                  <select value={appointmentForm.vehicle_id} onChange={(e) => setAppointmentForm({ ...appointmentForm, vehicle_id: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50">
                    {apptVehicles.map((v) => <option key={v.id} value={v.id}>{vehicleLabel(v, true) || '차량'}{v.is_primary ? ' (대표)' : ''}</option>)}
                  </select>
                </div>
              )}
              {apptVehicles.length === 1 && <div className="text-xs text-[var(--c-text-3)]">차량: {vehicleLabel(apptVehicles[0], true)}</div>}
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">시공 시작일 *</label>
                <input type="date" value={appointmentForm.appointment_date} onChange={(e) => setAppointmentForm({ ...appointmentForm, appointment_date: e.target.value })} onInput={(e) => setAppointmentForm({ ...appointmentForm, appointment_date: (e.target as HTMLInputElement).value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">시공 종료일</label>
                <input type="date" value={appointmentForm.end_date} onChange={(e) => setAppointmentForm({ ...appointmentForm, end_date: e.target.value })} onInput={(e) => setAppointmentForm({ ...appointmentForm, end_date: (e.target as HTMLInputElement).value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">시공 종류</label>
                <select value={appointmentForm.service_type} onChange={(e) => setAppointmentForm({ ...appointmentForm, service_type: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50">
                  <option value="">선택...</option>
                  {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">예상 금액</label>
                <input type="text" inputMode="numeric" value={appointmentForm.amount ? Number(appointmentForm.amount).toLocaleString() : ''} onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ''); setAppointmentForm({ ...appointmentForm, amount: raw }); }} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="2,500,000" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">메모</label>
                <textarea value={appointmentForm.memo} onChange={(e) => setAppointmentForm({ ...appointmentForm, memo: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50 resize-none h-20" placeholder="메모" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAddAppointment(false)} className="px-4 py-2 text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-2)] transition-colors">취소</button>
              <button onClick={handleAddAppointment} className="bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">추가</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: 상담 추가 ────────────────────────────────── */}
      {showAddConsultation && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={() => setShowAddConsultation(false)}>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--c-text-1)] font-semibold text-base mb-4">상담 추가</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">고객 목록에 있는 분이면 선택 (선택사항)</label>
                <CustomerPicker value={consultationForm.customer_id} onChange={(id) => setConsultationForm({ ...consultationForm, customer_id: id })} />
              </div>
              {!consultationForm.customer_id && (
                <div className="rounded-xl border border-dashed border-[var(--c-border)] bg-[var(--c-subtle)]/60 p-3">
                  <div className="text-xs font-semibold text-[var(--c-text-2)] mb-2">고객 목록에 없는 분 — 이름·전화만 적으면 됩니다 (전화 필수)</div>
                  <div className="grid grid-cols-3 gap-2">
                    <input type="text" placeholder="이름" value={consultationForm.name} onChange={(e) => setConsultationForm({ ...consultationForm, name: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[var(--c-text-1)]" />
                    <input type="tel" placeholder="010-0000-0000 *" value={consultationForm.phone} onChange={(e) => setConsultationForm({ ...consultationForm, phone: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[var(--c-text-1)]" />
                    <input type="text" placeholder="차종 (예: 포르쉐 카이엔)" value={consultationForm.car} onChange={(e) => setConsultationForm({ ...consultationForm, car: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[var(--c-text-1)]" />
                  </div>
                  <div className="text-[11px] text-[var(--c-text-3)] mt-2">계약으로 이어지면 상담 기록 줄의 "＋ 고객 목록에 추가"로 등록하면 이 기록이 자동으로 연결됩니다</div>
                </div>
              )}
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">상담 날짜 (비우면 오늘)</label>
                <input type="date" value={consultationForm.consultation_date} onChange={(e) => setConsultationForm({ ...consultationForm, consultation_date: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">상담 내용</label>
                <textarea value={consultationForm.content} onChange={(e) => setConsultationForm({ ...consultationForm, content: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50 resize-none h-24" placeholder="상담 내용을 입력하세요" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--c-text-3)] mb-1 block">견적</label>
                  <input type="text" value={consultationForm.estimate} onChange={(e) => setConsultationForm({ ...consultationForm, estimate: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="예: 350만원" />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-text-3)] mb-1 block">관심 시공</label>
                  <input type="text" value={consultationForm.interested_services} onChange={(e) => setConsultationForm({ ...consultationForm, interested_services: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="PPF, 썬팅 등" />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">사진 (통화 기록·문자 캡처 등. 올리면 이름·전화·차종을 읽어 빈 칸을 채웁니다)</label>
                <div className="flex flex-wrap items-center gap-2">
                  {consultationForm.photos.map((u) => (
                    <div key={u} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="첨부 사진" className="w-16 h-16 object-cover rounded-lg border border-[var(--c-border)]" />
                      <button type="button" onClick={() => setConsultationForm({ ...consultationForm, photos: consultationForm.photos.filter((x) => x !== u) })} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--c-text-1)] text-[var(--c-card)] text-[10px] flex items-center justify-center" title="빼기">✕</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => consultPhotoRef.current?.click()} disabled={consultPhotoBusy} className="w-16 h-16 rounded-lg border border-dashed border-[var(--c-border)] hover:border-[var(--c-text-1)] text-[var(--c-text-3)] hover:text-[var(--c-text-1)] flex flex-col items-center justify-center text-[11px] transition-colors disabled:opacity-50">
                    <span className="text-lg leading-none">{consultPhotoBusy ? '…' : '📷'}</span>{consultPhotoBusy ? '읽는 중' : '사진 추가'}
                  </button>
                  <input ref={consultPhotoRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleConsultPhoto(e.target.files?.[0])} />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">메모</label>
                <input type="text" value={consultationForm.memo} onChange={(e) => setConsultationForm({ ...consultationForm, memo: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="메모" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAddConsultation(false)} className="px-4 py-2 text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-2)] transition-colors">취소</button>
              <button onClick={handleAddConsultation} className="bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">추가</button>
            </div>
          </div>
        </div>
      )}
      {/* ─── Modal: 작업 내역서 ──────────────────────────────── */}
      {retouchTarget && (
        <CareCompleteModal
          type={RETOUCH_TYPE}
          customerName={retouchTarget.customer?.name || '고객'}
          services={retouchServices}
          onClose={() => setRetouchTarget(null)}
          onDone={(note, photos, serviceId) => handleRetouchDone(retouchTarget, note, photos, serviceId)}
        />
      )}
      {careBook && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-end sm:items-center justify-center p-3" onClick={() => setCareBook(null)}>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl w-full max-w-sm p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[var(--c-text-1)] font-semibold">{careBook.follow_up_type === 'QC점검' ? 'QC 점검' : '메인터넌스'} 방문 잡기</div>
            <div className="text-xs text-[var(--c-text-3)] mt-0.5 mb-4">{careBook.customer?.name || '고객'} 고객님 · 예약/일정 달력에 들어가고 손님 페이지 '다음 관리' 날짜도 이 날로 바뀝니다</div>
            <div className="space-y-3">
              <div><label className="text-xs text-[var(--c-text-3)] mb-1 block">방문일 *</label><input type="date" value={careBookForm.date} onChange={(e) => setCareBookForm({ ...careBookForm, date: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" /></div>
              <div><label className="text-xs text-[var(--c-text-3)] mb-1 block">시간 (선택)</label><input value={careBookForm.time} onChange={(e) => setCareBookForm({ ...careBookForm, time: e.target.value })} placeholder="오후 2시" className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" /></div>
              <div><label className="text-xs text-[var(--c-text-3)] mb-1 block">메모 (선택)</label><input value={careBookForm.memo} onChange={(e) => setCareBookForm({ ...careBookForm, memo: e.target.value })} placeholder="앞범퍼 기포 봐 달라 하심" className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" /></div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setCareBook(null)} className="text-sm px-4 py-2 rounded-lg border border-[var(--c-border)] text-[var(--c-text-2)]">취소</button>
              <button onClick={handleBookCareVisit} disabled={!careBookForm.date} className="text-sm px-4 py-2 rounded-lg bg-brand text-white disabled:opacity-40">달력에 넣기</button>
            </div>
          </div>
        </div>
      )}
      {careTarget && (
        <CareCompleteModal
          type={careTarget.follow_up_type}
          customerName={careTarget.customer?.name || '고객'}
          onClose={() => { setCareTarget(null); setCareVisitAppt(null); }}
          onDone={(note, photos) => handleCareDone(careTarget, note, photos)}
          onSkip={(reason) => handleCareSkip(careTarget, reason)}
        />
      )}
      {showWorkOrder && workOrderAppointment && (
        <WorkOrderModal
          appointment={workOrderAppointment}
          workOrder={workOrder}
          setWorkOrder={setWorkOrder}
          onSubmit={handleWorkOrderSubmit}
          onSaveOnly={handleWorkOrderSaveOnly}
          onClose={() => { setShowWorkOrder(false); setWorkOrderAppointment(null); }}
          busy={workOrderBusy}
        />
      )}
      {showCalendarSub && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={() => setShowCalendarSub(false)}>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--c-text-1)] font-semibold text-base mb-4">캘린더 구독</h3>
            <p className="text-xs text-[var(--c-text-3)] mb-3">아래 URL을 캘린더 앱에서 구독하면 예약 일정이 자동으로 동기화됩니다.</p>
            <div className="flex items-center gap-2 mb-4">
              <input readOnly value="https://proism-ai.vercel.app/api/calendar?token=proism2026" className="flex-1 bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-xs text-[var(--c-text-1)] outline-none select-all" onFocus={(e) => e.target.select()} />
              <button onClick={() => { navigator.clipboard.writeText('https://proism-ai.vercel.app/api/calendar?token=proism2026'); alert('URL이 복사되었습니다!'); }} className="bg-info hover:bg-info text-white text-xs font-medium rounded-lg px-3 py-2 transition-colors whitespace-nowrap">URL 복사</button>
            </div>
            <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-4 text-xs text-[var(--c-text-2)] space-y-1.5">
              <div className="text-gold font-medium mb-1">구독 방법</div>
              <div>1. TimeTree 앱 → 설정 → 캘린더 구독 → URL 붙여넣기</div>
              <div>2. 팀원들도 같은 URL로 구독하면 모두 같이 볼 수 있습니다</div>
              <div>3. 예약이 추가/변경되면 자동으로 반영됩니다</div>
              <div className="border-t border-[var(--c-border)] pt-1.5 mt-1.5">* Apple 캘린더: 파일 → 새 캘린더 구독 → URL 입력</div>
              <div>* Google 캘린더: 설정 → 캘린더 추가 → URL로 추가</div>
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowCalendarSub(false)} className="px-4 py-2 text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-2)] transition-colors">닫기</button>
            </div>
          </div>
        </div>
      )}
      {quoteSms && (
        <QuoteSmsModal initial={quoteSms} onClose={() => setQuoteSms(null)} onDone={() => { fetchFollowUps(); if (activeTab === 'consultations') fetchConsultations(); }} />
      )}
      {showInquiry && (
        <InquiryReplyModal onClose={() => setShowInquiry(false)} onDone={() => { fetchFollowUps(); if (activeTab === 'consultations') fetchConsultations(); }} />
      )}
      {showWarranty && warrantyAppointment && (
        <WarrantyModal
          warrantyForm={warrantyForm}
          setWarrantyForm={setWarrantyForm}
          onSave={handleSaveWarranty}
          onDownloaded={handleWarrantyDownloaded}
          onClose={() => { setShowWarranty(false); setWarrantyAppointment(null); }}
        />
      )}

      {/* Footer (블로그 탭에서는 입력창을 가리므로 숨김) */}
      {activeTab !== 'blog' && (
        <div className="fixed bottom-0 left-0 right-0 bg-[var(--c-input)]/80 backdrop-blur-sm border-t border-[var(--c-border)] py-1.5 px-4 text-center text-[10px] text-[var(--c-text-4)] z-10">
          3M 프로이즘 | 서초중앙로8길 82, 1동 1층 | 010-7287-7140 | poi_1357@naver.com
        </div>
      )}
    </div>
  );
}

// ─── Work Order Modal Component ──────────────────────────
interface WorkOrderModalProps {
  appointment: Appointment;
  workOrder: ReturnType<typeof Object>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setWorkOrder: (v: any) => void;
  onSubmit: () => void;
  onSaveOnly: () => void;
  onClose: () => void;
  /** 완료 처리 진행 중 — 버튼 잠금 (이중 제출 방지) */
  busy?: boolean;
}

function CheckItem({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 cursor-pointer text-sm text-[var(--c-text-1)] hover:text-gold transition-colors select-none"
    >
      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${checked ? 'bg-gold border-gold' : 'border-[var(--c-text-4)]'}`}>
        {checked && <span className="text-[10px] text-black font-bold">✓</span>}
      </div>
      <span>{label}</span>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="border-t border-[var(--c-border)] pt-4 mt-4">
      <h4 className="text-sm font-semibold text-gold mb-3">{title}</h4>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PrintCheck({ checked }: { checked: boolean }) {
  return checked
    ? <span style={{ background: '#E4002B', color: '#fff', padding: '2px 4px', borderRadius: '3px', fontSize: '14px', fontWeight: 'bold', marginRight: '6px', lineHeight: 1 }}>✓</span>
    : <span style={{ border: '2px solid #ccc', display: 'inline-block', width: '16px', height: '16px', borderRadius: '3px', marginRight: '6px', verticalAlign: 'middle' }} />;
}

function WorkOrderModal({ appointment, workOrder, setWorkOrder, onSubmit, onSaveOnly, onClose, busy }: WorkOrderModalProps & { workOrder: any }) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePdfSave = async () => {
    if (!printRef.current) return;
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const link = document.createElement('a');
    const customerName = appointment.customer?.name || '고객';
    const dateStr = todaySeoul();
    link.download = `프로이즘_작업내역서_${customerName}_${dateStr}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const toggleArray = (arr: string[], item: string) =>
    arr.includes(item) ? arr.filter((v: string) => v !== item) : [...arr, item];

  const toggleTinting = (brand: 'vertex' | 'rainbow' | 'glasstint' | 'tinain', product: string) => {
    setWorkOrder({
      ...workOrder,
      tinting: {
        ...workOrder.tinting,
        [brand]: {
          ...workOrder.tinting[brand],
          selected: toggleArray(workOrder.tinting[brand].selected, product),
        },
      },
    });
  };

  const setTintingDensity = (brand: 'vertex' | 'rainbow' | 'glasstint' | 'tinain', density: string) => {
    setWorkOrder({
      ...workOrder,
      tinting: {
        ...workOrder.tinting,
        [brand]: { ...workOrder.tinting[brand], density },
      },
    });
  };

  const customer = appointment.customer;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-4xl max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-[var(--c-card)] border-b border-[var(--c-border)] px-6 py-4 flex items-center justify-between z-10">
          <h3 className="text-[var(--c-text-1)] font-semibold text-base">작업 내역서</h3>
          <button onClick={onClose} className="text-[var(--c-text-3)] hover:text-[var(--c-text-1)] transition-colors text-lg">✕</button>
        </div>

        <div className="p-6 space-y-0">
          {/* 고객 정보 */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">일자</label>
              <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-2)]">
                {new Date().toLocaleDateString('ko-KR')}
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">브랜드/차종</label>
              <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-2)]">
                {appointment.service_type || '-'}
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">차량번호</label>
              <input type="text" value={workOrder.car_number} onChange={(e) => setWorkOrder({ ...workOrder, car_number: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="12가 3456" />
            </div>
            <div>
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">성명</label>
              <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-2)]">
                {customer?.name || '-'}
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">금액 (원)</label>
              <input type="text" inputMode="numeric" value={workOrder.amount ? Number(String(workOrder.amount).replace(/[^\d]/g, '') || 0).toLocaleString() : ''} onChange={(e) => setWorkOrder({ ...workOrder, amount: e.target.value.replace(/[^\d]/g, '') })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder={appointment.amount ? Number(appointment.amount).toLocaleString() : '예: 5,500,000'} />
            </div>
            <div>
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">연락처</label>
              <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-2)]">
                {customer?.phone || '-'}
              </div>
            </div>
          </div>

          {/* 체크 */}
          <div className="flex gap-6 mb-2">
            <CheckItem label="보증서 발행 유무" checked={workOrder.warranty_issued} onChange={(v) => setWorkOrder({ ...workOrder, warranty_issued: v })} />
            <CheckItem label="CRM 기재 유무" checked={workOrder.crm_recorded} onChange={(v) => setWorkOrder({ ...workOrder, crm_recorded: v })} />
          </div>

          {/* 썬팅 */}
          <SectionTitle title="썬팅" />
          <div className="space-y-3">
            {([
              { brand: 'vertex' as const, label: '버텍스', products: ['1100(비반사)', '900(비반사)', '700(비반사)', '500(비반사)', '기타'] },
              { brand: 'rainbow' as const, label: '레인보우', products: ['IS200(비반사)', 'IS100(비반사)', 'I55(비반사)', 'VS200(반사)', 'V90(반사)', '기타'] },
              { brand: 'glasstint' as const, label: '글라스틴트', products: ['산타나(비반사)', '로데(비반사)', '선셋(반사)', '펜더S(비반사)', '기타'] },
              { brand: 'tinain' as const, label: '티나인', products: ['V100(반사)', 'R100(비반사)', '기타'] },
            ]).map(({ brand, label, products }) => (
              <div key={brand} className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-[var(--c-text-2)]">{label}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-[var(--c-text-3)]">농도:</span>
                    <input type="text" value={workOrder.tinting[brand].density} onChange={(e) => setTintingDensity(brand, e.target.value)} className="w-40 bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="전면 30 / 측후면 15" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  {products.map((p) => (
                    <CheckItem key={p} label={p} checked={workOrder.tinting[brand].selected.includes(p)} onChange={() => toggleTinting(brand, p)} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* PPF & 랩핑 */}
          <SectionTitle title="PPF & 랩핑" />
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-3">
              <span className="text-xs font-medium text-[var(--c-text-2)] mb-2 block">PPF</span>
              <div className="flex flex-wrap gap-3 mb-2">
                {['전체PPF', '프론트패키지', '생활보호패키지'].map((p) => (
                  <CheckItem key={p} label={p} checked={workOrder.ppf.includes(p)} onChange={() => setWorkOrder({ ...workOrder, ppf: toggleArray(workOrder.ppf, p) })} />
                ))}
              </div>
              <input type="text" value={workOrder.ppf_etc} onChange={(e) => setWorkOrder({ ...workOrder, ppf_etc: e.target.value })} className="w-full bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="기타 (직접 입력)" />
            </div>
            <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-3">
              <span className="text-xs font-medium text-[var(--c-text-2)] mb-2 block">랩핑</span>
              <div className="flex flex-wrap gap-3 mb-2">
                {['전체랩핑', '부분'].map((p) => (
                  <CheckItem key={p} label={p} checked={workOrder.wrapping.includes(p)} onChange={() => setWorkOrder({ ...workOrder, wrapping: toggleArray(workOrder.wrapping, p) })} />
                ))}
              </div>
              <input type="text" value={workOrder.wrapping_etc} onChange={(e) => setWorkOrder({ ...workOrder, wrapping_etc: e.target.value })} className="w-full bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="기타 (직접 입력)" />
            </div>
          </div>

          {/* 코팅 */}
          <SectionTitle title="코팅시공" />
          <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-3">
            <div className="flex flex-wrap gap-3">
              {['기본유리막', '9H', '10H', '그래핀PRO', '가죽코팅(시트)', '가죽코팅(전체)', '발수코팅', '필름코팅'].map((p) => (
                <CheckItem key={p} label={p} checked={workOrder.coating.includes(p)} onChange={() => setWorkOrder({ ...workOrder, coating: toggleArray(workOrder.coating, p) })} />
              ))}
            </div>
          </div>

          {/* 기타 */}
          <SectionTitle title="기타" />
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-3">
              <span className="text-xs font-medium text-[var(--c-text-2)] mb-2 block">전장시공</span>
              <div className="flex flex-wrap gap-3 mb-2">
                {['블랙박스', '하이패스'].map((p) => (
                  <CheckItem key={p} label={p} checked={workOrder.electrical.includes(p)} onChange={() => setWorkOrder({ ...workOrder, electrical: toggleArray(workOrder.electrical, p) })} />
                ))}
              </div>
              <input type="text" value={workOrder.electrical_etc} onChange={(e) => setWorkOrder({ ...workOrder, electrical_etc: e.target.value })} className="w-full bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="기타 (직접 입력)" />
            </div>
            <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-3">
              <span className="text-xs font-medium text-[var(--c-text-2)] mb-2 block">프리미엄광택</span>
              <div className="flex flex-wrap gap-3 mb-2">
                {['전체광택', '부분광택'].map((p) => (
                  <CheckItem key={p} label={p} checked={workOrder.polish.includes(p)} onChange={() => setWorkOrder({ ...workOrder, polish: toggleArray(workOrder.polish, p) })} />
                ))}
              </div>
              <input type="text" value={workOrder.polish_etc} onChange={(e) => setWorkOrder({ ...workOrder, polish_etc: e.target.value })} className="w-full bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="기타 (직접 입력)" />
            </div>
          </div>

          {/* 신차패키지 옵션 */}
          <SectionTitle title="신차패키지 옵션" />
          <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-3">
            <div className="flex flex-wrap gap-3">
              {['신차검수', '내외부디테일링세차', '타이어왁스', '피톤치드연막'].map((p) => (
                <CheckItem key={p} label={p} checked={workOrder.package_options.includes(p)} onChange={() => setWorkOrder({ ...workOrder, package_options: toggleArray(workOrder.package_options, p) })} />
              ))}
            </div>
          </div>

          {/* 특이사항 */}
          <SectionTitle title="특이사항 및 비고" />
          <textarea
            value={workOrder.notes}
            onChange={(e) => setWorkOrder({ ...workOrder, notes: e.target.value })}
            className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50 resize-none h-24"
            placeholder="특이사항을 입력하세요"
          />
        </div>

        {/* Hidden Print Div */}
        <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
          <div ref={printRef} style={{ width: '800px', padding: '40px', backgroundColor: '#fff', fontFamily: '"Pretendard Variable", -apple-system, sans-serif', color: '#000', fontSize: '12px' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: '#E4002B', letterSpacing: '2px' }}>3M PROIZM</div>
                <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>3M 공식 프리퍼드 인스톨러 인증점</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '22px', fontWeight: 700 }}>작업 리스트</div>
                <div style={{ fontSize: '11px', color: '#888' }}>일반 / 고정</div>
              </div>
            </div>
            {/* 체크 */}
            <div style={{ display: 'flex', gap: '24px', marginBottom: '12px', fontSize: '13px', alignItems: 'center' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.warranty_issued} /> 보증서 발행 유무</span>
              <span style={{ display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.crm_recorded} /> CRM 기재 유무</span>
            </div>
            {/* 고객 정보 테이블 */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
              <tbody>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600, width: '80px' }}>일자</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{new Date().toLocaleDateString('ko-KR')}</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600, width: '80px' }}>브랜드/차종</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{appointment.service_type || '-'}</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600, width: '80px' }}>차량번호</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{workOrder.car_number || '-'}</td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>성명</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{appointment.customer?.name || '-'}</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>유입경로</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>-</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>연락처</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{appointment.customer?.phone || '-'}</td>
                </tr>
              </tbody>
            </table>
            {/* 썬팅 */}
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px', borderBottom: '2px solid #E4002B', paddingBottom: '4px' }}>썬팅</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
              <tbody>
                {([
                  { label: '버텍스', brand: 'vertex' as const, items: ['1100(비반사)', '900(비반사)', '700(비반사)', '500(비반사)', '기타'] },
                  { label: '레인보우', brand: 'rainbow' as const, items: ['IS200(비반사)', 'IS100(비반사)', 'I55(비반사)', 'VS200(반사)', 'V90(반사)', '기타'] },
                  { label: '글라스틴트', brand: 'glasstint' as const, items: ['산타나(비반사)', '로데(비반사)', '선셋(반사)', '펜더S(비반사)', '기타'] },
                  { label: '티나인', brand: 'tinain' as const, items: ['V100(반사)', 'R100(비반사)', '기타'] },
                ] as const).map((row) => (
                  <tr key={row.brand}>
                    <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600, width: '70px', verticalAlign: 'top' }}>{row.label}</td>
                    <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
                      {row.items.map((item) => (
                        <span key={item} style={{ marginRight: '16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}>
                          <PrintCheck checked={workOrder.tinting[row.brand]?.selected?.includes(item)} /> {item}
                        </span>
                      ))}
                      {workOrder.tinting[row.brand]?.density && (
                        <span style={{ marginLeft: '8px', color: '#E4002B' }}>농도: [{workOrder.tinting[row.brand].density}]</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* PPF & 랩핑 / 코팅 / 기타 */}
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px', borderBottom: '2px solid #E4002B', paddingBottom: '4px' }}>PPF & 랩핑 / 코팅 / 기타</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
              <tbody>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600, width: '70px' }}>PPF</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
                    {['전체PPF', '프론트패키지', '생활보호패키지'].map((p) => <span key={p} style={{ marginRight: '16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.ppf?.includes(p)} /> {p}</span>)}
                    {workOrder.ppf_etc && <span>기타: {workOrder.ppf_etc}</span>}
                  </td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>랩핑</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
                    {['전체랩핑', '부분'].map((p) => <span key={p} style={{ marginRight: '16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.wrapping?.includes(p)} /> {p}</span>)}
                    {workOrder.wrapping_etc && <span>기타: {workOrder.wrapping_etc}</span>}
                  </td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>코팅시공</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
                    {['기본유리막', '9H', '10H', '그래핀PRO', '가죽코팅(시트)', '가죽코팅(전체)', '발수코팅', '필름코팅'].map((p) => <span key={p} style={{ marginRight: '16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.coating?.includes(p)} /> {p}</span>)}
                  </td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>전장시공</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
                    {['블랙박스', '하이패스'].map((p) => <span key={p} style={{ marginRight: '16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.electrical?.includes(p)} /> {p}</span>)}
                    {workOrder.electrical_etc && <span>기타: {workOrder.electrical_etc}</span>}
                  </td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>프리미엄광택</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
                    {['전체광택', '부분광택'].map((p) => <span key={p} style={{ marginRight: '16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.polish?.includes(p)} /> {p}</span>)}
                    {workOrder.polish_etc && <span>기타: {workOrder.polish_etc}</span>}
                  </td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>신차패키지</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
                    {['신차검수', '내외부디테일링세차', '타이어왁스', '피톤치드연막'].map((p) => <span key={p} style={{ marginRight: '16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.package_options?.includes(p)} /> {p}</span>)}
                  </td>
                </tr>
              </tbody>
            </table>
            {/* 특이사항 */}
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px', borderBottom: '2px solid #E4002B', paddingBottom: '4px' }}>특이사항 및 비고</div>
            <div style={{ border: '1px solid #ccc', padding: '12px', minHeight: '60px', whiteSpace: 'pre-wrap', fontSize: '12px' }}>{workOrder.notes || ''}</div>
            {/* 하단 */}
            <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '10px', color: '#888' }}>
              3M 프로이즘 | 서울시 서초구 서초중앙로8길 82, 1동 1층 1호 | 010-7287-7140
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-[var(--c-card)] border-t border-[var(--c-border)] px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-2)] transition-colors">취소</button>
          <button onClick={handlePdfSave} className="bg-info hover:bg-info text-white text-sm font-medium rounded-lg px-5 py-2 transition-colors">PDF 저장</button>
          <button onClick={onSaveOnly} className="bg-[var(--c-subtle)] hover:bg-[var(--c-hover)] text-[var(--c-text-2)] text-sm font-medium rounded-lg px-5 py-2 transition-colors border border-[var(--c-border)]">저장만 하기</button>
          <button onClick={onSubmit} disabled={busy} className="bg-brand hover:bg-brand-dark disabled:opacity-50 disabled:cursor-wait text-white text-sm font-medium rounded-lg px-6 py-2 transition-colors">{busy ? '처리 중…' : '시공 완료 처리'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Warranty Modal Component ───────────────────────────
interface WarrantyModalProps {
  warrantyForm: { date: string; car_type: string; car_number: string; customer_name: string; phone: string; work_details: string; warranty_period: string; price: string };
  setWarrantyForm: (v: WarrantyModalProps['warrantyForm']) => void;
  onSave: () => Promise<void>;
  onDownloaded: () => Promise<void>;
  onClose: () => void;
}

/** 시공 내역 한 줄 "항목 ₩400,000" ↔ {name, amount} (저장 형식은 기존 문자열 그대로 유지) */
type WarrantyItem = { name: string; amount: string };
const AMOUNT_RE = /(₩\s*[\d,]+|[\d,]+\s*원)\s*$/;
function parseWarrantyItems(text: string): WarrantyItem[] {
  const rows = (text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const m = line.match(AMOUNT_RE);
    const amount = m ? m[1].replace(/[^\d]/g, '') : '';
    const name = m ? line.slice(0, m.index).trim() : line;
    return { name, amount };
  });
  return rows.length > 0 ? rows : [{ name: '', amount: '' }];
}
function serializeWarrantyItems(items: WarrantyItem[]): string {
  return items
    .filter((it) => it.name.trim() || it.amount)
    .map((it) => (it.amount ? `${it.name.trim()} ₩${Number(it.amount).toLocaleString()}` : it.name.trim()))
    .join('\n');
}
const fmtWon = (digits: string) => (digits ? Number(digits).toLocaleString() : '');

function WarrantyModal({ warrantyForm, setWarrantyForm, onSave, onDownloaded, onClose }: WarrantyModalProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<WarrantyItem[]>(() => parseWarrantyItems(warrantyForm.work_details));
  const itemsTotal = items.reduce((a, it) => a + (Number(it.amount) || 0), 0);

  /** 항목 변경 → work_details 문자열 갱신. 정상가가 비어 있거나 이전 합계와 같으면 새 합계로 따라간다 */
  const updateItems = (next: WarrantyItem[]) => {
    const prevTotal = items.reduce((a, it) => a + (Number(it.amount) || 0), 0);
    const nextTotal = next.reduce((a, it) => a + (Number(it.amount) || 0), 0);
    const priceDigits = (warrantyForm.price || '').replace(/[^\d]/g, '');
    const followTotal = !priceDigits || Number(priceDigits) === prevTotal;
    setItems(next);
    setWarrantyForm({
      ...warrantyForm,
      work_details: serializeWarrantyItems(next),
      price: followTotal && nextTotal > 0 ? `₩${nextTotal.toLocaleString()}` : warrantyForm.price,
    });
  };
  const setItem = (i: number, patch: Partial<WarrantyItem>) => updateItems(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const addItem = () => updateItems([...items, { name: '', amount: '' }]);
  const removeItem = (i: number) => updateItems(items.length > 1 ? items.filter((_, k) => k !== i) : [{ name: '', amount: '' }]);

  const handleDownloadPng = async () => {
    await onSave();
    if (!printRef.current) return;
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const link = document.createElement('a');
    const dateStr = todaySeoul();
    link.download = `프로이즘_시공보증서_${warrantyForm.customer_name || '고객'}_${dateStr}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    await onDownloaded();
    // 문자 전송 제안
    setTimeout(() => {
      if (confirm('PNG가 다운로드되었습니다. 보증서를 문자로 보내시겠습니까?\n(문자 앱에서 다운로드된 이미지를 직접 첨부해주세요)')) {
        const phone = warrantyForm.phone?.replace(/-/g, '') || '';
        const msg = encodeURIComponent(`안녕하세요, 3M프로이즘입니다 ^^\n시공해드린 차량의 시공내역서 및 보증서를 송부드립니다.\n\n꼼꼼하게 확인해주시고, 궁금하신 사항이나 추가 문의는 언제든 편하게 연락 주세요.\n시공 후에도 저희가 꾸준히 관리해드리겠습니다.\n\n항상 감사합니다!\n3M 프로이즘 ☎ 010-7287-7140`);
        window.open(`sms:${phone}?body=${msg}`, '_self');
      }
    }, 500);
  };

  const inputClass = 'w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-ok/50';

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-2xl max-h-[calc(100dvh-2rem)] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[var(--c-border)]">
          <h3 className="text-[var(--c-text-1)] font-semibold text-base">시공 보증서 발급</h3>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">일자</label>
              <input type="date" value={warrantyForm.date} onChange={(e) => setWarrantyForm({ ...warrantyForm, date: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">차종</label>
              <input type="text" value={warrantyForm.car_type} onChange={(e) => setWarrantyForm({ ...warrantyForm, car_type: e.target.value })} className={inputClass} placeholder="BMW X5 등" />
            </div>
            <div>
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">차량번호</label>
              <input type="text" value={warrantyForm.car_number} onChange={(e) => setWarrantyForm({ ...warrantyForm, car_number: e.target.value })} className={inputClass} placeholder="12가 3456" />
            </div>
            <div>
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">성명</label>
              <input type="text" value={warrantyForm.customer_name} onChange={(e) => setWarrantyForm({ ...warrantyForm, customer_name: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">연락처</label>
              <input type="text" value={warrantyForm.phone} onChange={(e) => setWarrantyForm({ ...warrantyForm, phone: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">보증기간</label>
              <input type="text" value={warrantyForm.warranty_period} onChange={(e) => setWarrantyForm({ ...warrantyForm, warranty_period: e.target.value })} className={inputClass} placeholder="시공일로부터 1년" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">정상가 금액</label>
              <input type="text" value={warrantyForm.price} onChange={(e) => setWarrantyForm({ ...warrantyForm, price: e.target.value })} className={inputClass} placeholder="₩1,000,000" />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-[var(--c-text-3)] block">시공 내역 — 항목마다 금액을 따로 적습니다</label>
              {itemsTotal > 0 && <span className="text-[11px] text-[var(--c-text-2)]">합계 ₩{itemsTotal.toLocaleString()}</span>}
            </div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={it.name}
                    onChange={(e) => setItem(i, { name: e.target.value })}
                    className={`${inputClass} flex-1`}
                    placeholder={i === 0 ? '예: 그릴 랩핑 (3M 2080 글로스 블랙)' : '시공 항목'}
                  />
                  <div className="relative w-40 shrink-0">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--c-text-3)]">₩</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fmtWon(it.amount)}
                      onChange={(e) => setItem(i, { amount: e.target.value.replace(/[^\d]/g, '') })}
                      className={`${inputClass} pl-7 text-right`}
                      placeholder="400,000"
                    />
                  </div>
                  <button type="button" onClick={() => removeItem(i)} className="shrink-0 w-8 h-8 rounded-lg text-[var(--c-text-3)] hover:text-danger hover:bg-danger/10 text-sm" title="항목 삭제">✕</button>
                </div>
              ))}
              <button type="button" onClick={addItem} className="text-xs text-ok hover:bg-ok/10 px-3 py-1.5 rounded-lg">＋ 항목 추가</button>
            </div>
            <p className="text-[10px] text-[var(--c-text-3)] mt-1">정상가는 항목 합계로 자동 채워지고, 직접 고치면 그 값이 유지됩니다.</p>
          </div>
          <div className="mt-3 px-1 py-2 border border-ok/20 bg-ok/5 rounded-lg text-center text-xs text-ok">
            📎 보증 카드 + 시공 후 안내사항이 함께 첨부됩니다
          </div>
        </div>

        {/* Hidden print area */}
        <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
          <div ref={printRef} style={{ width: '800px', backgroundColor: '#ffffff', fontFamily: 'sans-serif', color: '#111' }}>
            {/* Header Bar */}
            <div style={{ backgroundColor: '#E4002B', padding: '20px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#ffffff', letterSpacing: '2px', lineHeight: 1 }}>3M<br/><span style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '1px' }}>PROIZM</span></div>
                <div style={{ width: '1px', height: '36px', backgroundColor: 'rgba(255,255,255,0.3)' }} />
                <div style={{ fontSize: '26px', fontWeight: 700, color: '#ffffff', letterSpacing: '6px' }}>시공내역서</div>
              </div>
              <div style={{ color: '#ffffff', fontSize: '11px', textAlign: 'right', lineHeight: '1.6' }}>
                <div>3M Car Wrap Film Preferred Installer</div>
                <div>3M 프로이즘</div>
              </div>
            </div>

            <div style={{ padding: '32px 40px 40px' }}>
              {/* Customer Info Table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
                <tbody>
                  <tr>
                    <td style={{ border: '1px solid #E4002B', padding: '8px 12px', backgroundColor: '#E4002B', color: '#fff', fontWeight: 600, width: '110px', fontSize: '13px' }}>일자</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px 12px', fontSize: '13px' }}>{warrantyForm.date}</td>
                    <td style={{ border: '1px solid #E4002B', padding: '8px 12px', backgroundColor: '#E4002B', color: '#fff', fontWeight: 600, width: '110px', fontSize: '13px' }}>차종</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px 12px', fontSize: '13px' }}>{warrantyForm.car_type}</td>
                  </tr>
                  <tr>
                    <td style={{ border: '1px solid #E4002B', padding: '8px 12px', backgroundColor: '#E4002B', color: '#fff', fontWeight: 600, fontSize: '13px' }}>차량번호</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px 12px', fontSize: '13px' }}>{warrantyForm.car_number}</td>
                    <td style={{ border: '1px solid #E4002B', padding: '8px 12px', backgroundColor: '#E4002B', color: '#fff', fontWeight: 600, fontSize: '13px' }}>성명</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px 12px', fontSize: '13px' }}>{warrantyForm.customer_name}</td>
                  </tr>
                  <tr>
                    <td style={{ border: '1px solid #E4002B', padding: '8px 12px', backgroundColor: '#E4002B', color: '#fff', fontWeight: 600, fontSize: '13px' }}>연락처</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px 12px', fontSize: '13px' }}>{warrantyForm.phone}</td>
                    <td style={{ border: '1px solid #E4002B', padding: '8px 12px', backgroundColor: '#E4002B', color: '#fff', fontWeight: 600, fontSize: '13px' }}>보증기간</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px 12px', fontSize: '13px' }}>{warrantyForm.warranty_period}</td>
                  </tr>
                </tbody>
              </table>

              {/* Work Details Table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
                <thead>
                  <tr>
                    <th style={{ border: '1px solid #E4002B', padding: '8px 12px', backgroundColor: '#E4002B', color: '#fff', textAlign: 'left', fontSize: '13px' }}>시공 내역</th>
                    <th style={{ border: '1px solid #E4002B', padding: '8px 12px', backgroundColor: '#E4002B', color: '#fff', textAlign: 'right', fontSize: '13px', width: '160px' }}>금액</th>
                  </tr>
                </thead>
                <tbody>
                  {parseWarrantyItems(warrantyForm.work_details).filter((it) => it.name || it.amount).map((it, i) => {
                    const detail = it.name;
                    const amount = it.amount ? `₩${Number(it.amount).toLocaleString()}` : '';
                    return (
                      <tr key={i}>
                        <td style={{ border: '1px solid #ddd', padding: '8px 12px', fontSize: '13px' }}>{detail}</td>
                        <td style={{ border: '1px solid #ddd', padding: '8px 12px', fontSize: '13px', textAlign: 'right' }}>{amount}</td>
                      </tr>
                    );
                  })}
                  {warrantyForm.price && (
                    <tr>
                      <td style={{ border: '1px solid #ddd', padding: '8px 12px', fontSize: '13px', fontWeight: 700, textAlign: 'right', backgroundColor: '#FEF2F2' }}>정상가</td>
                      <td style={{ border: '1px solid #ddd', padding: '8px 12px', fontSize: '13px', fontWeight: 700, textAlign: 'right', backgroundColor: '#FEF2F2' }}>{warrantyForm.price}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* 건적서 참고 */}
              <div style={{ backgroundColor: '#f9f9f9', border: '1px solid #ddd', borderRadius: '6px', padding: '16px', marginBottom: '20px', fontSize: '11.5px', lineHeight: '1.8', color: '#444' }}>
                <div style={{ fontWeight: 700, marginBottom: '6px', color: '#E4002B' }}>[견적서 발행 참고 내용]</div>
                <div>- 시공내역서와 동일, 작업보증서는 전자보증서로 발급됩니다.</div>
                <div>- 제품의 보증은 각 브랜드 및 제품회사의 보증 규격을 준수합니다.</div>
                <div>- 정가 기준으로 시공내역서가 작성되었습니다.</div>
              </div>

              {/* 기본멘트 */}
              <div style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '6px', padding: '16px', marginBottom: '24px', fontSize: '12px', lineHeight: '1.9', color: '#991B1B' }}>
                <div style={{ fontWeight: 700, marginBottom: '6px', color: '#E4002B' }}>[기본멘트]</div>
                <div>세계적 브랜드 신뢰와 프로 정신의 융합, 3M 프로이즘</div>
                <div>작업이 완료된 차량의 &apos;시공내역서&apos; 및 &apos;보증서&apos;를 송부드립니다.</div>
                <div>시공 후 문의 및 A/S 관련 사항은 3M 프로이즘 대표번호(☎ 010-7287-7140)로 연락을 주시면 담당자의 친절한 응대를 약속드리겠습니다.</div>
                <div>행복 가득한 하루를 보내시기 바라며, 다시 한번 저희를 믿고 맡겨주시어 정말 감사드립니다.</div>
              </div>

              {/* 보증/안내 이미지 */}
              <div style={{ borderTop: '2px solid #E4002B', marginTop: '24px', paddingTop: '16px' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/warranty-card.jpeg" alt="보증 카드" style={{ width: '100%', marginBottom: '16px' }} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/aftercare-notice.jpeg" alt="시공 후 주의사항" style={{ width: '100%', marginBottom: '16px' }} />
              </div>
            </div>

            {/* Footer Bar */}
            <div style={{ backgroundColor: '#E4002B', padding: '14px 40px', textAlign: 'center', fontSize: '12px', color: '#ffffff', fontWeight: 500 }}>
              3M 프로이즘 | 서초중앙로8길 82, 1동 1층 | 010-7287-7140
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-[var(--c-card)] border-t border-[var(--c-border)] px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-2)] transition-colors">취소</button>
          <button onClick={async () => { await onSave(); onClose(); }} className="bg-[var(--c-subtle)] hover:bg-[var(--c-hover)] text-[var(--c-text-2)] text-sm font-medium rounded-lg px-5 py-2 transition-colors border border-[var(--c-border)]">저장만 하기</button>
          <button onClick={handleDownloadPng} className="bg-ok hover:bg-ok text-white text-sm font-medium rounded-lg px-5 py-2 transition-colors">PNG 다운로드</button>
        </div>
      </div>
    </div>
  );
}
