'use client';

import { useState, useEffect, useRef } from 'react';
import { Icon } from '@/components/ui/icons';
import { todaySeoul, toSeoulISO } from '@/lib/local-date';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { BLOG_PREFILL_KEY, CRM_SERVICE_TO_KEY, type BlogPrefill } from '@/config/blog-options';
import { useTheme } from '@/components/ThemeProvider';
import QuoteSmsModal, { type QuoteSmsInitial } from '@/components/crm/QuoteSmsModal';
import InquiryReplyModal from '@/components/crm/InquiryReplyModal';
import CallSummaryImportModal from '@/components/crm/CallSummaryImportModal';
import { QC_SMS, MAINT_SMS, REVIEW_SMS, dealerDoneSms, followUpSmsKey } from '@/config/sms-templates';
import { dealerPageUrl } from '@/lib/dealer-page';
import { customerStoryLines } from '@/lib/customer-story';
import { dealerSupport, dealerFor, DEALER_KIND } from '@/lib/dealers';
import { checkMemberReady, memberBlockMessage } from '@/lib/member-ready';
import type { TeamItem } from '@/lib/team';
import type { ImportCandidate } from '@/lib/appointment-import';
import BlogWorkspace from '@/components/BlogWorkspace';
import HelpModal from '@/components/HelpModal';
import PushToggle from '@/components/PushToggle';
import NotificationsModal from '@/components/NotificationsModal';
import BadgeClearer from '@/components/BadgeClearer';
import Link from 'next/link';
import CustomerFormModal, { type CustomerFormValues, EMPTY_CUSTOMER_FORM, loadCustomerForm, saveCustomerEdit } from '@/components/crm/CustomerFormModal';
import { linkReferral, loadReferralsFor, markThanksSent, grantPointForReferred, loadPoints, usePoints, updateReferral } from '@/lib/referrals';
import { MEMBERSHIP, POINTS } from '@/config/membership';
import { getOrCreateMemberLink, memberLinkSms, logMemberSms } from '@/lib/member-links';
import { workDetailsText, workItems, ppfProduct, ppfProductOf, type WorkOrderJson } from '@/lib/work-order';
import CareCompleteModal from '@/components/crm/CareCompleteModal';
import { appendCareLog, stripCareLog } from '@/lib/care-log';
import { isDemoClient } from '@/lib/demo';
import { scheduleNextMaintenance, markFollowUpSkipped, closeQuoteFollowUpsFor } from '@/lib/followups';
import { loadVehicles, ensurePrimaryVehicle, fillPlateIfEmpty, vehicleLabel, addVehicle, type Vehicle } from '@/lib/vehicles';
import { linkOrphanRecordsByPhone, ensureArrivalNotice, resyncArrivalNotice } from '@/lib/appointments-flow';
import { formatPhoneInput } from '@/lib/phone';
import ReferrerPicker, { referrerToken } from '@/components/crm/ReferrerPicker';
import { BlacklistWarning } from '@/components/crm/BlacklistModal';
import { isBlacklisted, blacklistInfo } from '@/lib/blacklist';
import { careGuidesFor } from '@/config/care-guide';

import { isMobileDevice, copyText } from '@/lib/device';
import { type Customer, type Appointment, type FollowUp, type Tab, TAB_KEYS, SERVICE_TYPES, CARE_VISIT_TYPES, RETOUCH_TYPE, FOLLOW_UP_TYPES, openSmsApp, confirmAfterSms, TEMPLATE_KEYS, createAutoFollowUps, normalizePhone } from '@/lib/crm-shared';
import WorkOrderModal from '@/components/crm/WorkOrderModal';
import WarrantyModal from '@/components/crm/WarrantyModal';
import HomeTab from '@/components/crm/tabs/HomeTab';
import ConsultationsTab from '@/components/crm/tabs/ConsultationsTab';
import FollowUpsTab from '@/components/crm/tabs/FollowUpsTab';
import CustomersTab from '@/components/crm/tabs/CustomersTab';
import AppointmentsTab from '@/components/crm/tabs/AppointmentsTab';
import { useCrmData } from '@/hooks/useCrmData';

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
  const [notifOpen, setNotifOpen] = useState(false); // 받은 알림 창 (2026-11-26)
  const [refreshState, setRefreshState] = useState<'idle' | 'busy' | 'done'>('idle'); // 헤더 새로고침 (2026-11-26 사장님 "각 탭마다 새로고침 버튼")
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

  // 탭 전환을 브라우저 기록에 남긴다 (2026-11-26 사장님 "뒤로가기 누르면 CRM 홈으로 가서 불편, 이전 화면으로"):
  // 탭을 바꾸면 /crm?tab=… 을 pushState, 뒤로가기(popstate)면 주소의 tab 으로 돌아간다. 고객 상세(/crm/<id>)에서 뒤로 오면 그 탭이 그대로
  const tabFromPop = useRef(false);
  const tabMounted = useRef(false);
  useEffect(() => {
    const onPop = () => {
      const t = new URLSearchParams(window.location.search).get('tab');
      tabFromPop.current = true;
      setActiveTab(t && (TAB_KEYS as string[]).includes(t) ? (t as Tab) : 'home');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (!tabMounted.current) { tabMounted.current = true; return; } // 처음 그릴 때는 주소를 건드리지 않음 (?tab= 읽는 효과가 뒤이어 돈다)
    if (tabFromPop.current) { tabFromPop.current = false; return; }
    const cur = new URLSearchParams(window.location.search).get('tab') || 'home';
    if (cur === activeTab) return;
    window.history.pushState({ tab: activeTab }, '', activeTab === 'home' ? '/crm' : `/crm?tab=${activeTab}`);
  }, [activeTab]);

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
  const [customerSearch, setCustomerSearch] = useState('');
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [editCustomerId, setEditCustomerId] = useState<string | null>(null);
  // 고객 수정 창에 최근 예약(시공·시작·종료·금액)을 같이 보여 주고 고친다 (2026-11-18 사장님: 등록 창과 수정 창이 달라 헷갈림)
  const [editLatestApptId, setEditLatestApptId] = useState<string | null>(null);
  // 멤버십(2026-11-18): 고객 창에서 고른 "소개한 분". 저장 때 referrals 에 연결
  const [customerReferrerId, setCustomerReferrerId] = useState<string | null>(null);
  const [customerForm, setCustomerForm] = useState<CustomerFormValues>({ ...EMPTY_CUSTOMER_FORM });

  // Appointment state
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
  const [calendarView, setCalendarView] = useState<'calendar' | 'list'>('calendar');
  const [managerFilter] = useState<'전체' | '대표' | '이팀장님' | '김막내'>('전체');
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Follow-up state
  const [followUpFilter, setFollowUpFilter] = useState<'all' | 'QC점검' | '메인터넌스' | '후기요청' | '견적재연락' | '견적마무리'>('all');
  // 견적 문자 생성 창 (2026-11-11): 전화 상담 뒤 보내는 문자 + 재연락 2회 자동 등록
  const [quoteSms, setQuoteSms] = useState<QuoteSmsInitial | null>(null);
  // 문의 답변 창 (2026-11-12): 카페·문자 문의 글 → 시장 평균가 기준 답장
  const [showInquiry, setShowInquiry] = useState(false);
  const [showCallImport, setShowCallImport] = useState(false); // 통화 요약 캡처 → 상담 기록 (2026-11-25)
  // 사후관리 달력·검색 (2026-11-11): 기본은 오늘 보낼 사람만, 검색하면 날짜 무관, 밀린 건은 접어 둠
  const [followSearch, setFollowSearch] = useState('');
  const [followDate, setFollowDate] = useState<string>(() => todaySeoul());
  const [followMonth, setFollowMonth] = useState<{ y: number; m: number }>(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [showOverdue, setShowOverdue] = useState(false);
  // Consultation state
  const [showAddConsultation, setShowAddConsultation] = useState(false);
  // 상담은 아직 고객이 아닌 분이 대부분 → 고객 선택 없이 이름·전화만 적어도 저장 (2026-11-11 사장님 지적)
  const [consultationForm, setConsultationForm] = useState({
    customer_id: '', consultation_date: '', content: '', estimate: '', interested_services: '', memo: '', name: '', phone: '', car: '', photos: [] as string[],
    referrer: null as { id: string; name: string; phone: string | null; car_brand: string | null; car_model: string | null } | null, // 소개한 분 (2026-11-22 점검 9-2)
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
    maintenance_years: '', // 메인터넌스 기간(년) 2·3·4·5·7·10 — 보증서 기간이자 메인터넌스 반복 한계 (2026-11-22 사장님)
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
    color_ppf: [] as string[],
    color_ppf_etc: '',
    coating: [] as string[],
    electrical: [] as string[],
    electrical_etc: '',
    polish: [] as string[],
    polish_etc: '',
    package_options: [] as string[],
    ppf_etc: '',
    ppf_product: '',
    wrapping_etc: '',
    notes: '',
  });


  const [customerPickerSearch, setCustomerPickerSearch] = useState('');

  // ─── Data (2026-11-23 탭 분리): 목록 상태·불러오기는 src/hooks/useCrmData.ts ──
  const {
    customers, appointments, followUps, consultations, allCustomers, vehiclesByCustomer,
    teamBrief, teamOpen, setTeamOpen,
    stats, statsMonth, setStatsMonth, statsDays, setStatsDays,
    fetchCustomers, fetchAllCustomers, fetchAppointments, fetchFollowUps, fetchConsultations, fetchTeamBrief, fetchStats,
  } = useCrmData(activeTab);

  /** 헤더 새로고침: 지금 보고 있는 탭의 데이터만 다시 읽는다 (2026-11-26) */
  const refreshCurrentTab = async () => {
    if (refreshState === 'busy') return;
    setRefreshState('busy');
    const jobs: Record<Tab, (() => Promise<unknown> | void)[]> = {
      home: [fetchAppointments, fetchFollowUps, fetchTeamBrief, () => fetchStats(statsMonth), fetchAllCustomers],
      customers: [fetchCustomers, fetchAllCustomers],
      appointments: [fetchAppointments, fetchAllCustomers],
      followups: [fetchFollowUps],
      consultations: [fetchConsultations, fetchAllCustomers],
      blog: [],
    };
    try { await Promise.all((jobs[activeTab] || []).map((fn) => Promise.resolve(fn()).catch(() => undefined))); } finally {
      setRefreshState('done');
      setTimeout(() => setRefreshState('idle'), 1500);
    }
  };

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
        phone: normalizePhone(formData.phone),
        car_brand: formData.car_brand || null,
        car_model: formData.car_model || null,
        car_year: formData.car_year || null,
        car_color: formData.car_color || null,
        source: formData.source || null,
        memo: formData.memo || null,
        ...(await dealerSupport() ? { kind: formData.kind || '일반', dealer_id: formData.kind === DEALER_KIND ? null : (formData.dealer_id || null) } : {}), // 딜러 구분 (2026-11-23)
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
    // 같은 번호로 남은 미연결 상담 기록·견적 재연락을 이 고객에 붙인다 (2026-11-22 점검 1-1. 견적 문자 경로에만 있던 것)
    linkOrphanRecordsByPhone(customerId, formData.phone, { alreadyReferrer: customerReferrerId }).then((n) => { if (n.consultations || n.followUps || n.referrerLinked) { fetchConsultations(); fetchFollowUps(); fetchCustomers(); } if (n.referrerLinked) alert(`상담 기록에 적어 둔 소개한 분(${n.referrerLinked})과 자동으로 연결했습니다. 유입경로는 소개/재방문으로 두었습니다.`); }).catch(() => {});
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
      ensureArrivalNotice({ customerId, name: formData.name, phone: formData.phone, date: formData.appointment_start_date, serviceType: formData.appointment_service_type }).catch(() => {}); // 입고 전날 안내 (2026-11-22)

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
    setCustomerForm({ ...EMPTY_CUSTOMER_FORM });
    setShowAddCustomer(false);
    fetchCustomers();
    fetchAllCustomers();
    fetchAppointments();

    // 4. .ics 캘린더 파일 자동 다운로드
    if (formData.appointment_start_date && appointmentForWorkOrder && !isMobileDevice()) { // 폰은 파일만 쌓여 끔 (2026-11-23 갤럭시)
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
    const arrivalToDealer = f.follow_up_type === '입고안내' && /\(딜러\)/.test((f.memo || '').split('\n')[0]); // 딜러 번호로 (2026-11-23)
    const phone = (arrivalToDealer ? memoPhone : '') || f.customer?.phone || memoPhone;
    if (!phone) { alert('전화번호가 없는 고객입니다.'); return; }
    const t = f.follow_up_type;
    const msg = t === 'QC점검' ? QC_SMS : t === '메인터넌스' ? MAINT_SMS : t === '후기요청' ? REVIEW_SMS.proism : (f.memo || '').split('\n').slice(1).join('\n') || `안녕하세요 3M 프로이즘 대표 진준호입니다.\n${f.memo || ''}`;
    const key = followUpSmsKey(t); // 입고안내는 'arrival' (예전엔 quote 로 적혔음)
    openSmsApp(phone, msg);
    if (!(await confirmAfterSms('문자를 전송하셨나요?'))) return;
    await supabase.from('follow_ups').update({ sms_sent: { ...(f.sms_sent || {}), [key]: true } }).eq('id', f.id);
    fetchFollowUps();
  };
  // 홈 "오늘 AI가 한 일"에서 준비된 문자 보내기 (건마다 개별 전송, 2026-11-12 사장님 결정)
  const handleTeamSms = async (item: TeamItem) => {
    openSmsApp(item.phone, item.message);
    if (!(await confirmAfterSms('문자를 전송하셨나요?'))) return;
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
    if (!(await confirmAfterSms('문자를 전송하셨나요?'))) return;
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
    // 시공 기록이 있는 고객은 지우지 않는다 (2026-11-22 점검 10): 한 번 확인으로 예약·시공·사후관리·차량·회원 페이지가 전부 사라졌음
    const { count } = await supabase.from('services').select('id', { count: 'exact', head: true }).eq('customer_id', id);
    if ((count || 0) > 0) { alert(`"${name}" 고객님은 시공 기록이 ${count}건 있어 삭제할 수 없습니다.\n잘못 만든 기록이면 시공 기록을 먼저 정리하거나, 같은 분이 둘이면 전화번호가 같은지 확인해 주세요.`); return; }
    if (!confirm(`"${name}" 고객을 정말 삭제하시겠습니까?\n관련 예약, 상담, 사후관리도 모두 삭제됩니다.`)) return;
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
        if (e2) alert(`${r.label} 등록 실패: ${e2.message}`); else { made++; await closeQuoteFollowUpsFor(customerId, r.phone || null); if (r.status !== '시공중') await ensureArrivalNotice({ customerId, name: r.customerName || r.label, phone: r.phone || null, date: r.start, serviceType: r.service || null }).catch(() => false); } // 예약 잡히면 견적 재연락 닫기 + 입고 전날 안내 (2026-11-22)
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
    { const cst = allCustomers.find((c) => c.id === appointmentForm.customer_id); if (cst) ensureArrivalNotice({ customerId: cst.id, name: cst.name, phone: cst.phone, date: appointmentForm.appointment_date, serviceType: appointmentForm.service_type || null }).then((ok) => { if (ok) fetchFollowUps(); }); } // 입고 전날 안내 (2026-11-22)
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
    car_number: '', amount: '', maintenance_years: '', warranty_issued: false, crm_recorded: false,
    tinting: {
      vertex: { selected: [], density: '' }, rainbow: { selected: [], density: '' },
      glasstint: { selected: [], density: '' }, tinain: { selected: [], density: '' },
    },
    ppf: [], wrapping: [], color_ppf: [], color_ppf_etc: '', coating: [], electrical: [], electrical_etc: '',
    polish: [], polish_etc: '', package_options: [], ppf_etc: '', ppf_product: '', wrapping_etc: '', notes: '',
  });

  // 예약 날짜 바꾸기 (2026-11-22 생애 흐름 점검 3-1): 지우고 다시 만들지 않게. QC·메인터넌스 방문 예약이면 묶인 사후관리 날짜도 같이 옮긴다
  const [dateEdit, setDateEdit] = useState<Appointment | null>(null);
  const [dateEditForm, setDateEditForm] = useState({ start: '', end: '' });
  const openDateEdit = (a: Appointment) => { setDateEditForm({ start: a.appointment_date, end: a.end_date || '' }); setDateEdit(a); };
  const handleDateEditSave = async () => {
    const a = dateEdit; if (!a || !dateEditForm.start) return;
    const end = dateEditForm.end && dateEditForm.end >= dateEditForm.start ? dateEditForm.end : null;
    await supabase.from('appointments').update({ appointment_date: dateEditForm.start, end_date: CARE_VISIT_TYPES.includes(a.service_type || '') ? dateEditForm.start : end }).eq('id', a.id);
    if (a.appointment_date !== dateEditForm.start) resyncArrivalNotice({ customerId: a.customer_id, name: a.customer?.name || '고객', phone: a.customer?.phone, oldDate: a.appointment_date, newDate: dateEditForm.start, serviceType: a.service_type }).catch(() => {}); // 입고 안내도 새 날짜로
    if (CARE_VISIT_TYPES.includes(a.service_type || '')) {
      const fid = a.follow_up_id || (a.memo || '').match(/사후관리:([0-9a-f-]{36})/)?.[1];
      if (fid) await supabase.from('follow_ups').update({ scheduled_date: dateEditForm.start }).eq('id', fid);
    }
    setDateEdit(null);
    fetchAppointments(); fetchFollowUps();
  };

  const handleStatusChange = async (appointment: Appointment, newStatus: string) => {
    // 완료 변경 시 작업 내역서 모달 표시 (기존 데이터 불러오기). 리터치는 작업 내역서 대신 리터치 완료 창
    if (newStatus === '완료') {
      if (appointment.service_type === RETOUCH_TYPE) handleOpenRetouch(appointment);
      else if (CARE_VISIT_TYPES.includes(appointment.service_type || '')) handleOpenCareVisit(appointment);
      else handleOpenWorkOrder(appointment);
      return;
    }

    await supabase.from('appointments').update({ status: newStatus }).eq('id', appointment.id);
    if (newStatus === '취소') resyncArrivalNotice({ customerId: appointment.customer_id, name: appointment.customer?.name || '고객', phone: appointment.customer?.phone, oldDate: appointment.appointment_date, newDate: null, serviceType: appointment.service_type }).then(() => fetchFollowUps()).catch(() => {}); // 취소면 입고 안내도 지움
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

    // 회원 등록 막기 (2026-11-23 사장님 "성함·차종·전화번호·작업 중 하나라도 빠지면 회원 등록 안 되게"): 완료 = 보증서 발급 = 회원 등록이므로 여기서 멈춘다
    {
      const missing = await checkMemberReady(appointment.customer_id, workItems(workOrder as WorkOrderJson).length);
      if (missing.length > 0) { alert(memberBlockMessage(missing)); return; }
    }

    // 빠진 칸 한 번 묻기 (2026-11-22 사장님): 차량번호·금액·PPF 제품·썬팅 농도가 비면 회원 페이지 증명서 제품 줄과 월말 숫자가 비어 나온다
    {
      const wo = workOrder as WorkOrderJson & { amount?: string };
      const missing: string[] = [];
      if (!wo.car_number?.trim()) missing.push('차량번호');
      if (!(wo.amount && Number(wo.amount) > 0) && !appointment.amount) missing.push('금액');
      if ((wo.ppf || []).length > 0 && !ppfProductOf(wo)) missing.push('PPF 제품(제품 칸에서 선택)');
      const tintNoDensity = Object.values(wo.tinting || {}).some((t) => (t?.selected || []).length > 0 && !t?.density?.trim());
      if (tintNoDensity) missing.push('썬팅 농도');
      if (!(workOrder as { maintenance_years?: string }).maintenance_years) missing.push('메인터넌스 기간(2·3·4·5·7·10년)');
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
        work_details: workDetailsText(workOrder as WorkOrderJson, appointment.service_type || '시공'), warranty_period: (workOrder as { maintenance_years?: string }).maintenance_years ? `시공일로부터 ${(workOrder as { maintenance_years?: string }).maintenance_years}년` : '시공일로부터 1년',
        price: finalAmount ? `₩${Number(finalAmount).toLocaleString()}` : '',
      };
    } else {
      // 다시 완료 처리(내역 고침)하면 보증서의 빈칸만 보충한다 — 번호·금액을 나중에 적은 경우 (2026-11-25 점검)
      const w = memoObj.warranty as { warranty_period?: string; car_number?: string; price?: string; work_details?: string };
      if ((workOrder as { maintenance_years?: string }).maintenance_years) w.warranty_period = `시공일로부터 ${(workOrder as { maintenance_years?: string }).maintenance_years}년`;
      if (!w.car_number && workOrder.car_number) w.car_number = workOrder.car_number;
      if (!w.price && finalAmount) w.price = `₩${Number(finalAmount).toLocaleString()}`;
      if (!w.work_details) w.work_details = workDetailsText(workOrder as WorkOrderJson, appointment.service_type || '시공');
    }
    memoObj.warranty_issued = true;
    memoObj.crm_recorded = true; // 완료 처리 = CRM 기재 (체크 안 해도 자동)
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

    // 작업 내역서의 차량번호를 그 차에 적어 둔다. 예약에 차가 안 묶여 있으면(차 한 대 손님의 예전 예약 등) 대표 차에 (2026-11-25: 조성준 기록에서 번호가 안 들어간 일)
    if (appointment.vehicle_id) fillPlateIfEmpty(appointment.vehicle_id, workOrder.car_number);
    else if (workOrder.car_number?.trim()) { const vs = await loadVehicles(appointment.customer_id); const target = vs.find((v) => v.is_primary) || (vs.length === 1 ? vs[0] : null); if (target) await fillPlateIfEmpty(target.id, workOrder.car_number); }
    // 사후관리 자동 생성 (시공 기록당 한 벌만 — createAutoFollowUps 안에서 이미 있는 유형은 건너뜀)
    if (service && appointment.service_type) {
      // PPF·컬러PPF(PWF)면 2주 QC (2026-11-19 사장님). 신차패키지 안의 PWF 는 랩핑 칸에 'PWF/컬러PPF' 로 적히므로 그것도 본다 (2026-11-25 점검)
      const wrapText = [...(workOrder.wrapping || []), workOrder.wrapping_etc || ''].join(' ');
      const hasPpf = (workOrder.ppf || []).length > 0 || !!workOrder.ppf_product || !!workOrder.ppf_etc?.trim() || (workOrder.color_ppf || []).length > 0 || !!workOrder.color_ppf_etc?.trim() || /pwf|컬러\s*ppf/i.test(wrapText);
      await createAutoFollowUps(service.id, appointment.customer_id, appointment.service_type, completionDate, hasPpf);
    }

    // 예약 상태 완료로 변경 + memo 보존
    await supabase.from('appointments').update({ status: '완료', memo: mergedMemo }).eq('id', appointment.id);

    // 회원 페이지 링크(시공 증명서·보증·관리 일정) 문자 — 보증서 전달을 이 문자 하나로
    const custName = cust?.name || appointment.customer?.name || '고객';
    const custPhone = cust?.phone || appointment.customer?.phone || '';
    const link = await getOrCreateMemberLink(appointment.customer_id);
    if ('url' in link && custPhone && confirm(`${custName} 고객님을 회원으로 등록하고 보증서를 발급했습니다.\n시공 증명서·보증·관리 일정이 담긴 회원 페이지 링크를 문자로 보낼까요?`)) {
      openSmsApp(custPhone, memberLinkSms(custName, link.url, careGuidesFor([appointment.service_type || ''], woItems.map((i) => i.group))[0]?.after[0] || null)); // 관리법 첫 줄 (2026-11-22)
      await logMemberSms(appointment.customer_id, `[회원 문자] 회원 등록·보증서 발급 링크\n${link.url}`); // 같은 날 같은 기록은 한 번만 (2026-11-23)
    }

    // 출고 안내 → 딜러 (2026-11-23 사장님 "작업 상황은 딜러한테, 보증서는 고객한테"): 딜러가 넣어 준 차면 딜러에게 작업 마침 문자
    const dealer = await dealerFor(appointment.customer_id);
    if (dealer?.phone) {
      const car = [cust?.car_brand, cust?.car_model].filter(Boolean).join(' ') || null;
      if (confirm(`${dealer.name} 님(딜러)이 넣어 주신 차입니다.\n출고 안내 문자를 딜러에게 보낼까요?`)) {
        const dl = await getOrCreateMemberLink(dealer.id);
        openSmsApp(dealer.phone, dealerDoneSms(dealer.name, custName, car, appointment.service_type || null, 'token' in dl ? dealerPageUrl(dl.token) : null));
        await logMemberSms(dealer.id, `[딜러 문자] 출고 안내 · ${custName} ${car || ''} ${appointment.service_type || ''}`.trim());
      }
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
        await logMemberSms(granted.referrerId, `[회원 문자] 소개 감사 + 포인트 적립 (${granted.referredName} 님 시공 완료, 잔액 ${pts.balance}점)`);
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
  // 점검·리터치 기록의 칩에서 포인트·소개 혜택을 같은 자리에서 처리 (2026-11-22 점검 7-1·9-1)
  const applyCareBenefits = async (customerId: string, note: string) => {
    if (/소개 포인트로 공임 서비스/.test(note)) {
      const pts = await loadPoints(customerId);
      const menu = POINTS.menu.map((m, i) => `${i + 1}) ${m.label} — ${m.cost}점`).join('\n');
      const pick = window.prompt(`소개 포인트 ${pts.balance}점 중 어떤 항목으로 쓸까요? 번호만 적어 주세요.\n${menu}\n(취소하면 포인트는 그대로)`, '');
      const idx = pick ? Number(pick.trim()) - 1 : -1;
      const m = POINTS.menu[idx];
      if (m) { const err = await usePoints(customerId, m.cost, m.label); if (err) alert(err); else alert(`${m.cost}점을 사용으로 기록했습니다 (남은 ${pts.balance - m.cost}점).`); }
    }
    if (/소개 혜택\(리터치\+코팅\) 적용/.test(note)) {
      const refs = await loadReferralsFor(customerId);
      const pending = refs.gave.find((r) => !r.referrer_reward_used_at);
      if (pending) { const err = await updateReferral(pending.id, { referrer_reward_used_at: todaySeoul() }); if (!err) alert('소개한 분 혜택(리터치+코팅)을 오늘 적용한 것으로 기록했습니다.'); }
      else alert('이 분이 소개한 기록 중 아직 혜택을 안 쓴 건이 없습니다. 고객 상세 멤버십 카드를 확인해 주세요.');
    }
  };

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
    await applyCareBenefits(a.customer_id, note); // 소개 포인트 차감·소개 혜택 적용 (2026-11-22 점검 7-1·9-1)
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
    await applyCareBenefits(f.customer_id, note);
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
    const refPart = referrerToken(f.referrer); // "소개: 이름 [ref:id]" — 고객 등록 때 자동 연결 (2026-11-22)
    const memo = f.customer_id
      ? [f.memo.trim(), refPart, photoPart].filter(Boolean).join(' · ') || null
      : [who, f.car.trim(), f.memo.trim(), refPart, photoPart].filter(Boolean).join(' · ');
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

    setConsultationForm({ customer_id: '', consultation_date: '', content: '', estimate: '', interested_services: '', memo: '', name: '', phone: '', car: '', photos: [], referrer: null });
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
                {isBlacklisted(c.memo) && <span className="text-danger mr-1" title={`블랙리스트: ${blacklistInfo(c.memo)?.reason || ''}`}>⛔</span>}{c.name} {c.phone && <span className="text-[var(--c-text-3)]">({c.phone})</span>}
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
  const handleWriteBlogFromAppointment = async (a: Appointment) => {
    const key = a.service_type ? CRM_SERVICE_TO_KEY[a.service_type] : undefined;
    if (!key) return;
    const c = allCustomers.find((x) => x.id === a.customer_id);
    const history = await customerStoryLines(a.customer_id, a.appointment_date); // 재방문·소개·전 작업 (2026-11-25 사장님 "이런 스토리라인은 자연스럽게 녹여도 돼")
    let wo: { ppf?: string[]; ppf_etc?: string; ppf_product?: string; wrapping?: string[]; wrapping_etc?: string; color_ppf?: string[]; color_ppf_etc?: string; notes?: string; field_note?: string } = {};
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
    } else if (key === '컬러PPF' && ((wo.color_ppf || []).length > 0 || wo.color_ppf_etc)) {
      const parts = (wo.color_ppf || []).filter(Boolean);
      if (parts.some((x) => x.includes('전체'))) range = '전체';
      else if (parts.length > 0) range = '부분';
      if (parts.length > 0) noteParts.push(`시공 범위: ${parts.join(', ')}`);
      if (wo.color_ppf_etc) noteParts.push(`제품: ${wo.color_ppf_etc}`);
    } else if (key === '랩핑' || key === '컬러PPF') {
      const parts = [...(wo.wrapping || []), wo.wrapping_etc || ''].filter(Boolean);
      if (parts.some((x) => x.includes('전체'))) range = '전체';
      else if (parts.length > 0) range = '부분';
      if (parts.length > 0) noteParts.push(`시공 범위: ${parts.join(', ')}`);
    }
    if (wo.field_note) noteParts.unshift(wo.field_note); // 완료 처리 때 적은 '이 차에서 있었던 일' — 현장 메모 맨 앞 (2026-11-25)
    if (wo.notes) noteParts.push(wo.notes);
    if (plainMemo) noteParts.push(plainMemo);
    if (history.length) noteParts.push(`[손님 이력 — CRM 기록, 사실이라 글에 써도 됨. 이름은 쓰지 않는다]\n${history.join('\n')}`);

    const dateLabel = new Date(a.appointment_date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
    const prefill: BlogPrefill = {
      brand: c?.car_brand || undefined,
      model: c?.car_model || undefined,
      color: c?.car_color || undefined,
      serviceKey: key,
      range,
      product: key === 'PPF' && wo.ppf_product ? `3M ${wo.ppf_product}` : undefined, // 작업 내역서에서 고른 제품 (2026-11-25)
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
    ...(isDemo ? [] : [{ key: 'blog' as Tab, label: '블로그' }]),
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
                className="w-8 h-8 rounded-full border border-[var(--c-border)] bg-[var(--c-card)] flex items-center justify-center text-[var(--c-text-2)] hover:bg-[var(--c-subtle)] transition-colors"
                title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
                aria-label={theme === 'dark' ? '라이트 모드' : '다크 모드'}
              >
                <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={15} />
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
              <button
                onClick={refreshCurrentTab}
                disabled={refreshState === 'busy'}
                className="w-8 h-8 rounded-full border border-[var(--c-border)] bg-[var(--c-card)] flex items-center justify-center text-[var(--c-text-2)] hover:bg-[var(--c-subtle)] transition-colors disabled:opacity-70"
                title="이 탭 새로고침"
                aria-label="이 탭 새로고침"
              >
                <Icon name={refreshState === 'done' ? 'check' : 'refresh'} size={15} className={refreshState === 'busy' ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={() => setNotifOpen(true)}
                className="w-8 h-8 rounded-full border border-[var(--c-border)] bg-[var(--c-card)] flex items-center justify-center text-[var(--c-text-2)] hover:bg-[var(--c-subtle)] transition-colors"
                title="받은 알림"
                aria-label="받은 알림"
              >
                <Icon name="bell" size={15} />
              </button>
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
            {/* 회원 탭은 고객 목록의 '회원' 필터로 합침 (2026-11-26 사장님). 소개 현황 페이지(/crm/membership)는 고객 목록 회원 필터에서 링크로 */}
          </nav>
        </div>
      </header>

      {/* Content */}
      <div className={activeTab === 'blog' ? 'hidden' : 'flex-1 overflow-y-auto px-4 md:px-6 py-5 md:py-6 [&>*]:mx-auto [&>*]:max-w-[1360px]'}>
        {/* ─── TAB: 홈 (2026-11-11 하남점 페이지 구조: 인사 → 빠른 실행 → 오늘 예약 / 연락할 사후관리) ─── */}
        {activeTab === 'home' && (
          <HomeTab
            today={today} isDemo={isDemo} appointments={appointments} followUps={followUps} allCustomers={allCustomers}
            teamBrief={teamBrief} teamOpen={teamOpen} setTeamOpen={setTeamOpen} fetchTeamBrief={fetchTeamBrief}
            stats={stats} statsMonth={statsMonth} setStatsMonth={setStatsMonth} fetchStats={fetchStats} statsDays={statsDays} setStatsDays={setStatsDays}
            handleStatusChange={handleStatusChange} openDateEdit={openDateEdit} handleTeamSms={handleTeamSms}
            setShowAddCustomer={setShowAddCustomer} setShowAddAppointment={setShowAddAppointment} setQuoteSms={setQuoteSms} setShowInquiry={setShowInquiry} setActiveTab={setActiveTab}
          />
        )}

        {/* ─── TAB: 고객 목록 ──────────────────────────────── */}
        {activeTab === 'customers' && (
          <CustomersTab
            customerSearch={customerSearch} setCustomerSearch={setCustomerSearch} filteredCustomers={filteredCustomers} dealerNames={new Map(customers.filter((c) => c.kind === DEALER_KIND).map((c) => [c.id, c.name]))} vehiclesByCustomer={vehiclesByCustomer} router={router}
            setCustomerForm={setCustomerForm} setEditCustomerId={setEditCustomerId} setShowAddCustomer={setShowAddCustomer}
            handleEditCustomer={handleEditCustomer} handleDeleteCustomer={handleDeleteCustomer}
          />
        )}

        {/* ─── TAB: 예약/일정 ──────────────────────────────── */}
        {activeTab === 'appointments' && (
          <AppointmentsTab
            today={today} isDemo={isDemo} appointments={appointments} calendarView={calendarView} setCalendarView={setCalendarView} managerFilter={managerFilter}
            calendarMonth={calendarMonth} setCalendarMonth={setCalendarMonth} selectedDate={selectedDate} setSelectedDate={setSelectedDate}
            setShowCalendarSub={setShowCalendarSub} setShowShotImport={setShowShotImport} setShotMonth={setShotMonth} setShowAddAppointment={setShowAddAppointment}
            hasWarrantyIssued={hasWarrantyIssued} reviewSentFor={reviewSentFor}
            handleEditCustomerFromAppointment={handleEditCustomerFromAppointment} handleWriteBlogFromAppointment={handleWriteBlogFromAppointment}
            handleOpenCareVisit={handleOpenCareVisit} handleOpenRetouch={handleOpenRetouch} handleOpenWorkOrder={handleOpenWorkOrder} handleOpenWarranty={handleOpenWarranty}
            handleReviewSmsFromAppointment={handleReviewSmsFromAppointment} handleStatusChange={handleStatusChange} openDateEdit={openDateEdit} handleDeleteAppointment={handleDeleteAppointment}
          />
        )}

        {/* ─── TAB: 사후관리 ──────────────────────────────── */}
        {activeTab === 'followups' && (
          <FollowUpsTab
            today={today} followUps={followUps} filteredFollowUps={filteredFollowUps} allCustomers={allCustomers}
            followUpFilter={followUpFilter} setFollowUpFilter={setFollowUpFilter} followSearch={followSearch} setFollowSearch={setFollowSearch}
            followDate={followDate} setFollowDate={setFollowDate} followMonth={followMonth} setFollowMonth={setFollowMonth} showOverdue={showOverdue} setShowOverdue={setShowOverdue}
            statsMonth={statsMonth} fetchFollowUps={fetchFollowUps} fetchStats={fetchStats} customerHasWarranty={customerHasWarranty}
            handleToggleFollowUp={handleToggleFollowUp} handleReviewReceived={handleReviewReceived} handleAddCustomerFromQuote={handleAddCustomerFromQuote}
            handleOpenWarrantyFromFollowUp={handleOpenWarrantyFromFollowUp} openCareBook={openCareBook} setActiveTab={setActiveTab}
          />
        )}

        {/* ─── TAB: 상담 기록 ──────────────────────────────── */}
        {activeTab === 'consultations' && (
          <ConsultationsTab
            consultations={consultations} customers={customers} handleAddCustomerFromQuote={handleAddCustomerFromQuote}
            setQuoteSms={setQuoteSms} setShowInquiry={setShowInquiry} setShowAddConsultation={setShowAddConsultation}
            setShowCallImport={(v) => { if (v) fetchCustomers(); setShowCallImport(v); }}
          />
        )}
      </div>

      {/* ─── TAB: 블로그 (2026-11-12 블로그 페이지를 CRM 탭으로 합침) ─── */}
      {blogVisited && !isDemo && (
        <div className={activeTab === 'blog' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
          <BlogWorkspace embedded prefillNonce={prefillNonce} />
        </div>
      )}
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <NotificationsModal open={notifOpen} onClose={() => setNotifOpen(false)} />
      <BadgeClearer />

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
                    <input type="tel" inputMode="numeric" placeholder="010-0000-0000 *" value={consultationForm.phone} onChange={(e) => setConsultationForm({ ...consultationForm, phone: formatPhoneInput(e.target.value) })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[var(--c-text-1)]" />
                    <BlacklistWarning phone={consultationForm.phone} />
                    <input type="text" placeholder="차종 (예: 포르쉐 카이엔)" value={consultationForm.car} onChange={(e) => setConsultationForm({ ...consultationForm, car: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[var(--c-text-1)]" />
                    <ReferrerPicker compact value={consultationForm.referrer} onChange={(p) => setConsultationForm({ ...consultationForm, referrer: p })} excludeCustomerId={consultationForm.customer_id || null} />
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
      {dateEdit && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-end sm:items-center justify-center p-3" onClick={() => setDateEdit(null)}>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl w-full max-w-sm p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[var(--c-text-1)] font-semibold">예약 날짜 바꾸기</div>
            <div className="text-xs text-[var(--c-text-3)] mt-0.5 mb-4">{dateEdit.customer?.name || '고객'} · {dateEdit.service_type || '시공 미정'}{CARE_VISIT_TYPES.includes(dateEdit.service_type || '') ? ' · 사후관리 날짜도 같이 바뀝니다' : ''}</div>
            <div className={CARE_VISIT_TYPES.includes(dateEdit.service_type || '') ? '' : 'grid grid-cols-2 gap-3'}>
              <div><label className="text-xs text-[var(--c-text-3)] mb-1 block">{CARE_VISIT_TYPES.includes(dateEdit.service_type || '') ? '방문일' : '시작일'} *</label><input type="date" value={dateEditForm.start} onChange={(e) => setDateEditForm({ ...dateEditForm, start: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" /></div>
              {!CARE_VISIT_TYPES.includes(dateEdit.service_type || '') && <div><label className="text-xs text-[var(--c-text-3)] mb-1 block">종료일</label><input type="date" value={dateEditForm.end} min={dateEditForm.start} onChange={(e) => setDateEditForm({ ...dateEditForm, end: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" /></div>}
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setDateEdit(null)} className="text-sm px-4 py-2 rounded-lg border border-[var(--c-border)] text-[var(--c-text-2)]">취소</button>
              <button onClick={handleDateEditSave} disabled={!dateEditForm.start} className="text-sm px-4 py-2 rounded-lg bg-brand text-white disabled:opacity-40">저장</button>
            </div>
          </div>
        </div>
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
              <button onClick={() => { copyText('https://proism-ai.vercel.app/api/calendar?token=proism2026').then((ok) => alert(ok ? 'URL이 복사되었습니다!' : '복사하지 못했습니다. 주소를 길게 눌러 복사해 주세요.')); }} className="bg-info hover:bg-info text-white text-xs font-medium rounded-lg px-3 py-2 transition-colors whitespace-nowrap">URL 복사</button>
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
      {showCallImport && (
        <CallSummaryImportModal
          customers={customers}
          onClose={() => setShowCallImport(false)}
          onDone={() => { fetchConsultations(); fetchFollowUps(); fetchTeamBrief(); }}
          openQuote={(v) => setQuoteSms(v)}
          openAppointment={(v) => { setAppointmentForm({ customer_id: v.customerId || '', appointment_date: v.date || '', end_date: '', service_type: v.serviceType || '', amount: '', memo: v.memo, vehicle_id: '' }); setShowAddAppointment(true); }}
        />
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
          3M 프로이즘 강남서초점 · 서초중앙로8길 82, 1동 1층 · 010-7287-7140
        </div>
      )}
    </div>
  );
}

