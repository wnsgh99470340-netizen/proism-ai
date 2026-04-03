'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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
}

interface Appointment {
  id: string;
  customer_id: string;
  appointment_date: string;
  end_date?: string | null;
  service_type: string | null;
  status: string;
  memo: string | null;
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

type Tab = 'customers' | 'appointments' | 'followups' | 'consultations' | 'templates';

const SERVICE_TYPES = ['PPF', '컬러PPF', 'PWF', '랩핑', '크롬죽이기', '썬팅', '유리막코팅', '가죽코팅', '실내PPF', '신차패키지'];
const APPOINTMENT_STATUSES = ['상담중', '예약확정', '시공중', '완료'];
const FOLLOW_UP_TYPES = ['QC점검', '메인터넌스', '후기요청'];

const DEFAULT_TEMPLATES: Record<string, string> = {
  '크롬죽이기': `안녕하세요? 3M 프로이즘 입니다.
문의주신 견적 안내드리며, 자세한 내용과 서비스 혜택 안내드립니다.

크롬죽이기 전체시공 정가 140>할인가 120만원까지 시공가능하시며 그릴을 가져오신다면 ( 90만원까지 전체크롬죽이기 가능하십니다 ^^)

집중하여 작업하고있는 것을 원칙으로하여, 바로 예약이 안되어
사전예약을 받고 있으니 참고 부탁드립니다 ^^

사전예약 시 다음 무상시공 혜택을 드립니다.
[무상시공] 생활보호패키지 4종(컵 엣지 주유구 트렁크리드 )
[무상시공] 실내PPF [ 액정 )
[옵션시공] PPF / 랩핑 / 루프스킨 / 크롬딜리트 / 투톤PPF

[참고 해주세요]
1. 우리는 전 세계적으로 인증받고있는 제품의 3M PRO 취급점 이며 제품과 기술력의 인증이 확실합니다.
2. 시공 후 6개월 주기로 꾸준한 메인터넌스 헤택을 받을 수 있습니다.
3. 제품보증과 시공보증 2중발급 시스템으로 확실한 사후관리가 가능합니다.`,
  'PPF': `안녕하세요? 3M 프로이즘 입니다.
문의주신 견적 안내드리며, 자세한 내용과 서비스 혜택 안내드립니다.

사전예약 시 다음 무상시공 혜택을 드립니다.
[무상시공] 필름코팅
[무상시공] 실내PPF [ T존 ]
[무상시공] 실내전체코팅
[옵션시공] PPF / 랩핑 / 루프스킨 / 크롬딜리트 / 투톤PPF

[참고 해주세요]
1. 우리는 전 세계적으로 인증받고있는 제품의 3M PRO 취급점 이며 제품과 기술력의 인증이 확실합니다.
2. 시공 후 6개월 주기로 꾸준한 메인터넌스 헤택을 받을 수 있습니다.
3. 제품보증과 시공보증 2중발급 시스템으로 확실한 사후관리가 가능합니다.`,
  '신차패키지': `안녕하세요? 3M 프로이즘 입니다.
문의주신 견적 안내드리며, 자세한 내용과 서비스 혜택 안내드립니다.

사전예약 시 다음 무상시공 혜택을 드립니다.
[무상시공] 실내PPF [ T존 ]
[무상시공] B/C필러 PPF
[무상시공] 유리막코팅 업그레이드 (2layering)
[옵션시공] PPF / 랩핑 / 루프스킨 / 크롬딜리트 / 투톤PPF

[참고 해주세요]
1. 신차계약 후 탁송지 지정은 3M 프로이즘으로 해주세요 [서초동 1604-7 1층 3M 프로이즘]
2. 차량도착 후 정비자격증소지자의 섬세한 검수가 이뤄집니다. [도막/열화상/진단기/스코프/공기압/배터리진단기 사용] 6SET 첨단장비 사용
3. 인수인계 여부 및 이슈발생 시, 해결방안 피드백까지 전달드립니다.`,
  '랩핑': `안녕하세요? 3M 프로이즘 입니다.
문의주신 견적 안내드리며, 자세한 내용과 서비스 혜택 안내드립니다.

사전예약 시 다음 무상시공 혜택을 드립니다.
[무상시공] 필름코팅
[무상시공] 실내PPF [ T존 ]
[무상시공] 생활보호패키지 컵 /엣지 PPF
[옵션시공] PPF / 랩핑 / 루프스킨 / 크롬딜리트 / 투톤PPF

[참고 해주세요]
1. 우리는 전 세계적으로 인증받고있는 제품의 3M PRO 취급점 이며 제품과 기술력의 인증이 확실합니다.
2. 시공 후 6개월 주기로 꾸준한 메인터넌스 헤택을 받을 수 있습니다.
3. 제품보증과 시공보증 2중발급 시스템으로 확실한 사후관리가 가능합니다.`,
};

const TEMPLATE_KEYS = ['크롬죽이기', 'PPF', '신차패키지', '랩핑'];

// 사후관리 자동 생성 로직
async function createAutoFollowUps(
  serviceId: string,
  customerId: string,
  serviceType: string,
  completionDate: string
) {
  const base = new Date(completionDate);
  const followUps: { service_id: string; customer_id: string; follow_up_type: string; scheduled_date: string; memo: string }[] = [];

  const needsQC = ['PPF', '컬러PPF', 'PWF'].includes(serviceType);

  if (needsQC) {
    const qcDate = new Date(base);
    qcDate.setDate(qcDate.getDate() + 14);
    followUps.push({
      service_id: serviceId,
      customer_id: customerId,
      follow_up_type: 'QC점검',
      scheduled_date: qcDate.toISOString().split('T')[0],
      memo: `${serviceType} 시공 완료 후 2주 QC점검`,
    });
  }

  const maintDate = new Date(base);
  maintDate.setMonth(maintDate.getMonth() + 6);
  followUps.push({
    service_id: serviceId,
    customer_id: customerId,
    follow_up_type: '메인터넌스',
    scheduled_date: maintDate.toISOString().split('T')[0],
    memo: `${serviceType} 시공 완료 후 6개월 메인터넌스`,
  });

  // 후기요청: 시공 완료 3일 후
  const reviewDate = new Date(base);
  reviewDate.setDate(reviewDate.getDate() + 3);
  followUps.push({
    service_id: serviceId,
    customer_id: customerId,
    follow_up_type: '후기요청',
    scheduled_date: reviewDate.toISOString().split('T')[0],
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
    case '상담중': return 'bg-[#71717a]/20 text-[#a1a1aa]';
    case '예약확정': return 'bg-[#3B82F6]/20 text-[#60A5FA]';
    case '시공중': return 'bg-[#F59E0B]/20 text-[#FBBF24]';
    case '완료': return 'bg-[#10B981]/20 text-[#34D399]';
    default: return 'bg-[#71717a]/20 text-[#a1a1aa]';
  }
}

// ─── Main Page ───────────────────────────────────────────
export default function CRMPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('customers');

  // Customer state
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [editCustomerId, setEditCustomerId] = useState<string | null>(null);
  const [customerForm, setCustomerForm] = useState({
    name: '', phone: '', car_brand: '', car_model: '', car_year: '', car_color: '', source: '', memo: '',
    appointment_start_date: '', appointment_end_date: '', appointment_service_type: '', appointment_memo: '',
  });

  // Appointment state
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [showAddAppointment, setShowAddAppointment] = useState(false);
  const [appointmentForm, setAppointmentForm] = useState({
    customer_id: '', appointment_date: '', end_date: '', service_type: '', memo: '',
  });
  const [calendarView, setCalendarView] = useState<'calendar' | 'list'>('calendar');
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Follow-up state
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [followUpFilter, setFollowUpFilter] = useState<'upcoming' | 'overdue' | 'completed'>('upcoming');

  // Consultation state
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [showAddConsultation, setShowAddConsultation] = useState(false);
  const [consultationForm, setConsultationForm] = useState({
    customer_id: '', consultation_date: '', content: '', estimate: '', interested_services: '', memo: '',
  });

  // Work order modal state
  const [showWorkOrder, setShowWorkOrder] = useState(false);
  const [workOrderAppointment, setWorkOrderAppointment] = useState<Appointment | null>(null);

  // Warranty modal state
  const [showWarranty, setShowWarranty] = useState(false);
  const [warrantyAppointment, setWarrantyAppointment] = useState<Appointment | null>(null);
  const [warrantyForm, setWarrantyForm] = useState({
    date: '', car_type: '', car_number: '', customer_name: '', phone: '',
    work_details: '', warranty_period: '시공일로부터 1년', price: '',
  });
  const [workOrder, setWorkOrder] = useState({
    car_number: '',
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

  // Template state
  const [templates, setTemplates] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('crm_templates');
      if (saved) { try { return JSON.parse(saved); } catch { /* ignore */ } }
    }
    return { ...DEFAULT_TEMPLATES };
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleTemplateChange = (key: string, value: string) => {
    const updated = { ...templates, [key]: value };
    setTemplates(updated);
    if (debounceRef.current[key]) clearTimeout(debounceRef.current[key]);
    debounceRef.current[key] = setTimeout(() => {
      localStorage.setItem('crm_templates', JSON.stringify(updated));
    }, 500);
  };

  const handleCopyTemplate = async (key: string) => {
    await navigator.clipboard.writeText(templates[key] || '');
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleResetTemplate = (key: string) => {
    if (!confirm(`"${key}" 템플릿을 기본값으로 복원하시겠습니까?`)) return;
    const updated = { ...templates, [key]: DEFAULT_TEMPLATES[key] };
    setTemplates(updated);
    localStorage.setItem('crm_templates', JSON.stringify(updated));
  };

  const handleSaveTemplateImage = (key: string) => {
    const text = templates[key] || '';
    const lines = text.split('\n');
    const W = 800;
    const PAD = 48;
    const LINE_H = 28;
    const FONT_SIZE = 16;
    const HEADER_H = 80;
    const FOOTER_H = 70;
    const bodyH = lines.length * LINE_H + 24;
    const H = HEADER_H + bodyH + FOOTER_H + PAD * 2;

    const canvas = document.createElement('canvas');
    canvas.width = W * 2;
    canvas.height = H * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);

    // 배경
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // 상단 로고
    ctx.fillStyle = '#E4002B';
    ctx.font = `bold 24px "Pretendard Variable", -apple-system, sans-serif`;
    ctx.fillText('◆ 3M 프로이즘', PAD, PAD + 30);
    ctx.fillStyle = '#666666';
    ctx.font = `14px "Pretendard Variable", -apple-system, sans-serif`;
    ctx.fillText(`${key} 견적 안내`, PAD + 220, PAD + 30);

    // 구분선
    ctx.strokeStyle = '#E4002B';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, HEADER_H + PAD - 10);
    ctx.lineTo(W - PAD, HEADER_H + PAD - 10);
    ctx.stroke();

    // 본문
    ctx.fillStyle = '#1a1a1a';
    ctx.font = `${FONT_SIZE}px "Pretendard Variable", -apple-system, sans-serif`;
    lines.forEach((line, i) => {
      const y = HEADER_H + PAD + 20 + i * LINE_H;
      if (line.startsWith('[') && line.endsWith(']')) {
        ctx.font = `bold ${FONT_SIZE}px "Pretendard Variable", -apple-system, sans-serif`;
        ctx.fillStyle = '#E4002B';
        ctx.fillText(line, PAD, y);
        ctx.font = `${FONT_SIZE}px "Pretendard Variable", -apple-system, sans-serif`;
        ctx.fillStyle = '#1a1a1a';
      } else {
        ctx.fillText(line, PAD, y);
      }
    });

    // 하단 구분선
    const footerY = H - FOOTER_H - 10;
    ctx.strokeStyle = '#dddddd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, footerY);
    ctx.lineTo(W - PAD, footerY);
    ctx.stroke();

    // 하단 정보
    ctx.fillStyle = '#888888';
    ctx.font = `13px "Pretendard Variable", -apple-system, sans-serif`;
    ctx.fillText('서울특별시 서초구 서초중앙로8길 82 1동 1층 1호 | 3M 프로이즘', PAD, footerY + 25);
    ctx.fillText('3M 공식 프리퍼드 인스톨러 인증점', PAD, footerY + 48);

    // 다운로드
    const link = document.createElement('a');
    link.download = `프로이즘_${key}_견적.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  // Customer picker state (shared)
  const [allCustomers, setAllCustomers] = useState<{ id: string; name: string; phone: string | null }[]>([]);
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
            .order('service_date', { ascending: false })
            .limit(1);

          return {
            ...c,
            latest_service: services?.[0]?.service_type ?? null,
            latest_service_date: services?.[0]?.service_date ?? null,
          };
        })
      );
      setCustomers(customersWithService);
    }
  }, []);

  const fetchAllCustomers = useCallback(async () => {
    const { data } = await supabase.from('customers').select('id, name, phone').order('name');
    if (data) setAllCustomers(data);
  }, []);

  const fetchAppointments = useCallback(async () => {
    const { data } = await supabase
      .from('appointments')
      .select('*, customer:customers(name, phone)')
      .order('appointment_date', { ascending: true });
    if (data) {
      // 오늘 기준 가까운 예약이 위로: 오늘/미래 → 날짜 오름차순, 과거 → 날짜 내림차순 (아래로)
      const todayStr = new Date().toISOString().split('T')[0];
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
    if (activeTab === 'customers') fetchCustomers();
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

    if (hasDateAndType) {
      const { data: apptData, error: apptError } = await supabase
        .from('appointments')
        .insert({
          customer_id: customerId,
          appointment_date: formData.appointment_start_date,
          end_date: formData.appointment_end_date || null,
          service_type: formData.appointment_service_type,
          status: '예약확정',
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
        memo: formData.appointment_memo || null,
      });
    }

    // 3. 폼 리셋 + 모달 닫기
    setCustomerForm({ name: '', phone: '', car_brand: '', car_model: '', car_year: '', car_color: '', source: '', memo: '', appointment_start_date: '', appointment_end_date: '', appointment_service_type: '', appointment_memo: '' });
    setShowAddCustomer(false);
    fetchCustomers();
    fetchAllCustomers();
    fetchAppointments();

    // 4. 작업 내역서 모달 또는 알림
    if (hasDateAndType && appointmentForWorkOrder) {
      console.log('[CRM] 작업 내역서 모달 열기!');
      resetWorkOrder();
      setWorkOrderAppointment(appointmentForWorkOrder);
      setTimeout(() => setShowWorkOrder(true), 200);
    } else if (formData.appointment_start_date) {
      alert('고객 등록 + 예약 완료');
    } else {
      alert('고객 등록 완료');
    }
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

  const handleEditCustomer = (customer: Customer) => {
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
    setCustomerForm({ name: '', phone: '', car_brand: '', car_model: '', car_year: '', car_color: '', source: '', memo: '', appointment_start_date: '', appointment_end_date: '', appointment_service_type: '', appointment_memo: '' });
    setEditCustomerId(null);
    setShowAddCustomer(false);
    fetchCustomers();
    fetchAllCustomers();
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
      memo: appointmentForm.memo || null,
    });
    setAppointmentForm({ customer_id: '', appointment_date: '', end_date: '', service_type: '', memo: '' });
    setShowAddAppointment(false);
    fetchAppointments();
  };

  const resetWorkOrder = () => setWorkOrder({
    car_number: '', warranty_issued: false, crm_recorded: false,
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
    const completionDate = new Date().toISOString().split('T')[0];

    // 시공 이력 생성 (작업 내역서 데이터를 memo에 JSON으로 저장)
    const { data: service } = await supabase
      .from('services')
      .insert({
        customer_id: appointment.customer_id,
        service_type: appointment.service_type || '기타',
        service_date: appointment.appointment_date,
        completion_date: completionDate,
        memo: JSON.stringify(workOrder),
      })
      .select()
      .single();

    // 사후관리 자동 생성
    if (service && appointment.service_type) {
      await createAutoFollowUps(service.id, appointment.customer_id, appointment.service_type, completionDate);
    }

    // 예약 상태 완료로 변경
    await supabase.from('appointments').update({ status: '완료' }).eq('id', appointment.id);

    setShowWorkOrder(false);
    setWorkOrderAppointment(null);
    fetchAppointments();
    fetchFollowUps();
  };

  const handleWorkOrderSaveOnly = async () => {
    if (!workOrderAppointment) return;
    // 작업 내역서 데이터만 예약 memo에 JSON으로 저장, 상태는 '예약확정' 유지
    if (workOrderAppointment.id) {
      await supabase.from('appointments')
        .update({ memo: JSON.stringify(workOrder), status: '예약확정' })
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
          setWorkOrder(parsed);
          setWorkOrderAppointment(appointment);
          setShowWorkOrder(true);
          return;
        }
      } catch { /* not JSON, ignore */ }
    }
    resetWorkOrder();
    setWorkOrderAppointment(appointment);
    setShowWorkOrder(true);
  };

  // ─── Warranty Actions ────────────────────────────────────
  const handleOpenWarranty = async (appointment: Appointment) => {
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
        car_type: saved.car_type || `${appointment.customer?.name ? '' : ''}${carNumber ? ' ' + carNumber : ''}`.trim(),
        car_number: saved.car_number || carNumber,
        customer_name: saved.customer_name || appointment.customer?.name || '',
        phone: saved.phone || appointment.customer?.phone || '',
        work_details: saved.work_details || '',
        warranty_period: saved.warranty_period || '시공일로부터 1년',
        price: saved.price || '',
      });
    } else {
      setWarrantyForm({
        date: appointment.appointment_date || new Date().toISOString().split('T')[0],
        car_type: '',
        car_number: carNumber,
        customer_name: appointment.customer?.name || '',
        phone: appointment.customer?.phone || '',
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

  // ─── Follow-up Actions ──────────────────────────────────
  const handleToggleFollowUp = async (followUp: FollowUp) => {
    const newCompleted = !followUp.is_completed;
    await supabase
      .from('follow_ups')
      .update({
        is_completed: newCompleted,
        completed_date: newCompleted ? new Date().toISOString().split('T')[0] : null,
      })
      .eq('id', followUp.id);
    fetchFollowUps();
  };

  const today = new Date().toISOString().split('T')[0];
  const filteredFollowUps = followUps.filter((f) => {
    if (followUpFilter === 'completed') return f.is_completed;
    if (followUpFilter === 'overdue') return !f.is_completed && f.scheduled_date < today;
    return !f.is_completed && f.scheduled_date >= today;
  });

  // ─── Consultation Actions ───────────────────────────────
  const handleAddConsultation = async () => {
    if (!consultationForm.customer_id || !consultationForm.consultation_date) return;
    await supabase.from('consultations').insert({
      customer_id: consultationForm.customer_id,
      consultation_date: consultationForm.consultation_date,
      content: consultationForm.content || null,
      estimate: consultationForm.estimate || null,
      interested_services: consultationForm.interested_services || null,
      memo: consultationForm.memo || null,
    });
    setConsultationForm({ customer_id: '', consultation_date: '', content: '', estimate: '', interested_services: '', memo: '' });
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
          className="w-full text-left bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] hover:border-[#C8A951]/50 transition-colors"
        >
          {selected ? `${selected.name}${selected.phone ? ` (${selected.phone})` : ''}` : '고객 선택...'}
        </button>
        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[#111113] border border-[#1e1e22] rounded-lg shadow-2xl z-50 max-h-48 overflow-y-auto">
            <div className="p-2 border-b border-[#1e1e22]">
              <input
                type="text"
                placeholder="이름 또는 연락처 검색..."
                value={customerPickerSearch}
                onChange={(e) => setCustomerPickerSearch(e.target.value)}
                className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded px-2 py-1.5 text-xs text-[#fafaf9] outline-none focus:border-[#C8A951]/50"
                autoFocus
              />
            </div>
            {filteredPickerCustomers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onChange(c.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm text-[#fafaf9] hover:bg-[#1e1e22] transition-colors"
              >
                {c.name} {c.phone && <span className="text-[#71717a]">({c.phone})</span>}
              </button>
            ))}
            {filteredPickerCustomers.length === 0 && (
              <div className="px-3 py-2 text-xs text-[#71717a]">검색 결과 없음</div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ─── Render ─────────────────────────────────────────────
  const tabs: { key: Tab; label: string }[] = [
    { key: 'customers', label: '고객 목록' },
    { key: 'appointments', label: '예약/일정' },
    { key: 'followups', label: '사후관리' },
    { key: 'consultations', label: '상담 기록' },
    { key: 'templates', label: '견적 템플릿' },
  ];

  return (
    <div className="h-screen flex flex-col bg-[#09090b]">
      {/* Header */}
      <div className="h-14 border-b border-[#1e1e22] bg-[#111113] flex items-center px-4 justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="text-[#E4002B] text-lg font-bold">◆</span>
            <span className="text-[#fafaf9] font-semibold text-sm">3M 프로이즘 AI</span>
          </Link>
          <span className="text-[#1e1e22]">|</span>
          <span className="text-[#C8A951] text-sm font-medium">고객 관리 CRM</span>
        </div>
        <Link
          href="/"
          className="text-xs text-[#71717a] hover:text-[#fafaf9] transition-colors bg-[#1e1e22] hover:bg-[#2a2a2e] rounded-lg px-3 py-1.5"
        >
          블로그 에이전트로 돌아가기
        </Link>
      </div>

      {/* Tabs */}
      <div className="border-b border-[#1e1e22] bg-[#111113] px-4 flex gap-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-3 text-sm font-medium transition-colors relative ${
              activeTab === tab.key
                ? 'text-[#C8A951]'
                : 'text-[#71717a] hover:text-[#a1a1aa]'
            }`}
          >
            {tab.label}
            {activeTab === tab.key && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#C8A951]" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
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
                  className="bg-[#111113] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] w-64 outline-none focus:border-[#C8A951]/50 transition-colors placeholder:text-[#71717a]"
                />
                <span className="text-xs text-[#71717a]">{filteredCustomers.length}명</span>
              </div>
              <button
                onClick={() => { setEditCustomerId(null); setCustomerForm({ name: '', phone: '', car_brand: '', car_model: '', car_year: '', car_color: '', source: '', memo: '', appointment_start_date: '', appointment_end_date: '', appointment_service_type: '', appointment_memo: '' }); setShowAddCustomer(true); }}
                className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
              >
                + 고객 추가
              </button>
            </div>

            <div className="bg-[#111113] border border-[#1e1e22] rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#1e1e22]">
                    <th className="text-left px-4 py-3 text-xs font-medium text-[#71717a]">이름</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-[#71717a]">연락처</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-[#71717a]">차종</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-[#71717a]">최근 시공</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-[#71717a]">등록일</th>
                    <th className="w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => router.push(`/crm/${c.id}`)}
                      className="border-b border-[#1e1e22] last:border-b-0 hover:bg-[#1a1a1f] cursor-pointer transition-colors group"
                    >
                      <td className="px-4 py-3 text-sm text-[#fafaf9] font-medium">{c.name}</td>
                      <td className="px-4 py-3 text-sm text-[#a1a1aa]">{c.phone || '-'}</td>
                      <td className="px-4 py-3 text-sm text-[#a1a1aa]">
                        {c.car_brand || c.car_model
                          ? `${c.car_brand || ''} ${c.car_model || ''}`.trim()
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#a1a1aa]">
                        {c.latest_service
                          ? `${c.latest_service} (${formatDate(c.latest_service_date)})`
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#71717a]">{formatDate(c.created_at)}</td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEditCustomer(c); }}
                            className="w-6 h-6 rounded flex items-center justify-center text-[#71717a] hover:text-[#C8A951] hover:bg-[#C8A951]/10 transition-all text-xs"
                            title="수정"
                          >✎</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteCustomer(c.id, c.name); }}
                            className="w-6 h-6 rounded flex items-center justify-center text-[#71717a] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-all text-xs"
                            title="삭제"
                          >✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredCustomers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-sm text-[#71717a]">
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

          const statusBarColor = (status: string) => {
            switch (status) {
              case '상담중': return 'bg-[#71717a]';
              case '예약확정': return 'bg-[#3B82F6]';
              case '시공중': return 'bg-[#C8A951]';
              case '완료': return 'bg-[#22C55E]';
              default: return 'bg-[#71717a]';
            }
          };

          const displayAppointments = calendarView === 'calendar' && selectedDate
            ? apptByDate(selectedDate)
            : appointments;

          const goToday = () => {
            const now = new Date();
            setCalendarMonth({ year: now.getFullYear(), month: now.getMonth() });
            setSelectedDate(today);
          };

          return (
            <div>
              {/* 상단 바 */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => setCalendarMonth((p) => { const d = new Date(p.year, p.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })} className="text-[#71717a] hover:text-[#fafaf9] transition-colors text-lg leading-none">◀</button>
                  <span className="text-base font-semibold text-[#fafaf9] min-w-[120px] text-center">{cY}년 {cM + 1}월</span>
                  <button onClick={() => setCalendarMonth((p) => { const d = new Date(p.year, p.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })} className="text-[#71717a] hover:text-[#fafaf9] transition-colors text-lg leading-none">▶</button>
                  <button onClick={goToday} className="text-xs bg-[#1e1e22] hover:bg-[#2a2a2e] text-[#a1a1aa] rounded-lg px-3 py-1 transition-colors ml-1">오늘</button>
                  <div className="flex bg-[#1e1e22] rounded-lg p-0.5 ml-2">
                    <button onClick={() => setCalendarView('calendar')} className={`text-xs px-3 py-1 rounded-md transition-colors ${calendarView === 'calendar' ? 'bg-[#C8A951]/20 text-[#C8A951]' : 'text-[#71717a]'}`}>달력</button>
                    <button onClick={() => setCalendarView('list')} className={`text-xs px-3 py-1 rounded-md transition-colors ${calendarView === 'list' ? 'bg-[#C8A951]/20 text-[#C8A951]' : 'text-[#71717a]'}`}>리스트</button>
                  </div>
                </div>
                <button onClick={() => setShowAddAppointment(true)} className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">+ 예약 추가</button>
              </div>

              {/* 달력 뷰 */}
              {calendarView === 'calendar' && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ backgroundColor: '#111113', border: '1px solid #1e1e22', borderRadius: '12px', overflow: 'hidden' }}>
                    {/* 요일 헤더 */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                      {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
                        <div key={d} style={{ textAlign: 'center', padding: '10px 0', fontSize: '12px', fontWeight: 600, borderBottom: '1px solid #1e1e22', color: i === 0 ? '#EF4444' : i === 6 ? '#3B82F6' : '#71717a' }}>{d}</div>
                      ))}
                    </div>
                    {/* 날짜 그리드 */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                      {cells.map((cell, i) => {
                        const dayAppts = apptByDate(cell.dateStr);
                        const isT = cell.dateStr === today;
                        const isSel = cell.dateStr === selectedDate;
                        const isCurrent = cell.month === 'current';
                        const dayOfWeek = i % 7;
                        const dayColor = dayOfWeek === 0 ? '#EF4444' : dayOfWeek === 6 ? '#3B82F6' : '#a1a1aa';
                        return (
                          <div
                            key={cell.dateStr + cell.month}
                            onClick={() => setSelectedDate(isSel ? null : cell.dateStr)}
                            style={{
                              minHeight: '100px',
                              borderBottom: '1px solid rgba(30,30,34,0.4)',
                              borderRight: '1px solid rgba(30,30,34,0.4)',
                              padding: '6px',
                              cursor: 'pointer',
                              backgroundColor: isSel ? 'rgba(200,169,81,0.05)' : 'transparent',
                              opacity: isCurrent ? 1 : 0.3,
                              transition: 'background-color 0.15s',
                            }}
                            onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.backgroundColor = '#1a1a1f'; }}
                            onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            {/* 날짜 숫자 */}
                            <div style={{ marginBottom: '4px' }}>
                              {isT ? (
                                <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#C8A951', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#000' }}>{cell.day}</span>
                                </div>
                              ) : (
                                <div style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <span style={{ fontSize: '12px', fontWeight: 500, color: dayColor }}>{cell.day}</span>
                                </div>
                              )}
                            </div>
                            {/* 예약 바 */}
                            {isCurrent && dayAppts.length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                {dayAppts.slice(0, 3).map((a) => {
                                  const barBg = a.status === '상담중' ? '#71717a' : a.status === '예약확정' ? '#3B82F6' : a.status === '시공중' ? '#C8A951' : '#22C55E';
                                  const isCompleted = a.status === '완료';
                                  const isStart = a.appointment_date === cell.dateStr;
                                  return (
                                    <div key={a.id} style={{ backgroundColor: barBg, borderRadius: '3px', padding: '2px 6px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', opacity: isCompleted ? 0.6 : 1 }}>
                                      <span style={{ fontSize: '10px', fontWeight: 500, color: '#fff' }}>
                                        {isStart
                                          ? `${a.customer?.name || '?'}${a.service_type ? ` · ${a.service_type}` : ''}`
                                          : `→ ${a.customer?.name || '?'}`}
                                      </span>
                                    </div>
                                  );
                                })}
                                {dayAppts.length > 3 && (
                                  <div style={{ fontSize: '10px', color: '#C8A951', fontWeight: 500, paddingLeft: '4px' }}>+{dayAppts.length - 3}건 더보기</div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 선택된 날짜 헤더 */}
                  {selectedDate && (
                    <div style={{ marginTop: '16px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '4px', height: '20px', backgroundColor: '#C8A951', borderRadius: '9999px' }} />
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#fafaf9' }}>
                        {new Date(selectedDate + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}
                      </span>
                      <span style={{ fontSize: '12px', color: '#71717a' }}>{apptByDate(selectedDate).length}건</span>
                    </div>
                  )}
                </div>
              )}

              {/* 예약 카드 리스트 */}
              {(calendarView === 'list' || (calendarView === 'calendar' && selectedDate)) && (
                <div className="space-y-2">
                  {displayAppointments.map((a) => {
                    const isToday = a.appointment_date === today;
                    const isPast = a.appointment_date < today;
                    const borderClass = a.status === '완료' ? 'border-[#1e1e22]' : isToday ? 'border-[#C8A951]/40' : isPast ? 'border-[#EF4444]/20' : 'border-[#1e1e22]';
                    const opacityClass = a.status === '완료' ? 'opacity-50' : isPast && a.status !== '완료' ? 'opacity-60' : '';
                    let memoDisplay = a.memo;
                    try { if (a.memo && JSON.parse(a.memo)?.car_number !== undefined) memoDisplay = null; } catch { /* not JSON */ }

                    return (
                      <div key={a.id} className={`bg-[#111113] border rounded-xl p-4 flex items-center justify-between group ${borderClass} ${opacityClass}`}>
                        <div className="flex items-center gap-4">
                          <div className="text-center min-w-[60px]">
                            <div className={`text-lg font-bold ${isToday ? 'text-[#C8A951]' : 'text-[#fafaf9]'}`}>
                              {new Date(a.appointment_date).getDate()}
                              {a.end_date && a.end_date !== a.appointment_date && (
                                <span className="text-xs font-normal text-[#71717a]">~{new Date(a.end_date).getDate()}</span>
                              )}
                            </div>
                            <div className="text-[10px] text-[#71717a]">
                              {new Date(a.appointment_date).toLocaleDateString('ko-KR', { month: 'short' })}
                              {isToday && <span className="text-[#C8A951] ml-0.5">오늘</span>}
                            </div>
                          </div>
                          <div className="h-10 w-px bg-[#1e1e22]" />
                          <div>
                            <div className="text-sm font-medium text-[#fafaf9]">
                              {a.customer?.name || '(삭제된 고객)'}
                              {a.customer?.phone && <span className="text-[#71717a] ml-2 font-normal">{a.customer.phone}</span>}
                            </div>
                            <div className="text-xs text-[#71717a] mt-0.5">
                              {a.service_type || '미정'}
                              {memoDisplay && <span className="ml-2">· {memoDisplay}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor(a.status)}`}>{a.status}</span>
                          <button onClick={() => handleOpenWorkOrder(a)} className="bg-[#C8A951]/10 hover:bg-[#C8A951]/20 text-[#C8A951] text-xs font-medium rounded-lg px-2.5 py-1 transition-colors">작업 내역서</button>
                          <button onClick={() => handleOpenWarranty(a)} className="bg-[#22c55e]/10 hover:bg-[#22c55e]/20 text-[#22c55e] text-xs font-medium rounded-lg px-2.5 py-1 transition-colors">보증서</button>
                          {a.status !== '완료' && (
                            <select value="" onChange={(e) => { if (e.target.value) handleStatusChange(a, e.target.value); }} className="bg-[#1e1e22] border border-[#2a2a2e] rounded-lg px-2 py-1 text-xs text-[#a1a1aa] outline-none cursor-pointer">
                              <option value="">상태 변경</option>
                              {APPOINTMENT_STATUSES.filter((s) => s !== a.status).map((s) => (<option key={s} value={s}>{s}</option>))}
                            </select>
                          )}
                          <button onClick={() => handleDeleteAppointment(a.id)} className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded flex items-center justify-center text-[#71717a] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-all text-xs" title="삭제">✕</button>
                        </div>
                      </div>
                    );
                  })}
                  {displayAppointments.length === 0 && (
                    <div className="text-center py-12 text-sm text-[#71717a]">
                      {calendarView === 'calendar' && selectedDate ? '이 날짜에 예약이 없습니다' : '등록된 예약이 없습니다'}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ─── TAB: 사후관리 ──────────────────────────────── */}
        {activeTab === 'followups' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              {([
                { key: 'upcoming', label: '예정', count: followUps.filter((f) => !f.is_completed && f.scheduled_date >= today).length },
                { key: 'overdue', label: '지난 알림', count: followUps.filter((f) => !f.is_completed && f.scheduled_date < today).length },
                { key: 'completed', label: '완료', count: followUps.filter((f) => f.is_completed).length },
              ] as const).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFollowUpFilter(f.key)}
                  className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
                    followUpFilter === f.key
                      ? 'bg-[#C8A951]/20 text-[#C8A951]'
                      : 'bg-[#1e1e22] text-[#71717a] hover:text-[#a1a1aa]'
                  }`}
                >
                  {f.label}
                  {f.count > 0 && (
                    <span className={`ml-1.5 text-xs ${
                      followUpFilter === f.key ? 'text-[#C8A951]' : 'text-[#71717a]'
                    }`}>
                      {f.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {filteredFollowUps.map((f) => {
                const phone = f.customer?.phone;
                const smsQC = `안녕하세요, 3M프로이즘입니다 ^^\n시공해드린 차량, 잘 타고 계신가요?\n\n시공 후 2주가 지나 QC 점검 시기가 되어 연락드렸습니다.\n필름이 완전히 안착되는 시기이기도 하고, 혹시 생활하시면서 불편하셨던 부분이 있으시다면 이번에 같이 확인해드리려고 합니다.\n\n편하신 날짜 말씀해주시면 점검 일정 잡아드리겠습니다.\n늘 감사합니다!`;
                const smsMaint = `안녕하세요, 3M프로이즘입니다 ^^\n시공 후 6개월이 되어 메인터넌스 안내드립니다.\n\n필름 상태 점검과 함께 가벼운 외부 세척, 마감 재점검까지 진행해드리고 있습니다.\n오래오래 깔끔하게 유지하실 수 있도록 저희가 꾸준히 관리해드릴게요.\n\n편하신 날짜 말씀해주시면 일정 잡아드리겠습니다.\n항상 감사합니다!`;
                const smsReviewProism = `안녕하세요, 3M프로이즘입니다.\n멋지게 작업이 완료된 차량 사진을 보내드리오니, 소중한 후기 작성 잘 부탁드리겠습니다.\n➊ 아래의 링크 클릭\n➋ 첨부드린 사진으로 후기 작성\n[ 🚩 후기 게시판 링크 ]\nhttps://m.site.naver.com/1S6dj\n고객님의 솔직한 리뷰는 저희에게 아주 큰 힘이 됩니다. 정말 감사드리며, 이후에 이어질 메인터넌스 시기(약 6개월 후)에도 차별화 된 서비스로 다시 또 찾아뵐게요!`;
                const smsReviewBMW = `안녕하세요, 3M프로이즘입니다.\n멋지게 작업이 완료된 차량 사진을 보내드리오니, 소중한 후기 작성 잘 부탁드리겠습니다.\n➊ 아래의 링크 클릭\n➋ 첨부드린 사진으로 후기 작성\n[ 🚩 후기 게시판 링크 ]\nhttps://m.site.naver.com/1S6e3\n고객님의 솔직한 리뷰는 저희에게 아주 큰 힘이 됩니다. 정말 감사드리며, 이후에 이어질 메인터넌스 시기(약 6개월 후)에도 차별화 된 서비스로 다시 또 찾아뵈겠습니다!`;
                const smsReviewAudi = `안녕하세요, 3M프로이즘입니다.\n멋지게 작업이 완료된 차량 사진을 보내드리오니, 소중한 후기 작성 잘 부탁드리겠습니다.\n➊ 아래의 링크 클릭\n➋ 첨부드린 사진으로 후기 작성\n[ 🚩 후기 게시판 링크 ]\nhttps://m.site.naver.com/1S6ej\n고객님의 솔직한 리뷰는 저희에게 아주 큰 힘이 됩니다. 정말 감사드리며, 이후에 이어질 메인터넌스 시기(약 6개월 후)에도 차별화 된 서비스로 다시 또 찾아뵈겠습니다!`;
                const sent = f.sms_sent || {};
                const sendSmsWithTrack = async (msg: string, key: string) => {
                  if (!phone) return;
                  window.open(`sms:${phone}&body=${encodeURIComponent(msg)}`);
                  if (confirm('문자를 전송하셨나요?')) {
                    const updated = { ...sent, [key]: true };
                    await supabase.from('follow_ups').update({ sms_sent: updated }).eq('id', f.id);
                    fetchFollowUps();
                  }
                };
                const badgeClass = f.follow_up_type === 'QC점검'
                  ? 'bg-[#3B82F6]/20 text-[#60A5FA]'
                  : f.follow_up_type === '후기요청'
                    ? 'bg-[#C8A951]/20 text-[#C8A951]'
                    : 'bg-[#8B5CF6]/20 text-[#A78BFA]';
                const sentBtn = 'bg-[#10B981]/15 text-[#34D399]';
                const qcBtn = phone ? (sent.qc ? sentBtn : 'bg-[#3B82F6]/15 text-[#60A5FA] hover:bg-[#3B82F6]/25') : 'bg-[#1e1e22] text-[#71717a]/40 cursor-not-allowed';
                const maintBtn = phone ? (sent.maintenance ? sentBtn : 'bg-[#8B5CF6]/15 text-[#A78BFA] hover:bg-[#8B5CF6]/25') : 'bg-[#1e1e22] text-[#71717a]/40 cursor-not-allowed';
                const reviewBtn = (key: string) => phone ? (sent[key] ? sentBtn : 'bg-[#C8A951]/15 text-[#C8A951] hover:bg-[#C8A951]/25') : 'bg-[#1e1e22] text-[#71717a]/40 cursor-not-allowed';

                return (
                  <div
                    key={f.id}
                    className={`bg-[#111113] border rounded-xl p-4 flex items-center justify-between ${
                      !f.is_completed && f.scheduled_date < today
                        ? 'border-[#EF4444]/30'
                        : f.scheduled_date === today
                          ? 'border-[#C8A951]/30'
                          : 'border-[#1e1e22]'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => handleToggleFollowUp(f)}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${
                          f.is_completed
                            ? 'bg-[#10B981] border-[#10B981] text-white'
                            : 'border-[#71717a] hover:border-[#C8A951]'
                        }`}
                      >
                        {f.is_completed && <span className="text-xs">✓</span>}
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeClass}`}>
                            {f.follow_up_type}
                          </span>
                          <span className="text-sm font-medium text-[#fafaf9]">{f.customer?.name || '-'}</span>
                          <span className="text-xs text-[#71717a]">{f.service?.service_type || ''}</span>
                        </div>
                        <div className="text-xs text-[#71717a] mt-1">
                          {formatDate(f.scheduled_date)}
                          {f.scheduled_date === today && <span className="ml-1 text-[#C8A951]">(오늘)</span>}
                          {!f.is_completed && f.scheduled_date < today && (
                            <span className="ml-1 text-[#EF4444]">(지남)</span>
                          )}
                          {f.memo && <span className="ml-2">· {f.memo}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {f.follow_up_type === 'QC점검' && (
                        <button onClick={() => sendSmsWithTrack(smsQC, 'qc')} disabled={!phone} className={`text-[10px] font-medium px-2 py-1 rounded-lg transition-colors ${qcBtn}`}>{sent.qc ? '✓ QC 전송완료' : 'QC 문자'}</button>
                      )}
                      {f.follow_up_type === '메인터넌스' && (
                        <button onClick={() => sendSmsWithTrack(smsMaint, 'maintenance')} disabled={!phone} className={`text-[10px] font-medium px-2 py-1 rounded-lg transition-colors ${maintBtn}`}>{sent.maintenance ? '✓ 메인터넌스 전송완료' : '메인터넌스 문자'}</button>
                      )}
                      {f.follow_up_type === '후기요청' && (
                        <button onClick={() => sendSmsWithTrack(smsReviewProism, 'proism')} disabled={!phone} className={`text-[10px] font-medium px-2 py-1 rounded-lg transition-colors ${reviewBtn('proism')}`}>{sent.proism ? '✓ 프로이즘 전송완료' : '프로이즘 후기'}</button>
                      )}
                      {f.follow_up_type === '후기요청' && (
                        <button onClick={() => sendSmsWithTrack(smsReviewBMW, 'bmw')} disabled={!phone} className={`text-[10px] font-medium px-2 py-1 rounded-lg transition-colors ${reviewBtn('bmw')}`}>{sent.bmw ? '✓ BMW 전송완료' : 'BMW매니아 후기'}</button>
                      )}
                      {f.follow_up_type === '후기요청' && (
                        <button onClick={() => sendSmsWithTrack(smsReviewAudi, 'audi')} disabled={!phone} className={`text-[10px] font-medium px-2 py-1 rounded-lg transition-colors ${reviewBtn('audi')}`}>{sent.audi ? '✓ 아우디 전송완료' : '아우디매니아 후기'}</button>
                      )}
                    </div>
                  </div>
                );
              })}
              {filteredFollowUps.length === 0 && (
                <div className="text-center py-12 text-sm text-[#71717a]">
                  {followUpFilter === 'upcoming' ? '예정된 사후관리가 없습니다' :
                   followUpFilter === 'overdue' ? '지난 알림이 없습니다' : '완료된 항목이 없습니다'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── TAB: 상담 기록 ──────────────────────────────── */}
        {activeTab === 'consultations' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm text-[#71717a]">{consultations.length}건의 상담</h2>
              <button
                onClick={() => setShowAddConsultation(true)}
                className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
              >
                + 상담 추가
              </button>
            </div>

            <div className="space-y-2">
              {consultations.map((c) => (
                <div key={c.id} className="bg-[#111113] border border-[#1e1e22] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[#fafaf9]">{c.customer?.name || '-'}</span>
                      {c.customer?.phone && <span className="text-xs text-[#71717a]">{c.customer.phone}</span>}
                    </div>
                    <span className="text-xs text-[#71717a]">{formatDate(c.consultation_date)}</span>
                  </div>
                  {c.content && <p className="text-sm text-[#a1a1aa] mb-2">{c.content}</p>}
                  <div className="flex items-center gap-3 text-xs text-[#71717a]">
                    {c.estimate && <span>견적: <span className="text-[#C8A951]">{c.estimate}</span></span>}
                    {c.interested_services && <span>관심: <span className="text-[#a1a1aa]">{c.interested_services}</span></span>}
                    {c.memo && <span>메모: {c.memo}</span>}
                  </div>
                </div>
              ))}
              {consultations.length === 0 && (
                <div className="text-center py-12 text-sm text-[#71717a]">등록된 상담 기록이 없습니다</div>
              )}
            </div>
          </div>
        )}
        {/* ─── TAB: 견적 템플릿 ──────────────────────────────── */}
        {activeTab === 'templates' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {TEMPLATE_KEYS.map((key) => (
              <div key={key} className="bg-[#111113] border border-[#1e1e22] rounded-xl p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-[#C8A951]">{key}</h3>
                  <button
                    onClick={() => handleResetTemplate(key)}
                    className="text-[10px] text-[#71717a] hover:text-[#a1a1aa] transition-colors"
                  >
                    기본값 복원
                  </button>
                </div>
                <textarea
                  value={templates[key] || ''}
                  onChange={(e) => handleTemplateChange(key, e.target.value)}
                  className="flex-1 bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50 resize-y leading-relaxed"
                  style={{ minHeight: '300px' }}
                />
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleCopyTemplate(key)}
                    className={`flex-1 text-sm font-medium rounded-lg px-4 py-2 transition-colors ${
                      copiedKey === key
                        ? 'bg-[#10B981]/20 text-[#34D399]'
                        : 'bg-[#E4002B] hover:bg-[#c60026] text-white'
                    }`}
                  >
                    {copiedKey === key ? '복사 완료!' : '복사하기'}
                  </button>
                  <button
                    onClick={() => handleSaveTemplateImage(key)}
                    className="flex-1 bg-[#C8A951]/10 hover:bg-[#C8A951]/20 text-[#C8A951] text-sm font-medium rounded-lg px-4 py-2 transition-colors"
                  >
                    이미지 저장
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Modal: 고객 추가 ────────────────────────────────── */}
      {showAddCustomer && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => { setShowAddCustomer(false); setEditCustomerId(null); }}>
          <div className="bg-[#111113] border border-[#1e1e22] rounded-xl w-full max-w-lg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[#fafaf9] font-semibold text-base mb-4">{editCustomerId ? '고객 수정' : '고객 추가'}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-[#71717a] mb-1 block">이름 *</label>
                <input type="text" value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="고객 이름" />
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">연락처</label>
                <input type="text" value={customerForm.phone} onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="010-0000-0000" />
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">유입경로</label>
                <input type="text" value={customerForm.source} onChange={(e) => setCustomerForm({ ...customerForm, source: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="네이버, 소개, 인스타 등" />
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">차량 브랜드</label>
                <input type="text" value={customerForm.car_brand} onChange={(e) => setCustomerForm({ ...customerForm, car_brand: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="BMW, 벤츠, 포르쉐 등" />
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">차량 모델</label>
                <input type="text" value={customerForm.car_model} onChange={(e) => setCustomerForm({ ...customerForm, car_model: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="X5, GLE, 카이엔 등" />
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">연식</label>
                <input type="text" value={customerForm.car_year} onChange={(e) => setCustomerForm({ ...customerForm, car_year: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="2024" />
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">색상</label>
                <input type="text" value={customerForm.car_color} onChange={(e) => setCustomerForm({ ...customerForm, car_color: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="블랙, 화이트 등" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-[#71717a] mb-1 block">메모</label>
                <textarea value={customerForm.memo} onChange={(e) => setCustomerForm({ ...customerForm, memo: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50 resize-none h-20" placeholder="특이사항" />
              </div>
              {!editCustomerId && (<>
              <div className="col-span-2 border-t border-[#1e1e22] pt-3 mt-1">
                <div className="text-xs text-[#C8A951] font-medium mb-2">예약 정보 (선택)</div>
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">시공 시작일</label>
                <input type="date" value={customerForm.appointment_start_date} onChange={(e) => setCustomerForm({ ...customerForm, appointment_start_date: e.target.value })} onInput={(e) => setCustomerForm({ ...customerForm, appointment_start_date: (e.target as HTMLInputElement).value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" />
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">시공 종료일</label>
                <input type="date" value={customerForm.appointment_end_date} onChange={(e) => setCustomerForm({ ...customerForm, appointment_end_date: e.target.value })} onInput={(e) => setCustomerForm({ ...customerForm, appointment_end_date: (e.target as HTMLInputElement).value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-[#71717a] mb-1 block">시공 종류</label>
                <select value={customerForm.appointment_service_type} onChange={(e) => setCustomerForm({ ...customerForm, appointment_service_type: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50">
                  <option value="">선택...</option>
                  {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-[#71717a] mb-1 block">예약 메모</label>
                <textarea value={customerForm.appointment_memo} onChange={(e) => setCustomerForm({ ...customerForm, appointment_memo: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50 resize-none h-16" placeholder="예약 관련 메모" />
              </div>
              </>)}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setShowAddCustomer(false); setEditCustomerId(null); }} className="px-4 py-2 text-sm text-[#71717a] hover:text-[#a1a1aa] transition-colors">취소</button>
              <button onClick={editCustomerId ? handleUpdateCustomer : handleAddCustomer} className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">{editCustomerId ? '수정' : '추가'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: 예약 추가 ────────────────────────────────── */}
      {showAddAppointment && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowAddAppointment(false)}>
          <div className="bg-[#111113] border border-[#1e1e22] rounded-xl w-full max-w-lg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[#fafaf9] font-semibold text-base mb-4">예약 추가</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">고객 *</label>
                <CustomerPicker value={appointmentForm.customer_id} onChange={(id) => setAppointmentForm({ ...appointmentForm, customer_id: id })} />
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">시공 시작일 *</label>
                <input type="date" value={appointmentForm.appointment_date} onChange={(e) => setAppointmentForm({ ...appointmentForm, appointment_date: e.target.value })} onInput={(e) => setAppointmentForm({ ...appointmentForm, appointment_date: (e.target as HTMLInputElement).value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" />
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">시공 종료일</label>
                <input type="date" value={appointmentForm.end_date} onChange={(e) => setAppointmentForm({ ...appointmentForm, end_date: e.target.value })} onInput={(e) => setAppointmentForm({ ...appointmentForm, end_date: (e.target as HTMLInputElement).value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" />
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">시공 종류</label>
                <select value={appointmentForm.service_type} onChange={(e) => setAppointmentForm({ ...appointmentForm, service_type: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50">
                  <option value="">선택...</option>
                  {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">메모</label>
                <textarea value={appointmentForm.memo} onChange={(e) => setAppointmentForm({ ...appointmentForm, memo: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50 resize-none h-20" placeholder="메모" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAddAppointment(false)} className="px-4 py-2 text-sm text-[#71717a] hover:text-[#a1a1aa] transition-colors">취소</button>
              <button onClick={handleAddAppointment} className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">추가</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: 상담 추가 ────────────────────────────────── */}
      {showAddConsultation && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowAddConsultation(false)}>
          <div className="bg-[#111113] border border-[#1e1e22] rounded-xl w-full max-w-lg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[#fafaf9] font-semibold text-base mb-4">상담 추가</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">고객 *</label>
                <CustomerPicker value={consultationForm.customer_id} onChange={(id) => setConsultationForm({ ...consultationForm, customer_id: id })} />
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">상담 날짜 *</label>
                <input type="date" value={consultationForm.consultation_date} onChange={(e) => setConsultationForm({ ...consultationForm, consultation_date: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" />
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">상담 내용</label>
                <textarea value={consultationForm.content} onChange={(e) => setConsultationForm({ ...consultationForm, content: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50 resize-none h-24" placeholder="상담 내용을 입력하세요" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#71717a] mb-1 block">견적</label>
                  <input type="text" value={consultationForm.estimate} onChange={(e) => setConsultationForm({ ...consultationForm, estimate: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="예: 350만원" />
                </div>
                <div>
                  <label className="text-xs text-[#71717a] mb-1 block">관심 시공</label>
                  <input type="text" value={consultationForm.interested_services} onChange={(e) => setConsultationForm({ ...consultationForm, interested_services: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="PPF, 썬팅 등" />
                </div>
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">메모</label>
                <input type="text" value={consultationForm.memo} onChange={(e) => setConsultationForm({ ...consultationForm, memo: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="메모" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAddConsultation(false)} className="px-4 py-2 text-sm text-[#71717a] hover:text-[#a1a1aa] transition-colors">취소</button>
              <button onClick={handleAddConsultation} className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">추가</button>
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
      {showWarranty && warrantyAppointment && (
        <WarrantyModal
          warrantyForm={warrantyForm}
          setWarrantyForm={setWarrantyForm}
          onSave={handleSaveWarranty}
          onClose={() => { setShowWarranty(false); setWarrantyAppointment(null); }}
        />
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
      className="flex items-center gap-2 cursor-pointer text-sm text-[#fafaf9] hover:text-[#C8A951] transition-colors select-none"
    >
      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${checked ? 'bg-[#C8A951] border-[#C8A951]' : 'border-[#71717a]'}`}>
        {checked && <span className="text-[10px] text-black font-bold">✓</span>}
      </div>
      <span>{label}</span>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="border-t border-[#1e1e22] pt-4 mt-4">
      <h4 className="text-sm font-semibold text-[#C8A951] mb-3">{title}</h4>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function WorkOrderModal({ appointment, workOrder, setWorkOrder, onSubmit, onSaveOnly, onClose }: WorkOrderModalProps & { workOrder: any }) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePdfSave = async () => {
    if (!printRef.current) return;
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const link = document.createElement('a');
    const customerName = appointment.customer?.name || '고객';
    const dateStr = new Date().toISOString().split('T')[0];
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
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#111113] border border-[#1e1e22] rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-[#111113] border-b border-[#1e1e22] px-6 py-4 flex items-center justify-between z-10">
          <h3 className="text-[#fafaf9] font-semibold text-base">작업 내역서</h3>
          <button onClick={onClose} className="text-[#71717a] hover:text-[#fafaf9] transition-colors text-lg">✕</button>
        </div>

        <div className="p-6 space-y-0">
          {/* 고객 정보 */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label className="text-xs text-[#71717a] mb-1 block">일자</label>
              <div className="bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#a1a1aa]">
                {new Date().toLocaleDateString('ko-KR')}
              </div>
            </div>
            <div>
              <label className="text-xs text-[#71717a] mb-1 block">브랜드/차종</label>
              <div className="bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#a1a1aa]">
                {appointment.service_type || '-'}
              </div>
            </div>
            <div>
              <label className="text-xs text-[#71717a] mb-1 block">차량번호</label>
              <input type="text" value={workOrder.car_number} onChange={(e) => setWorkOrder({ ...workOrder, car_number: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="12가 3456" />
            </div>
            <div>
              <label className="text-xs text-[#71717a] mb-1 block">성명</label>
              <div className="bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#a1a1aa]">
                {customer?.name || '-'}
              </div>
            </div>
            <div>
              <label className="text-xs text-[#71717a] mb-1 block">유입경로</label>
              <div className="bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#a1a1aa]">-</div>
            </div>
            <div>
              <label className="text-xs text-[#71717a] mb-1 block">연락처</label>
              <div className="bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#a1a1aa]">
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
              <div key={brand} className="bg-[#0d0d0f] border border-[#1e1e22] rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-[#a1a1aa]">{label}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-[#71717a]">농도:</span>
                    <input type="text" value={workOrder.tinting[brand].density} onChange={(e) => setTintingDensity(brand, e.target.value)} className="w-40 bg-[#111113] border border-[#1e1e22] rounded px-2 py-1 text-xs text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="전면 30 / 측후면 15" />
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
            <div className="bg-[#0d0d0f] border border-[#1e1e22] rounded-lg p-3">
              <span className="text-xs font-medium text-[#a1a1aa] mb-2 block">PPF</span>
              <div className="flex flex-wrap gap-3 mb-2">
                {['전체PPF', '프론트패키지', '생활보호패키지'].map((p) => (
                  <CheckItem key={p} label={p} checked={workOrder.ppf.includes(p)} onChange={() => setWorkOrder({ ...workOrder, ppf: toggleArray(workOrder.ppf, p) })} />
                ))}
              </div>
              <input type="text" value={workOrder.ppf_etc} onChange={(e) => setWorkOrder({ ...workOrder, ppf_etc: e.target.value })} className="w-full bg-[#111113] border border-[#1e1e22] rounded px-2 py-1 text-xs text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="기타 (직접 입력)" />
            </div>
            <div className="bg-[#0d0d0f] border border-[#1e1e22] rounded-lg p-3">
              <span className="text-xs font-medium text-[#a1a1aa] mb-2 block">랩핑</span>
              <div className="flex flex-wrap gap-3 mb-2">
                {['전체랩핑', '부분'].map((p) => (
                  <CheckItem key={p} label={p} checked={workOrder.wrapping.includes(p)} onChange={() => setWorkOrder({ ...workOrder, wrapping: toggleArray(workOrder.wrapping, p) })} />
                ))}
              </div>
              <input type="text" value={workOrder.wrapping_etc} onChange={(e) => setWorkOrder({ ...workOrder, wrapping_etc: e.target.value })} className="w-full bg-[#111113] border border-[#1e1e22] rounded px-2 py-1 text-xs text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="기타 (직접 입력)" />
            </div>
          </div>

          {/* 코팅 */}
          <SectionTitle title="코팅시공" />
          <div className="bg-[#0d0d0f] border border-[#1e1e22] rounded-lg p-3">
            <div className="flex flex-wrap gap-3">
              {['기본유리막', '9H', '10H', '그래핀PRO', '가죽코팅(시트)', '가죽코팅(전체)', '발수코팅', '필름코팅'].map((p) => (
                <CheckItem key={p} label={p} checked={workOrder.coating.includes(p)} onChange={() => setWorkOrder({ ...workOrder, coating: toggleArray(workOrder.coating, p) })} />
              ))}
            </div>
          </div>

          {/* 기타 */}
          <SectionTitle title="기타" />
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#0d0d0f] border border-[#1e1e22] rounded-lg p-3">
              <span className="text-xs font-medium text-[#a1a1aa] mb-2 block">전장시공</span>
              <div className="flex flex-wrap gap-3 mb-2">
                {['블랙박스', '하이패스'].map((p) => (
                  <CheckItem key={p} label={p} checked={workOrder.electrical.includes(p)} onChange={() => setWorkOrder({ ...workOrder, electrical: toggleArray(workOrder.electrical, p) })} />
                ))}
              </div>
              <input type="text" value={workOrder.electrical_etc} onChange={(e) => setWorkOrder({ ...workOrder, electrical_etc: e.target.value })} className="w-full bg-[#111113] border border-[#1e1e22] rounded px-2 py-1 text-xs text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="기타 (직접 입력)" />
            </div>
            <div className="bg-[#0d0d0f] border border-[#1e1e22] rounded-lg p-3">
              <span className="text-xs font-medium text-[#a1a1aa] mb-2 block">프리미엄광택</span>
              <div className="flex flex-wrap gap-3 mb-2">
                {['전체광택', '부분광택'].map((p) => (
                  <CheckItem key={p} label={p} checked={workOrder.polish.includes(p)} onChange={() => setWorkOrder({ ...workOrder, polish: toggleArray(workOrder.polish, p) })} />
                ))}
              </div>
              <input type="text" value={workOrder.polish_etc} onChange={(e) => setWorkOrder({ ...workOrder, polish_etc: e.target.value })} className="w-full bg-[#111113] border border-[#1e1e22] rounded px-2 py-1 text-xs text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="기타 (직접 입력)" />
            </div>
          </div>

          {/* 신차패키지 옵션 */}
          <SectionTitle title="신차패키지 옵션" />
          <div className="bg-[#0d0d0f] border border-[#1e1e22] rounded-lg p-3">
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
            className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50 resize-none h-24"
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
            <div style={{ display: 'flex', gap: '24px', marginBottom: '12px', fontSize: '12px' }}>
              <span>{workOrder.warranty_issued ? '☑' : '☐'} 보증서 발행 유무</span>
              <span>{workOrder.crm_recorded ? '☑' : '☐'} CRM 기재 유무</span>
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
                        <span key={item} style={{ marginRight: '12px' }}>
                          {workOrder.tinting[row.brand]?.selected?.includes(item) ? '☑' : '☐'} {item}
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
                    {['전체PPF', '프론트패키지', '생활보호패키지'].map((p) => <span key={p} style={{ marginRight: '12px' }}>{workOrder.ppf?.includes(p) ? '☑' : '☐'} {p}</span>)}
                    {workOrder.ppf_etc && <span>기타: {workOrder.ppf_etc}</span>}
                  </td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>랩핑</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
                    {['전체랩핑', '부분'].map((p) => <span key={p} style={{ marginRight: '12px' }}>{workOrder.wrapping?.includes(p) ? '☑' : '☐'} {p}</span>)}
                    {workOrder.wrapping_etc && <span>기타: {workOrder.wrapping_etc}</span>}
                  </td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>코팅시공</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
                    {['기본유리막', '9H', '10H', '그래핀PRO', '가죽코팅(시트)', '가죽코팅(전체)', '발수코팅', '필름코팅'].map((p) => <span key={p} style={{ marginRight: '12px' }}>{workOrder.coating?.includes(p) ? '☑' : '☐'} {p}</span>)}
                  </td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>전장시공</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
                    {['블랙박스', '하이패스'].map((p) => <span key={p} style={{ marginRight: '12px' }}>{workOrder.electrical?.includes(p) ? '☑' : '☐'} {p}</span>)}
                    {workOrder.electrical_etc && <span>기타: {workOrder.electrical_etc}</span>}
                  </td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>프리미엄광택</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
                    {['전체광택', '부분광택'].map((p) => <span key={p} style={{ marginRight: '12px' }}>{workOrder.polish?.includes(p) ? '☑' : '☐'} {p}</span>)}
                    {workOrder.polish_etc && <span>기타: {workOrder.polish_etc}</span>}
                  </td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>신차패키지</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
                    {['신차검수', '내외부디테일링세차', '타이어왁스', '피톤치드연막'].map((p) => <span key={p} style={{ marginRight: '12px' }}>{workOrder.package_options?.includes(p) ? '☑' : '☐'} {p}</span>)}
                  </td>
                </tr>
              </tbody>
            </table>
            {/* 특이사항 */}
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px', borderBottom: '2px solid #E4002B', paddingBottom: '4px' }}>특이사항 및 비고</div>
            <div style={{ border: '1px solid #ccc', padding: '12px', minHeight: '60px', whiteSpace: 'pre-wrap', fontSize: '12px' }}>{workOrder.notes || ''}</div>
            {/* 하단 */}
            <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '10px', color: '#888' }}>
              서울특별시 서초구 서초중앙로8길 82 1동 1층 1호 | 3M 프로이즘 | 3M 공식 프리퍼드 인스톨러
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-[#111113] border-t border-[#1e1e22] px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#71717a] hover:text-[#a1a1aa] transition-colors">취소</button>
          <button onClick={handlePdfSave} className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-sm font-medium rounded-lg px-5 py-2 transition-colors">PDF 저장</button>
          <button onClick={onSaveOnly} className="bg-[#1e1e22] hover:bg-[#2a2a2e] text-[#a1a1aa] text-sm font-medium rounded-lg px-5 py-2 transition-colors border border-[#2a2a2e]">저장만 하기</button>
          <button onClick={onSubmit} className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-6 py-2 transition-colors">시공 완료 처리</button>
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
  onClose: () => void;
}

function WarrantyModal({ warrantyForm, setWarrantyForm, onSave, onClose }: WarrantyModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const handleDownloadPng = async () => {
    await onSave();
    if (!printRef.current) return;
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    link.download = `프로이즘_시공보증서_${warrantyForm.customer_name || '고객'}_${dateStr}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const inputClass = 'w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#22c55e]/50';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#111113] border border-[#1e1e22] rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[#1e1e22]">
          <h3 className="text-[#fafaf9] font-semibold text-base">시공 보증서 발급</h3>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#71717a] mb-1 block">일자</label>
              <input type="date" value={warrantyForm.date} onChange={(e) => setWarrantyForm({ ...warrantyForm, date: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-[#71717a] mb-1 block">차종</label>
              <input type="text" value={warrantyForm.car_type} onChange={(e) => setWarrantyForm({ ...warrantyForm, car_type: e.target.value })} className={inputClass} placeholder="BMW X5 등" />
            </div>
            <div>
              <label className="text-xs text-[#71717a] mb-1 block">차량번호</label>
              <input type="text" value={warrantyForm.car_number} onChange={(e) => setWarrantyForm({ ...warrantyForm, car_number: e.target.value })} className={inputClass} placeholder="12가 3456" />
            </div>
            <div>
              <label className="text-xs text-[#71717a] mb-1 block">성명</label>
              <input type="text" value={warrantyForm.customer_name} onChange={(e) => setWarrantyForm({ ...warrantyForm, customer_name: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-[#71717a] mb-1 block">연락처</label>
              <input type="text" value={warrantyForm.phone} onChange={(e) => setWarrantyForm({ ...warrantyForm, phone: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-[#71717a] mb-1 block">보증기간</label>
              <input type="text" value={warrantyForm.warranty_period} onChange={(e) => setWarrantyForm({ ...warrantyForm, warranty_period: e.target.value })} className={inputClass} placeholder="시공일로부터 1년" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-[#71717a] mb-1 block">정상가 금액</label>
              <input type="text" value={warrantyForm.price} onChange={(e) => setWarrantyForm({ ...warrantyForm, price: e.target.value })} className={inputClass} placeholder="₩1,000,000" />
            </div>
          </div>
          <div>
            <label className="text-xs text-[#71717a] mb-1 block">시공 내역</label>
            <textarea value={warrantyForm.work_details} onChange={(e) => setWarrantyForm({ ...warrantyForm, work_details: e.target.value })} className={`${inputClass} resize-none h-28`} placeholder={'그릴 랩핑 (3M 2080 글로스 블랙) ₩400,000\n루프 랩핑 (3M 2080 새틴 블랙) ₩600,000'} />
          </div>
        </div>

        {/* Hidden print area */}
        <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
          <div ref={printRef} style={{ width: '800px', padding: '48px', backgroundColor: '#ffffff', fontFamily: 'sans-serif', color: '#111' }}>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <div style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '8px' }}>시공내역서</div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
              <tbody>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '8px 12px', backgroundColor: '#f5f5f5', fontWeight: 600, width: '120px', fontSize: '13px' }}>일자</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px 12px', fontSize: '13px' }}>{warrantyForm.date}</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px 12px', backgroundColor: '#f5f5f5', fontWeight: 600, width: '120px', fontSize: '13px' }}>차종</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px 12px', fontSize: '13px' }}>{warrantyForm.car_type}</td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '8px 12px', backgroundColor: '#f5f5f5', fontWeight: 600, fontSize: '13px' }}>차량번호</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px 12px', fontSize: '13px' }}>{warrantyForm.car_number}</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px 12px', backgroundColor: '#f5f5f5', fontWeight: 600, fontSize: '13px' }}>성명</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px 12px', fontSize: '13px' }}>{warrantyForm.customer_name}</td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #ccc', padding: '8px 12px', backgroundColor: '#f5f5f5', fontWeight: 600, fontSize: '13px' }}>연락처</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px 12px', fontSize: '13px' }}>{warrantyForm.phone}</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px 12px', backgroundColor: '#f5f5f5', fontWeight: 600, fontSize: '13px' }}>보증기간</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px 12px', fontSize: '13px' }}>{warrantyForm.warranty_period}</td>
                </tr>
              </tbody>
            </table>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
              <thead>
                <tr>
                  <th style={{ border: '1px solid #ccc', padding: '8px 12px', backgroundColor: '#f5f5f5', textAlign: 'left', fontSize: '13px' }}>시공 내역</th>
                  <th style={{ border: '1px solid #ccc', padding: '8px 12px', backgroundColor: '#f5f5f5', textAlign: 'right', fontSize: '13px', width: '160px' }}>금액</th>
                </tr>
              </thead>
              <tbody>
                {warrantyForm.work_details.split('\n').filter(Boolean).map((line, i) => {
                  const priceMatch = line.match(/(₩[\d,]+|[\d,]+원)/);
                  const detail = priceMatch ? line.replace(priceMatch[0], '').trim() : line.trim();
                  const amount = priceMatch ? priceMatch[0] : '';
                  return (
                    <tr key={i}>
                      <td style={{ border: '1px solid #ccc', padding: '8px 12px', fontSize: '13px' }}>{detail}</td>
                      <td style={{ border: '1px solid #ccc', padding: '8px 12px', fontSize: '13px', textAlign: 'right' }}>{amount}</td>
                    </tr>
                  );
                })}
                {warrantyForm.price && (
                  <tr>
                    <td style={{ border: '1px solid #ccc', padding: '8px 12px', fontSize: '13px', fontWeight: 700, textAlign: 'right' }}>정상가</td>
                    <td style={{ border: '1px solid #ccc', padding: '8px 12px', fontSize: '13px', fontWeight: 700, textAlign: 'right' }}>{warrantyForm.price}</td>
                  </tr>
                )}
              </tbody>
            </table>

            <div style={{ backgroundColor: '#f9f9f9', border: '1px solid #ddd', borderRadius: '6px', padding: '16px', marginBottom: '20px', fontSize: '11.5px', lineHeight: '1.8', color: '#444' }}>
              <div style={{ fontWeight: 700, marginBottom: '6px', color: '#222' }}>[건적서 발행 참고 내용]</div>
              <div>- 수정은 이슈에 따라 담당자의 판단에 즉각 진행 가능하다.</div>
              <div>- 견적표에 없는 시공항목들은 시공내역서 참고 및 작업담당자의 피드백을 받아 시공내역서를 발행한다.</div>
              <div>- 시공내역서에 있는 견적보다는 정가 견적으로 내역서를 발행한다.</div>
              <div>- 서비스시공은 내역에서 제외된다</div>
            </div>

            <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '16px', marginBottom: '24px', fontSize: '12px', lineHeight: '1.9', color: '#166534' }}>
              <div style={{ fontWeight: 700, marginBottom: '6px' }}>[기본멘트]</div>
              <div>고객과 차량관리의 연결고리, 카넥트입니다.</div>
              <div>작업이 완료된 차량의 &apos;시공내역서&apos; 및 &apos;보증서&apos;를 송부드립니다.</div>
              <div>시공 후 문의 및 A/S 관련 사항은 010-5716-6009으로 연락을 주시면 담당자가 친절하게 응대하도록 하겠습니다.</div>
              <div>플러스 가득한 하루 보내시기 바라며, 다시 한번 저희를 믿고 맡겨주셔서 감사드립니다.</div>
            </div>

            <div style={{ textAlign: 'center', fontSize: '12px', color: '#888', borderTop: '1px solid #ddd', paddingTop: '16px' }}>
              3M 프로이즘 | 서초동 1604-7 1층
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-[#111113] border-t border-[#1e1e22] px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#71717a] hover:text-[#a1a1aa] transition-colors">취소</button>
          <button onClick={async () => { await onSave(); onClose(); }} className="bg-[#1e1e22] hover:bg-[#2a2a2e] text-[#a1a1aa] text-sm font-medium rounded-lg px-5 py-2 transition-colors border border-[#2a2a2e]">저장만 하기</button>
          <button onClick={handleDownloadPng} className="bg-[#22c55e] hover:bg-[#16a34a] text-white text-sm font-medium rounded-lg px-5 py-2 transition-colors">PNG 다운로드</button>
        </div>
      </div>
    </div>
  );
}
