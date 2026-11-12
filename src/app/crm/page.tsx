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
import BlogWorkspace from '@/components/BlogWorkspace';
import HelpModal from '@/components/HelpModal';
import PushToggle from '@/components/PushToggle';

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
  service_count: number;
}

interface Appointment {
  id: string;
  customer_id: string;
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

const SERVICE_TYPES = ['PPF', '컬러PPF', 'PWF', '랩핑', '크롬죽이기', '썬팅', '유리막코팅', '가죽코팅', '실내PPF', '신차패키지'];
const APPOINTMENT_STATUSES = ['상담중', '예약확정', '시공중', '완료'];
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
  completionDate: string
) {
  const base = new Date(completionDate + 'T00:00:00+09:00');
  const followUps: { service_id: string; customer_id: string; follow_up_type: string; scheduled_date: string; memo: string }[] = [];

  const needsQC = ['PPF', '컬러PPF', 'PWF'].includes(serviceType);

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
    await supabase.from('follow_ups').insert(followUps);
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
  // 블로그 AI 탭 (2026-11-12): 한 번 열면 다른 탭을 봐도 대화·초안을 유지하기 위해 숨기기만 한다
  const [blogVisited, setBlogVisited] = useState(false);
  const [prefillNonce, setPrefillNonce] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => { if (activeTab === 'blog') setBlogVisited(true); }, [activeTab]);
  // 주소 ?tab=blog 로 바로 열기
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab');
      if (t && (TAB_KEYS as string[]).includes(t)) setActiveTab(t as Tab);
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
  const [customerForm, setCustomerForm] = useState({
    name: '', phone: '', car_brand: '', car_model: '', car_year: '', car_color: '', source: '', memo: '',
    appointment_start_date: '', appointment_end_date: '', appointment_service_type: '', appointment_amount: '', appointment_memo: '',
  });

  // Appointment state
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [showAddAppointment, setShowAddAppointment] = useState(false);
  const [appointmentForm, setAppointmentForm] = useState({
    customer_id: '', appointment_date: '', end_date: '', service_type: '', amount: '', memo: '',
  });
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
    const { data } = await supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) {
      // 각 고객의 최근 시공 정보 가져오기
      const customersWithService = await Promise.all(
        data.map(async (c) => {
          const { data: services } = await supabase
            .from('services')
            .select('service_type, service_date')
            .eq('customer_id', c.id)
            .order('service_date', { ascending: false });

          return {
            ...c,
            latest_service: services?.[0]?.service_type ?? null,
            latest_service_date: services?.[0]?.service_date ?? null,
            service_count: services?.length ?? 0,
          };
        })
      );
      setCustomers(customersWithService);
    }
  }, []);

  const fetchAllCustomers = useCallback(async () => {
    const { data } = await supabase.from('customers').select('id, name, phone, car_brand, car_model, car_color').order('name');
    if (data) setAllCustomers(data);
  }, []);

  const fetchAppointments = useCallback(async () => {
    const { data } = await supabase
      .from('appointments')
      .select('*, customer:customers(name, phone)')
      .order('appointment_date', { ascending: true });
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
    if (data) setFollowUps(data as FollowUp[]);
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
    if (activeTab === 'home') { fetchAppointments(); fetchFollowUps(); fetchTeamBrief(); }
    else if (activeTab === 'customers') fetchCustomers();
    else if (activeTab === 'appointments') fetchAppointments();
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

    // 1. 고객 등록
    const { data: insertData, error: insertError } = await supabase
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

    let customerId = insertData?.id;

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
      });
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
    if (data && data.length > 0) fetchFollowUps();
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
      (c.car_model?.toLowerCase().includes(q))
    );
  });

  const handleDeleteCustomer = async (id: string, name: string) => {
    if (!confirm(`"${name}" 고객을 정말 삭제하시겠습니까?\n관련 예약, 시공, 상담, 사후관리도 모두 삭제됩니다.`)) return;
    await supabase.from('customers').delete().eq('id', id);
    fetchCustomers();
    fetchAllCustomers();
  };

  const handleEditCustomer = async (customer: Customer) => {
    // 최근 예약의 금액 불러오기
    const { data: latestAppt } = await supabase
      .from('appointments')
      .select('amount')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    setCustomerForm({
      name: customer.name || '',
      phone: customer.phone || '',
      car_brand: customer.car_brand || '',
      car_model: customer.car_model || '',
      car_year: customer.car_year || '',
      car_color: customer.car_color || '',
      source: customer.source || '',
      memo: customer.memo || '',
      appointment_start_date: '',
      appointment_end_date: '',
      appointment_service_type: '',
      appointment_amount: latestAppt?.amount ? String(latestAppt.amount) : '',
      appointment_memo: '',
    });
    setEditCustomerId(customer.id);
    setShowAddCustomer(true);
  };

  const handleUpdateCustomer = async () => {
    if (!editCustomerId || !customerForm.name.trim()) return;
    const { error } = await supabase
      .from('customers')
      .update({
        name: customerForm.name,
        phone: customerForm.phone || null,
        car_brand: customerForm.car_brand || null,
        car_model: customerForm.car_model || null,
        car_year: customerForm.car_year || null,
        car_color: customerForm.car_color || null,
        source: customerForm.source || null,
        memo: customerForm.memo || null,
      })
      .eq('id', editCustomerId);
    if (error) {
      alert('수정 실패: ' + error.message);
      return;
    }

    // 금액이 입력되었으면 최근 예약의 금액도 업데이트
    if (customerForm.appointment_amount) {
      const { data: latestAppt } = await supabase
        .from('appointments')
        .select('id')
        .eq('customer_id', editCustomerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (latestAppt) {
        await supabase.from('appointments').update({ amount: Number(customerForm.appointment_amount) }).eq('id', latestAppt.id);
      }
    }

    setCustomerForm({ name: '', phone: '', car_brand: '', car_model: '', car_year: '', car_color: '', source: '', memo: '', appointment_start_date: '', appointment_end_date: '', appointment_service_type: '', appointment_amount: '', appointment_memo: '' });
    setEditCustomerId(null);
    setShowAddCustomer(false);
    fetchCustomers();
    fetchAllCustomers();
    fetchAppointments();
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
    });

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

    setAppointmentForm({ customer_id: '', appointment_date: '', end_date: '', service_type: '', amount: '', memo: '' });
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
    // 완료 변경 시 작업 내역서 모달 표시 (기존 데이터 불러오기)
    if (newStatus === '완료') {
      handleOpenWorkOrder(appointment);
      return;
    }

    await supabase.from('appointments').update({ status: newStatus }).eq('id', appointment.id);
    fetchAppointments();
  };

  const handleWorkOrderSubmit = async () => {
    if (!workOrderAppointment) return;
    const appointment = workOrderAppointment;
    const completionDate = todaySeoul();

    // 기존 memo에서 warranty 관련 데이터 보존
    let existingExtra: Record<string, unknown> = {};
    if (appointment.memo) {
      try {
        const parsed = JSON.parse(appointment.memo);
        if (parsed?.warranty) existingExtra.warranty = parsed.warranty;
        if (parsed?.warranty_issued) existingExtra.warranty_issued = parsed.warranty_issued;
      } catch { /* ignore */ }
    }
    const mergedMemo = JSON.stringify({ ...workOrder, ...existingExtra });

    // 시공 이력 생성 (작업 내역서 데이터를 memo에 JSON으로 저장)
    const finalAmount = workOrder.amount ? Number(workOrder.amount) : (appointment.amount || null);
    const { data: service } = await supabase
      .from('services')
      .insert({
        customer_id: appointment.customer_id,
        service_type: appointment.service_type || '기타',
        service_date: appointment.appointment_date,
        completion_date: completionDate,
        amount: finalAmount,
        memo: mergedMemo,
      })
      .select()
      .single();

    // 사후관리 자동 생성
    if (service && appointment.service_type) {
      await createAutoFollowUps(service.id, appointment.customer_id, appointment.service_type, completionDate);
    }

    // 예약 상태 완료로 변경 + memo 보존
    await supabase.from('appointments').update({ status: '완료', memo: mergedMemo }).eq('id', appointment.id);

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
    // 예약 금액을 작업내역서 기본값으로 설정
    if (appointment.amount) {
      setWorkOrder((prev) => ({ ...prev, amount: String(appointment.amount) }));
    }
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
  const handleToggleFollowUp = async (followUp: FollowUp) => {
    const newCompleted = !followUp.is_completed;
    await supabase
      .from('follow_ups')
      .update({
        is_completed: newCompleted,
        completed_date: newCompleted ? todaySeoul() : null,
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
    return c.name.toLowerCase().includes(q) || (c.phone?.includes(q));
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
                placeholder="이름 또는 연락처 검색..."
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
  const tabs: { key: Tab; label: string }[] = [
    { key: 'home', label: '홈' },
    { key: 'blog', label: '✍️ 블로그' },
    { key: 'customers', label: '고객 목록' },
    { key: 'appointments', label: '예약/일정' },
    { key: 'followups', label: '사후관리' },
    { key: 'consultations', label: '상담 기록' },
  ];

  return (
    <div className="h-dvh flex flex-col bg-[var(--c-page)]">
      {/* Header (2026-11-11 하남점 페이지 톤: 3M 레드 사각 로고 + 알약형 탭, 가운데 컨테이너) */}
      <header className="bg-[var(--c-card)] border-b border-[var(--c-border)] shrink-0 pt-[env(safe-area-inset-top)]">
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
            { icon: '✍️', label: '시공기 쓰기', desc: '블로그 탭에서 작성', onClick: () => setActiveTab('blog') },
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
                    <div className="py-10 text-center text-sm text-[var(--c-text-3)]">마케팅팀이 준비한 일을 읽는 중…</div>
                  ) : (
                    <ul className="divide-y divide-[var(--c-border)]">
                      {teamBrief.lines.map((l) => {
                        const open = teamOpen === l.key && (l.items?.length ?? 0) > 0;
                        const unsent = (l.items || []).filter((i) => !i.sent).length;
                        return (
                          <li key={l.key} className="py-3">
                            <button
                              onClick={() => setTeamOpen(open ? null : l.key)}
                              disabled={!(l.items && l.items.length > 0)}
                              className="w-full flex items-center gap-3 text-left disabled:cursor-default"
                            >
                              <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(l.status)}`} />
                              <span className="text-xs text-[var(--c-text-4)] tabular-nums w-14 shrink-0">{l.time}</span>
                              <span className={`font-semibold text-[15px] shrink-0 ${l.status === 'prepared' ? 'text-[var(--c-text-3)]' : 'text-[var(--c-text-1)]'}`}>{l.name}</span>
                              <span className={`text-sm truncate ${l.status === 'prepared' ? 'text-[var(--c-text-4)]' : 'text-[var(--c-text-2)]'}`}>{l.status === 'prepared' ? `대기 · ${l.waitingFor || ''}` : l.summary}</span>
                              {l.items && l.items.length > 0 && (
                                <span className={`ml-auto shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${unsent > 0 ? 'bg-brand text-white' : 'bg-ok/10 text-ok'}`}>{unsent > 0 ? `${unsent}건 ${open ? '접기' : '보기'}` : '✓ 완료'}</span>
                              )}
                              {l.key === 'writer' && l.status !== 'idle' && (
                                <span onClick={(e) => { e.stopPropagation(); setActiveTab('blog'); }} className="ml-auto shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border border-[var(--c-border)] text-[var(--c-text-1)] hover:bg-[var(--c-subtle)]">열기</span>
                              )}
                            </button>
                            {open && (
                              <ul className="mt-2 ml-5 md:ml-[4.5rem] divide-y divide-[var(--c-border)] border-t border-[var(--c-border)]">
                                {l.items!.map((it) => (
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
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--c-text-2)]">
                        {c.latest_service
                          ? `${c.latest_service} (${formatDate(c.latest_service_date)})`
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
          const todayCount = appointments.filter((a) => a.appointment_date === today && a.status !== '완료').length;
          const weekEnd = new Date();
          weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()));
          const weekEndStr = toSeoulISO(weekEnd);
          const weekCount = appointments.filter((a) => a.appointment_date >= today && a.appointment_date <= weekEndStr && a.status !== '완료').length;

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
                      const dim = a.status === '완료' ? 'opacity-60' : isPast ? 'opacity-70' : '';
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
                                {a.amount ? <span className="ml-2 text-[var(--c-text-1)] font-medium">{a.amount.toLocaleString()}원</span> : null}
                                {memoDisplay && <span className="ml-2">· {memoDisplay}</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
                            <span className={`text-xs font-semibold px-2.5 py-1.5 rounded-full ${chip(a.status)}`}>{a.status}</span>
                            {a.service_type && CRM_SERVICE_TO_KEY[a.service_type] && (
                              <button onClick={() => handleWriteBlogFromAppointment(a)} className={pill} title="이 시공으로 블로그 시공기 폼 채우기">✍️ 시공기</button>
                            )}
                            <button onClick={() => handleOpenWorkOrder(a)} className={pill}>작업 내역서</button>
                            <button onClick={() => handleOpenWarranty(a)} className={hasWarrantyIssued(a.memo) ? 'text-xs font-semibold rounded-full px-3 py-1.5 bg-ok text-white whitespace-nowrap' : pill}>{hasWarrantyIssued(a.memo) ? '✓ 보증서 발급' : '보증서'}</button>
                            {a.customer?.phone && (
                              <div className="flex items-center rounded-full border border-[var(--c-border)] bg-[var(--c-card)] overflow-hidden" title="후기 요청 문자 보내기">
                                <span className="text-[11px] font-semibold text-[var(--c-text-3)] pl-3 pr-2 py-1.5">후기</span>
                                {(['proism', 'audi', 'bmw'] as const).map((k) => (
                                  <button key={k} onClick={(e) => { e.stopPropagation(); handleReviewSmsFromAppointment(a, k); }} className="text-xs font-semibold px-2.5 py-1.5 text-[var(--c-text-1)] hover:bg-[var(--c-subtle)] transition-colors border-l border-[var(--c-border)]">
                                    {k === 'proism' ? '프로이즘' : k === 'audi' ? '아우디' : 'BMW'}
                                  </button>
                                ))}
                              </div>
                            )}
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
                  : f.follow_up_type === '후기요청'
                    ? 'bg-warn/20 text-warn'
                    : isQuote
                      ? 'bg-gold/20 text-gold'
                      : 'bg-violet/20 text-violet';

                const statusBadge = f.is_completed
                  ? { text: '처리완료', class: 'bg-ok/20 text-ok' }
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
                        {f.memo && !isQuote && <div className="text-xs text-[var(--c-text-4)] mt-1">{f.memo}</div>}
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
              base.forEach((f) => { if (!f.is_completed) countByDate[f.scheduled_date] = (countByDate[f.scheduled_date] || 0) + 1; });
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
                            <div className="text-sm font-semibold text-[var(--c-text-1)]">{dateLabel(followDate)}{followDate === today ? ' (오늘)' : ''} <span className="text-gold">{dayList.length}</span>건</div>
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
      {blogVisited && (
        <div className={activeTab === 'blog' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
          <BlogWorkspace embedded prefillNonce={prefillNonce} />
        </div>
      )}
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* ─── Modal: 고객 추가 ────────────────────────────────── */}
      {showAddCustomer && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={() => { setShowAddCustomer(false); setEditCustomerId(null); }}>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--c-text-1)] font-semibold text-base mb-4">{editCustomerId ? '고객 수정' : '고객 추가'}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">이름 *</label>
                <input type="text" value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="고객 이름" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">연락처</label>
                <input type="text" value={customerForm.phone} onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="010-0000-0000" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">유입경로</label>
                <select value={customerForm.source} onChange={(e) => setCustomerForm({ ...customerForm, source: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50">
                  <option value="">선택...</option>
                  {['카페', '블로그', '소개/재방문', '유튜브', '고정', '경로X', '기타'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">차량 브랜드</label>
                <input type="text" value={customerForm.car_brand} onChange={(e) => setCustomerForm({ ...customerForm, car_brand: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="BMW, 벤츠, 포르쉐 등" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">차량 모델</label>
                <input type="text" value={customerForm.car_model} onChange={(e) => setCustomerForm({ ...customerForm, car_model: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="X5, GLE, 카이엔 등" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">연식</label>
                <input type="text" value={customerForm.car_year} onChange={(e) => setCustomerForm({ ...customerForm, car_year: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="2024" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">색상</label>
                <input type="text" value={customerForm.car_color} onChange={(e) => setCustomerForm({ ...customerForm, car_color: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="블랙, 화이트 등" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">메모</label>
                <textarea value={customerForm.memo} onChange={(e) => setCustomerForm({ ...customerForm, memo: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50 resize-none h-20" placeholder="특이사항" />
              </div>
              {editCustomerId && (
              <div className="col-span-2 border-t border-[var(--c-border)] pt-3 mt-1">
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">예상 금액</label>
                <input type="text" inputMode="numeric" value={customerForm.appointment_amount ? Number(customerForm.appointment_amount).toLocaleString() : ''} onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ''); setCustomerForm({ ...customerForm, appointment_amount: raw }); }} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="2,500,000" />
              </div>
              )}
              {!editCustomerId && (<>
              <div className="col-span-2 border-t border-[var(--c-border)] pt-3 mt-1">
                <div className="text-xs text-gold font-medium mb-2">예약 정보 (선택)</div>
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">시공 시작일</label>
                <input type="date" value={customerForm.appointment_start_date} onChange={(e) => setCustomerForm({ ...customerForm, appointment_start_date: e.target.value })} onInput={(e) => setCustomerForm({ ...customerForm, appointment_start_date: (e.target as HTMLInputElement).value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">시공 종료일</label>
                <input type="date" value={customerForm.appointment_end_date} onChange={(e) => setCustomerForm({ ...customerForm, appointment_end_date: e.target.value })} onInput={(e) => setCustomerForm({ ...customerForm, appointment_end_date: (e.target as HTMLInputElement).value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">시공 종류</label>
                <select value={customerForm.appointment_service_type} onChange={(e) => setCustomerForm({ ...customerForm, appointment_service_type: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50">
                  <option value="">선택...</option>
                  {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">예상 금액</label>
                <input type="text" inputMode="numeric" value={customerForm.appointment_amount ? Number(customerForm.appointment_amount).toLocaleString() : ''} onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ''); setCustomerForm({ ...customerForm, appointment_amount: raw }); }} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="2,500,000" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">예약 메모</label>
                <textarea value={customerForm.appointment_memo} onChange={(e) => setCustomerForm({ ...customerForm, appointment_memo: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50 resize-none h-16" placeholder="예약 관련 메모" />
              </div>
              </>)}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setShowAddCustomer(false); setEditCustomerId(null); }} className="px-4 py-2 text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-2)] transition-colors">취소</button>
              <button onClick={editCustomerId ? handleUpdateCustomer : handleAddCustomer} className="bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">{editCustomerId ? '수정' : '추가'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: 예약 추가 ────────────────────────────────── */}
      {showAddAppointment && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={() => setShowAddAppointment(false)}>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--c-text-1)] font-semibold text-base mb-4">예약 추가</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">고객 *</label>
                <CustomerPicker value={appointmentForm.customer_id} onChange={(id) => setAppointmentForm({ ...appointmentForm, customer_id: id })} />
              </div>
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
      {showWorkOrder && workOrderAppointment && (
        <WorkOrderModal
          appointment={workOrderAppointment}
          workOrder={workOrder}
          setWorkOrder={setWorkOrder}
          onSubmit={handleWorkOrderSubmit}
          onSaveOnly={handleWorkOrderSaveOnly}
          onClose={() => { setShowWorkOrder(false); setWorkOrderAppointment(null); }}
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

function WorkOrderModal({ appointment, workOrder, setWorkOrder, onSubmit, onSaveOnly, onClose }: WorkOrderModalProps & { workOrder: any }) {
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
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">유입경로</label>
              <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-2)]">-</div>
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
          <button onClick={onSubmit} className="bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg px-6 py-2 transition-colors">시공 완료 처리</button>
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
