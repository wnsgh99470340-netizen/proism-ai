'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/components/ThemeProvider';

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

type Tab = 'customers' | 'appointments' | 'followups' | 'consultations' | 'stats' | 'inventory' | 'templates';

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
3. 제품보증과 시공보증 2중발급 시스템으로 확실한 사후관리가 가능합니다.

[입금 안내]
KB국민은행 77501-04-276096 (브레이브보이즈)`,
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
3. 제품보증과 시공보증 2중발급 시스템으로 확실한 사후관리가 가능합니다.

[입금 안내]
KB국민은행 77501-04-276096 (브레이브보이즈)`,
  '신차패키지': `안녕하세요? 3M 프로이즘 입니다.
문의주신 견적 안내드리며, 자세한 내용과 서비스 혜택 안내드립니다.

사전예약 시 다음 무상시공 혜택을 드립니다.
[무상시공] 실내PPF [ T존 ]
[무상시공] B/C필러 PPF
[무상시공] 유리막코팅 업그레이드 (2layering)
[옵션시공] PPF / 랩핑 / 루프스킨 / 크롬딜리트 / 투톤PPF

[참고 해주세요]
1. 신차계약 후 탁송지 지정은 3M 프로이즘으로 해주세요 [서울시 서초구 서초중앙로8길 82, 1동 1층 1호 3M 프로이즘]
2. 차량도착 후 정비자격증소지자의 섬세한 검수가 이뤄집니다. [도막/열화상/진단기/스코프/공기압/배터리진단기 사용] 6SET 첨단장비 사용
3. 인수인계 여부 및 이슈발생 시, 해결방안 피드백까지 전달드립니다.

[입금 안내]
KB국민은행 77501-04-276096 (브레이브보이즈)`,
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
3. 제품보증과 시공보증 2중발급 시스템으로 확실한 사후관리가 가능합니다.

[입금 안내]
KB국민은행 77501-04-276096 (브레이브보이즈)`,
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
    case '상담중': return 'bg-[#71717a]/20 text-[var(--c-text-2)]';
    case '예약확정': return 'bg-[#3B82F6]/20 text-[#60A5FA]';
    case '시공중': return 'bg-[#F59E0B]/20 text-[#FBBF24]';
    case '완료': return 'bg-[#10B981]/20 text-[#34D399]';
    default: return 'bg-[#71717a]/20 text-[var(--c-text-2)]';
  }
}

// ─── Main Page ───────────────────────────────────────────
export default function CRMPage() {
  const router = useRouter();
  const { theme, toggle: toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>('customers');

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
  const [managerFilter, setManagerFilter] = useState<'전체' | '대표' | '이팀장님' | '김막내'>('전체');
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Follow-up state
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [followUpFilter, setFollowUpFilter] = useState<'all' | 'QC점검' | '메인터넌스' | '후기요청'>('all');

  // Consultation state
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [showAddConsultation, setShowAddConsultation] = useState(false);
  const [consultationForm, setConsultationForm] = useState({
    customer_id: '', consultation_date: '', content: '', estimate: '', interested_services: '', memo: '',
  });

  // Stats state
  const [statsYear, setStatsYear] = useState(() => new Date().getFullYear().toString());
  const [statsData, setStatsData] = useState<{
    totalCount: number; totalRevenue: number; avgPerCase: number;
    byService: { name: string; count: number; revenue: number }[];
    byMonth: { month: string; count: number; revenue: number; change: number | null }[];
    quarters: { label: string; count: number; revenue: number }[];
    carAnalysis: { car: string; totalCount: number; totalRevenue: number; services: { name: string; count: number; revenue: number }[] }[];
    sourceAnalysis: { source: string; customerCount: number; serviceCount: number; revenue: number; avgPerCustomer: number }[];
    weekDays: { label: string; date: string; total: number; boss: number; team: number }[];
    monthWorkload: { month: string; total: number; dailyAvg: number };
  } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Inventory state
  const [inventory, setInventory] = useState<{ id: string; name: string; quantity: number; unit: string; min_stock: number; memo: string | null }[]>([]);
  const [inventoryForm, setInventoryForm] = useState({ name: '', quantity: '', unit: '롤', min_stock: '', memo: '' });
  const [editInventoryId, setEditInventoryId] = useState<string | null>(null);

  // Salary settings (localStorage)
  const [salaryBoss, setSalaryBoss] = useState('');
  const [salaryTeam, setSalaryTeam] = useState('');
  const [salaryJunior, setSalaryJunior] = useState('');

  // Estimate state
  const [estimateForm, setEstimateForm] = useState({
    customer_id: '', services: [] as string[], serviceDetails: {} as Record<string, string>, amount: '', scheduledDate: '', memo: '',
  });
  const [estimateUrl, setEstimateUrl] = useState<string | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);

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
  const [allCustomers, setAllCustomers] = useState<{ id: string; name: string; phone: string | null; car_brand?: string | null; car_model?: string | null }[]>([]);
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
    const { data } = await supabase.from('customers').select('id, name, phone, car_brand, car_model').order('name');
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

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch(`/api/analytics?year=${statsYear}`);
      if (res.ok) setStatsData(await res.json());
    } catch (e) { console.warn('[CRM] 통계 로드 실패:', e); }
    setStatsLoading(false);
  }, [statsYear]);

  const fetchInventory = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory');
      if (res.ok) setInventory(await res.json());
    } catch { /* ignore */ }
  }, []);

  // 인건비 설정 로드
  useEffect(() => {
    setSalaryBoss(localStorage.getItem('salary_boss') || '');
    setSalaryTeam(localStorage.getItem('salary_team') || '');
    setSalaryJunior(localStorage.getItem('salary_junior') || '');
  }, []);

  useEffect(() => {
    if (activeTab === 'customers') fetchCustomers();
    else if (activeTab === 'appointments') fetchAppointments();
    else if (activeTab === 'followups') fetchFollowUps();
    else if (activeTab === 'consultations') fetchConsultations();
    else if (activeTab === 'stats') fetchStats();
    else if (activeTab === 'inventory') fetchInventory();
  }, [activeTab, fetchCustomers, fetchAppointments, fetchFollowUps, fetchConsultations, fetchStats, fetchInventory]);

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
    const endNext = new Date(endDate);
    endNext.setDate(endNext.getDate() + 1);
    const end = endNext.toISOString().split('T')[0].replace(/-/g, '');
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
    const completionDate = new Date().toISOString().split('T')[0];

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
        const qcDate = new Date(completionDate);
        qcDate.setDate(qcDate.getDate() + 14);
        const qcDateStr = qcDate.toISOString().split('T')[0];
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
        const mtDate = new Date(completionDate);
        mtDate.setMonth(mtDate.getMonth() + 6);
        const mtDateStr = mtDate.toISOString().split('T')[0];
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
        date: appointment.appointment_date || new Date().toISOString().split('T')[0],
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
        date: new Date().toISOString().split('T')[0],
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
        completed_date: newCompleted ? new Date().toISOString().split('T')[0] : null,
      })
      .eq('id', followUp.id);
    fetchFollowUps();
  };

  const today = new Date().toISOString().split('T')[0];
  const filteredFollowUps = followUps
    .filter((f) => {
      if (followUpFilter === 'all') return true;
      return f.follow_up_type === followUpFilter;
    })
    .sort((a, b) => {
      // 미처리 우선, 그 안에서 날짜 임박순
      if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
      return a.scheduled_date.localeCompare(b.scheduled_date);
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
          className="w-full text-left bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] hover:border-[#C8A951]/50 transition-colors"
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
                className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded px-2 py-1.5 text-xs text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50"
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

  // ─── Render ─────────────────────────────────────────────
  const tabs: { key: Tab; label: string }[] = [
    { key: 'customers', label: '고객 목록' },
    { key: 'appointments', label: '예약/일정' },
    { key: 'followups', label: '사후관리' },
    { key: 'consultations', label: '상담 기록' },
    { key: 'stats', label: '매출 대시보드' },
    { key: 'inventory', label: '재고 관리' },
    { key: 'templates', label: '견적 템플릿' },
  ];

  return (
    <div className="h-screen flex flex-col bg-[var(--c-page)]">
      {/* Header */}
      <div className="h-14 border-b border-[var(--c-border)] bg-[var(--c-card)] flex items-center px-4 justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="text-[#E4002B] text-lg font-bold">◆</span>
            <span className="text-[var(--c-text-1)] font-semibold text-sm">3M 프로이즘 AI</span>
          </Link>
          <span className="text-[var(--c-border)]">|</span>
          <span className="text-[#C8A951] text-sm font-medium">고객 관리 CRM</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="w-7 h-7 rounded-full bg-[var(--c-subtle)] flex items-center justify-center hover:bg-[var(--c-hover)] transition-colors text-sm"
            title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
          >
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
          <Link
            href="/"
            className="text-xs text-[var(--c-text-3)] hover:text-[var(--c-text-1)] transition-colors bg-[var(--c-subtle)] hover:bg-[var(--c-hover)] rounded-lg px-3 py-1.5"
          >
            블로그 에이전트로 돌아가기
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[var(--c-border)] bg-[var(--c-card)] px-4 flex gap-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-3 text-sm font-medium transition-colors relative ${
              activeTab === tab.key
                ? 'text-[#C8A951]'
                : 'text-[var(--c-text-3)] hover:text-[var(--c-text-2)]'
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
                  className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] w-64 outline-none focus:border-[#C8A951]/50 transition-colors placeholder:text-[var(--c-text-3)]"
                />
                <span className="text-xs text-[var(--c-text-3)]">{filteredCustomers.length}명</span>
              </div>
              <button
                onClick={() => { setEditCustomerId(null); setCustomerForm({ name: '', phone: '', car_brand: '', car_model: '', car_year: '', car_color: '', source: '', memo: '', appointment_start_date: '', appointment_end_date: '', appointment_service_type: '', appointment_amount: '', appointment_memo: '' }); setShowAddCustomer(true); }}
                className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
              >
                + 고객 추가
              </button>
            </div>

            <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
              <table className="w-full">
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
                      className="border-b border-[var(--c-border)] last:border-b-0 hover:bg-[#1a1a1f] cursor-pointer transition-colors group"
                    >
                      <td className="px-4 py-3 text-sm text-[var(--c-text-1)] font-medium">
                        {c.name}
                        {c.service_count >= 2 && <span className="ml-1.5 text-[9px] bg-[#C8A951]/20 text-[#C8A951] px-1.5 py-0.5 rounded-full font-medium">재방문</span>}
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
                            className="w-6 h-6 rounded flex items-center justify-center text-[var(--c-text-3)] hover:text-[#C8A951] hover:bg-[#C8A951]/10 transition-all text-xs"
                            title="수정"
                          >✎</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteCustomer(c.id, c.name); }}
                            className="w-6 h-6 rounded flex items-center justify-center text-[var(--c-text-3)] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-all text-xs"
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

          const statusBarColor = (status: string) => {
            switch (status) {
              case '상담중': return 'bg-[#71717a]';
              case '예약확정': return 'bg-[#3B82F6]';
              case '시공중': return 'bg-[#C8A951]';
              case '완료': return 'bg-[#22C55E]';
              default: return 'bg-[#71717a]';
            }
          };

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
          const weekEndStr = weekEnd.toISOString().split('T')[0];
          const weekCount = appointments.filter((a) => a.appointment_date >= today && a.appointment_date <= weekEndStr && a.status !== '완료').length;

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
                  <button onClick={() => setCalendarMonth((p) => { const d = new Date(p.year, p.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })} className="text-[var(--c-text-3)] hover:text-[var(--c-text-1)] transition-colors text-lg leading-none">◀</button>
                  <span className="text-base font-semibold text-[var(--c-text-1)] min-w-[120px] text-center">{cY}년 {cM + 1}월</span>
                  <button onClick={() => setCalendarMonth((p) => { const d = new Date(p.year, p.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })} className="text-[var(--c-text-3)] hover:text-[var(--c-text-1)] transition-colors text-lg leading-none">▶</button>
                  <button onClick={goToday} className="text-xs bg-[var(--c-subtle)] hover:bg-[var(--c-hover)] text-[var(--c-text-2)] rounded-lg px-3 py-1 transition-colors ml-1">오늘</button>
                  <div className="flex bg-[var(--c-subtle)] rounded-lg p-0.5 ml-2">
                    <button onClick={() => setCalendarView('calendar')} className={`text-xs px-3 py-1 rounded-md transition-colors ${calendarView === 'calendar' ? 'bg-[#C8A951]/20 text-[#C8A951]' : 'text-[var(--c-text-3)]'}`}>달력</button>
                    <button onClick={() => setCalendarView('list')} className={`text-xs px-3 py-1 rounded-md transition-colors ${calendarView === 'list' ? 'bg-[#C8A951]/20 text-[#C8A951]' : 'text-[var(--c-text-3)]'}`}>리스트</button>
                  </div>
                  <div className="flex bg-[var(--c-subtle)] rounded-lg p-0.5 ml-2">
                    {(['전체', '대표', '이팀장님', '김막내'] as const).map((m) => (
                      <button key={m} onClick={() => setManagerFilter(m)} className={`text-xs px-3 py-1 rounded-md transition-colors ${managerFilter === m ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-[var(--c-text-3)]'}`}>{m}</button>
                    ))}
                  </div>
                  <div className="flex gap-2 ml-3">
                    <span className="text-[10px] bg-[#C8A951]/10 text-[#C8A951] px-2 py-1 rounded">오늘 {todayCount}건</span>
                    <span className="text-[10px] bg-[#3B82F6]/10 text-[#3B82F6] px-2 py-1 rounded">이번주 {weekCount}건</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowCalendarSub(true)} className="bg-[#3B82F6]/10 hover:bg-[#3B82F6]/20 text-[#3B82F6] text-sm font-medium rounded-lg px-3 py-2 transition-colors">캘린더 구독</button>
                  <button onClick={() => setShowAddAppointment(true)} className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">+ 예약 추가</button>
                </div>
              </div>

              {/* 달력 뷰 */}
              {calendarView === 'calendar' && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: '12px', overflow: 'hidden' }}>
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
                    const borderClass = a.status === '완료' ? 'border-[var(--c-border)]' : isToday ? 'border-[#C8A951]/40' : isPast ? 'border-[#EF4444]/20' : 'border-[var(--c-border)]';
                    const opacityClass = a.status === '완료' ? 'opacity-50' : isPast && a.status !== '완료' ? 'opacity-60' : '';
                    let memoDisplay = a.memo;
                    try { if (a.memo && JSON.parse(a.memo)?.car_number !== undefined) memoDisplay = null; } catch { /* not JSON */ }

                    return (
                      <div key={a.id} className={`bg-[var(--c-card)] border rounded-xl p-4 flex items-center justify-between group ${borderClass} ${opacityClass}`}>
                        <div className="flex items-center gap-4">
                          <div className="text-center min-w-[60px]">
                            <div className={`text-lg font-bold ${isToday ? 'text-[#C8A951]' : 'text-[var(--c-text-1)]'}`}>
                              {new Date(a.appointment_date).getDate()}
                              {a.end_date && a.end_date !== a.appointment_date && (
                                <span className="text-xs font-normal text-[var(--c-text-3)]">~{new Date(a.end_date).getDate()}</span>
                              )}
                            </div>
                            <div className="text-[10px] text-[var(--c-text-3)]">
                              {new Date(a.appointment_date).toLocaleDateString('ko-KR', { month: 'short' })}
                              {isToday && <span className="text-[#C8A951] ml-0.5">오늘</span>}
                            </div>
                          </div>
                          <div className="h-10 w-px bg-[var(--c-subtle)]" />
                          <div>
                            <div className="text-sm font-medium text-[var(--c-text-1)]">
                              {a.customer?.name || '(삭제된 고객)'}
                              {a.customer?.phone && <span className="text-[var(--c-text-3)] ml-2 font-normal">{a.customer.phone}</span>}
                            </div>
                            <div className="text-xs text-[var(--c-text-3)] mt-0.5">
                              {a.service_type || '미정'}
                              <span className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded ${getManager(a) === '이팀장님' ? 'bg-[#22C55E]/15 text-[#22C55E]' : getManager(a) === '김막내' ? 'bg-[#A78BFA]/15 text-[#A78BFA]' : 'bg-[#3B82F6]/15 text-[#3B82F6]'}`}>{getManager(a)}</span>
                              {a.amount ? <span className="ml-2 text-[#C8A951]">{a.amount.toLocaleString()}원</span> : null}
                              {memoDisplay && <span className="ml-2">· {memoDisplay}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor(a.status)}`}>{a.status}</span>
                          <button onClick={() => handleOpenWorkOrder(a)} className="bg-[#C8A951]/10 hover:bg-[#C8A951]/20 text-[#C8A951] text-xs font-medium rounded-lg px-2.5 py-1 transition-colors">작업 내역서</button>
                          <button onClick={() => handleOpenWarranty(a)} className={`text-xs font-medium rounded-lg px-2.5 py-1 transition-colors ${hasWarrantyIssued(a.memo) ? 'bg-[#22c55e] text-white' : 'bg-[#22c55e]/10 hover:bg-[#22c55e]/20 text-[#22c55e]'}`}>{hasWarrantyIssued(a.memo) ? '✓ 보증서 발급완료' : '보증서'}</button>
                          {(() => { try { const m = JSON.parse(a.memo || '{}'); if (m.warranty_url) return <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(m.warranty_url); alert('보증서 URL이 복사되었습니다.'); }} className="text-[10px] font-medium px-2 py-1 rounded-lg bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors">URL 복사</button>; } catch {} return null; })()}
                          <button onClick={() => handleDownloadICS(a)} className="bg-[#3B82F6]/10 hover:bg-[#3B82F6]/20 text-[#3B82F6] text-xs font-medium rounded-lg px-2.5 py-1 transition-colors">캘린더</button>
                          {a.status !== '완료' && (
                            <select value="" onChange={(e) => { if (e.target.value) handleStatusChange(a, e.target.value); }} className="bg-[var(--c-subtle)] border border-[#2a2a2e] rounded-lg px-2 py-1 text-xs text-[var(--c-text-2)] outline-none cursor-pointer">
                              <option value="">상태 변경</option>
                              {APPOINTMENT_STATUSES.filter((s) => s !== a.status).map((s) => (<option key={s} value={s}>{s}</option>))}
                            </select>
                          )}
                          <button onClick={() => handleDeleteAppointment(a.id)} className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded flex items-center justify-center text-[var(--c-text-3)] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-all text-xs" title="삭제">✕</button>
                        </div>
                      </div>
                    );
                  })}
                  {displayAppointments.length === 0 && (
                    <div className="text-center py-12 text-sm text-[var(--c-text-3)]">
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
                { key: 'all' as const, label: '전체', count: followUps.length, style: 'bg-[#C8A951]/20 text-[#C8A951]' },
                { key: 'QC점검' as const, label: 'QC', count: followUps.filter((f) => f.follow_up_type === 'QC점검').length, style: 'bg-[#3B82F6]/20 text-[#60A5FA]' },
                { key: '메인터넌스' as const, label: '메인터넌스', count: followUps.filter((f) => f.follow_up_type === '메인터넌스').length, style: 'bg-[#8B5CF6]/20 text-[#A78BFA]' },
                { key: '후기요청' as const, label: '후기요청', count: followUps.filter((f) => f.follow_up_type === '후기요청').length, style: 'bg-[#F59E0B]/20 text-[#FBBF24]' },
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

            {/* 카드 리스트 */}
            <div className="space-y-3">
              {filteredFollowUps.map((f) => {
                const phone = f.customer?.phone;
                const daysUntil = Math.ceil((new Date(f.scheduled_date).getTime() - new Date(today).getTime()) / 86400000);
                const isUrgent = !f.is_completed && daysUntil >= 0 && daysUntil <= 3;
                const isOverdue = !f.is_completed && f.scheduled_date < today;

                const smsQC = `안녕하세요, 3M프로이즘입니다 ^^\n시공해드린 차량, 잘 타고 계신가요?\n\n시공 후 2주가 지나 QC 점검 시기가 되어 연락드렸습니다.\n필름이 완전히 안착되는 시기이기도 하고, 혹시 생활하시면서 불편하셨던 부분이 있으시다면 이번에 같이 확인해드리려고 합니다.\n\n편하신 날짜 말씀해주시면 점검 일정 잡아드리겠습니다.\n늘 감사합니다!`;
                const smsMaint = `안녕하세요, 3M프로이즘입니다 ^^\n시공 후 6개월이 되어 메인터넌스 안내드립니다.\n\n필름 상태 점검과 함께 가벼운 외부 세척, 마감 재점검까지 진행해드리고 있습니다.\n오래오래 깔끔하게 유지하실 수 있도록 저희가 꾸준히 관리해드릴게요.\n\n편하신 날짜 말씀해주시면 일정 잡아드리겠습니다.\n항상 감사합니다!`;
                const smsReviewProism = `안녕하세요, 3M프로이즘입니다.\n멋지게 작업이 완료된 차량 사진을 보내드리오니, 소중한 후기 작성 잘 부탁드리겠습니다.\n➊ 아래의 링크 클릭\n➋ 첨부드린 사진으로 후기 작성\n[ 🚩 후기 게시판 링크 ]\nhttps://m.site.naver.com/1S6dj\n고객님의 솔직한 리뷰는 저희에게 아주 큰 힘이 됩니다. 정말 감사드리며, 이후에 이어질 메인터넌스 시기(약 6개월 후)에도 차별화 된 서비스로 다시 또 찾아뵐게요!`;
                const smsReviewBMW = `안녕하세요, 3M프로이즘입니다.\n멋지게 작업이 완료된 차량 사진을 보내드리오니, 소중한 후기 작성 잘 부탁드리겠습니다.\n➊ 아래의 링크 클릭\n➋ 첨부드린 사진으로 후기 작성\n[ 🚩 후기 게시판 링크 ]\nhttps://m.site.naver.com/1S6e3\n고객님의 솔직한 리뷰는 저희에게 아주 큰 힘이 됩니다. 정말 감사드리며, 이후에 이어질 메인터넌스 시기(약 6개월 후)에도 차별화 된 서비스로 다시 또 찾아뵈겠습니다!`;
                const smsReviewAudi = `안녕하세요, 3M프로이즘입니다.\n멋지게 작업이 완료된 차량 사진을 보내드리오니, 소중한 후기 작성 잘 부탁드리겠습니다.\n➊ 아래의 링크 클릭\n➋ 첨부드린 사진으로 후기 작성\n[ 🚩 후기 게시판 링크 ]\nhttps://m.site.naver.com/1S6ej\n고객님의 솔직한 리뷰는 저희에게 아주 큰 힘이 됩니다. 정말 감사드리며, 이후에 이어질 메인터넌스 시기(약 6개월 후)에도 차별화 된 서비스로 다시 또 찾아뵈겠습니다!`;
                const sent = f.sms_sent || {};
                const markSent = async (key: string) => {
                  const updated = { ...sent, [key]: true };
                  await supabase.from('follow_ups').update({ sms_sent: updated }).eq('id', f.id);
                  fetchFollowUps();
                };
                const sendSms = (msg: string, key: string) => {
                  if (!phone) return;
                  window.open(`sms:${phone}&body=${encodeURIComponent(msg)}`);
                  if (confirm('문자를 전송하셨나요?')) markSent(key);
                };
                const sendKakao = (msg: string, key: string) => {
                  if (!phone) return;
                  const kakaoUrl = `https://sharer.kakao.com/talk/friends/picker/link?url=${encodeURIComponent('https://blog.naver.com/roice_')}&text=${encodeURIComponent(msg)}`;
                  window.open(kakaoUrl, '_blank', 'width=500,height=600');
                  if (confirm('카톡을 전송하셨나요?')) markSent(key);
                };
                const copyMsg = (msg: string) => {
                  navigator.clipboard.writeText(msg);
                  alert('문구가 복사되었습니다.');
                };

                const typeBadgeClass = f.follow_up_type === 'QC점검'
                  ? 'bg-[#3B82F6]/20 text-[#60A5FA]'
                  : f.follow_up_type === '후기요청'
                    ? 'bg-[#F59E0B]/20 text-[#FBBF24]'
                    : 'bg-[#8B5CF6]/20 text-[#A78BFA]';

                const statusBadge = f.is_completed
                  ? { text: '처리완료', class: 'bg-[#10B981]/20 text-[#34D399]' }
                  : isOverdue
                    ? { text: `${Math.abs(daysUntil)}일 지남`, class: 'bg-[#EF4444]/20 text-[#F87171]' }
                    : isUrgent
                      ? { text: daysUntil === 0 ? '오늘' : `D-${daysUntil}`, class: 'bg-[#F59E0B]/20 text-[#FBBF24]' }
                      : { text: '미처리', class: 'bg-[#EF4444]/15 text-[#F87171]' };

                const cardBorder = isOverdue
                  ? 'border-[#EF4444]/40'
                  : isUrgent
                    ? 'border-[#F59E0B]/40'
                    : f.is_completed
                      ? 'border-[#10B981]/20'
                      : 'border-[var(--c-border)]';

                const sentBtn = 'bg-[#10B981]/15 text-[#34D399]';
                const qcBtn = phone ? (sent.qc ? sentBtn : 'bg-[#3B82F6]/15 text-[#60A5FA] hover:bg-[#3B82F6]/25') : 'bg-[var(--c-subtle)] text-[var(--c-text-3)]/40 cursor-not-allowed';
                const maintBtn = phone ? (sent.maintenance ? sentBtn : 'bg-[#8B5CF6]/15 text-[#A78BFA] hover:bg-[#8B5CF6]/25') : 'bg-[var(--c-subtle)] text-[var(--c-text-3)]/40 cursor-not-allowed';
                const reviewBtn = (key: string) => phone ? (sent[key] ? sentBtn : 'bg-[#F59E0B]/15 text-[#FBBF24] hover:bg-[#F59E0B]/25') : 'bg-[var(--c-subtle)] text-[var(--c-text-3)]/40 cursor-not-allowed';

                return (
                  <div
                    key={f.id}
                    className={`bg-[var(--c-card)] border rounded-xl p-4 ${cardBorder} ${isUrgent ? 'ring-1 ring-[#F59E0B]/20' : ''}`}
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
                            ? 'bg-[#10B981] border-[#10B981] text-white'
                            : 'border-[#52525b] hover:border-[#C8A951]'
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
                          {f.scheduled_date === today && <span className="text-[#F59E0B] font-medium">(오늘)</span>}
                        </div>
                        {f.memo && <div className="text-xs text-[var(--c-text-4)] mt-1">{f.memo}</div>}
                      </div>
                    </div>

                    {/* 카드 하단: 액션 버튼 */}
                    <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-[var(--c-border)]">
                      {f.follow_up_type === 'QC점검' && (
                        <>
                        <button onClick={() => sendKakao(smsQC, 'qc')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.qc ? sentBtn : 'bg-[#FEE500]/20 text-[#3C1E1E] hover:bg-[#FEE500]/30'}`}>{sent.qc ? '✓ 카톡완료' : '카톡'}</button>
                        <button onClick={() => sendSms(smsQC, 'qc')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${qcBtn}`}>{sent.qc ? '✓ 문자완료' : '문자'}</button>
                        <button onClick={() => copyMsg(smsQC)} className="text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors bg-[var(--c-subtle)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)]">복사</button>
                        </>
                      )}
                      {f.follow_up_type === '메인터넌스' && (
                        <>
                        <button onClick={() => sendKakao(smsMaint, 'maintenance')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.maintenance ? sentBtn : 'bg-[#FEE500]/20 text-[#3C1E1E] hover:bg-[#FEE500]/30'}`}>{sent.maintenance ? '✓ 카톡완료' : '카톡'}</button>
                        <button onClick={() => sendSms(smsMaint, 'maintenance')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${maintBtn}`}>{sent.maintenance ? '✓ 문자완료' : '문자'}</button>
                        <button onClick={() => copyMsg(smsMaint)} className="text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors bg-[var(--c-subtle)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)]">복사</button>
                        </>
                      )}
                      {f.follow_up_type === '후기요청' && (
                        <>
                        <button onClick={() => sendKakao(smsReviewProism, 'proism')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.proism ? sentBtn : 'bg-[#FEE500]/20 text-[#3C1E1E] hover:bg-[#FEE500]/30'}`}>{sent.proism ? '✓ 프로이즘 카톡' : '프로이즘 카톡'}</button>
                        <button onClick={() => sendSms(smsReviewProism, 'proism')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${reviewBtn('proism')}`}>{sent.proism ? '✓ 프로이즘 문자' : '프로이즘 문자'}</button>
                        <button onClick={() => sendKakao(smsReviewBMW, 'bmw')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.bmw ? sentBtn : 'bg-[#FEE500]/20 text-[#3C1E1E] hover:bg-[#FEE500]/30'}`}>{sent.bmw ? '✓ BMW 카톡' : 'BMW 카톡'}</button>
                        <button onClick={() => sendSms(smsReviewBMW, 'bmw')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${reviewBtn('bmw')}`}>{sent.bmw ? '✓ BMW 문자' : 'BMW 문자'}</button>
                        <button onClick={() => sendKakao(smsReviewAudi, 'audi')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.audi ? sentBtn : 'bg-[#FEE500]/20 text-[#3C1E1E] hover:bg-[#FEE500]/30'}`}>{sent.audi ? '✓ 아우디 카톡' : '아우디 카톡'}</button>
                        <button onClick={() => sendSms(smsReviewAudi, 'audi')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${reviewBtn('audi')}`}>{sent.audi ? '✓ 아우디 문자' : '아우디 문자'}</button>
                        </>
                      )}
                      <button
                        onClick={() => handleToggleFollowUp(f)}
                        className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ml-auto ${
                          f.is_completed
                            ? 'bg-[#10B981]/15 text-[#34D399]'
                            : 'bg-[var(--c-subtle)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)]'
                        }`}
                      >
                        {f.is_completed ? '✓ 완료됨' : '완료 처리'}
                      </button>
                      <button onClick={() => handleOpenWarrantyFromFollowUp(f)} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${customerHasWarranty(f.customer_id) ? 'bg-[#22c55e] text-white' : 'bg-[#22c55e]/10 hover:bg-[#22c55e]/20 text-[#22c55e]'}`}>{customerHasWarranty(f.customer_id) ? '✓ 보증서' : '보증서'}</button>
                    </div>
                  </div>
                );
              })}
              {filteredFollowUps.length === 0 && (
                <div className="text-center py-12 text-sm text-[var(--c-text-3)]">
                  {followUpFilter === 'all' ? '사후관리 항목이 없습니다' : `${followUpFilter} 항목이 없습니다`}
                </div>
              )}
            </div>

            {/* 프로모션 발송 섹션 */}
            <div className="mt-6 bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5">
              <h3 className="text-sm font-semibold text-[#C8A951] mb-4">프로모션 발송</h3>
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
                            <span className="text-xs bg-[#C8A951]/20 text-[#C8A951] px-2 py-0.5 rounded">{promo.season}</span>
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
                                    const msg = promo.tpl(cust.name);
                                    const kakaoUrl = `https://sharer.kakao.com/talk/friends/picker/link?url=${encodeURIComponent('https://blog.naver.com/roice_')}&text=${encodeURIComponent(msg)}`;
                                    window.open(kakaoUrl, '_blank', 'width=500,height=600');
                                    trackPromo(cust, msg);
                                  }}
                                  className="text-xs bg-[#FEE500] hover:bg-[#FDD835] text-[#3C1E1E] font-semibold rounded-lg px-3 py-1.5 transition-colors whitespace-nowrap"
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
                                  className="text-xs bg-[#3B82F6] hover:bg-[#2563EB] text-white font-semibold rounded-lg px-3 py-1.5 transition-colors whitespace-nowrap"
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
                                  className="text-xs bg-[#C8A951] hover:bg-[#b89a41] text-[#09090b] font-semibold rounded-lg px-3 py-1.5 transition-colors whitespace-nowrap"
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
              <button
                onClick={() => setShowAddConsultation(true)}
                className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
              >
                + 상담 추가
              </button>
            </div>

            <div className="space-y-2">
              {consultations.map((c) => (
                <div key={c.id} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--c-text-1)]">{c.customer?.name || '-'}</span>
                      {c.customer?.phone && <span className="text-xs text-[var(--c-text-3)]">{c.customer.phone}</span>}
                    </div>
                    <span className="text-xs text-[var(--c-text-3)]">{formatDate(c.consultation_date)}</span>
                  </div>
                  {c.content && <p className="text-sm text-[var(--c-text-2)] mb-2">{c.content}</p>}
                  <div className="flex items-center gap-3 text-xs text-[var(--c-text-3)]">
                    {c.estimate && <span>견적: <span className="text-[#C8A951]">{c.estimate}</span></span>}
                    {c.interested_services && <span>관심: <span className="text-[var(--c-text-2)]">{c.interested_services}</span></span>}
                    {c.memo && <span>메모: {c.memo}</span>}
                  </div>
                </div>
              ))}
              {consultations.length === 0 && (
                <div className="text-center py-12 text-sm text-[var(--c-text-3)]">등록된 상담 기록이 없습니다</div>
              )}
            </div>
          </div>
        )}
        {/* ─── TAB: 매출 대시보드 ─────────────────────────────── */}
        {activeTab === 'stats' && (
          <div>
            {/* 연도 선택 */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <button onClick={() => setStatsYear(String(Number(statsYear) - 1))} className="text-[var(--c-text-3)] hover:text-[var(--c-text-1)] transition-colors text-lg">◀</button>
                <span className="text-base font-semibold text-[var(--c-text-1)] min-w-[80px] text-center">{statsYear}년</span>
                <button onClick={() => setStatsYear(String(Number(statsYear) + 1))} className="text-[var(--c-text-3)] hover:text-[var(--c-text-1)] transition-colors text-lg">▶</button>
              </div>
              <div className="flex items-center gap-2">
                <select id="report-month" defaultValue={String(new Date().getMonth() + 1)} className="bg-[var(--c-subtle)] border border-[#2a2a2e] rounded-lg px-2 py-1 text-xs text-[var(--c-text-2)] outline-none">
                  {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}월</option>)}
                </select>
                <button
                  onClick={async () => {
                    const monthSel = (document.getElementById('report-month') as HTMLSelectElement)?.value || String(new Date().getMonth() + 1);
                    const res = await fetch(`/api/report/monthly?year=${statsYear}&month=${monthSel}`);
                    if (!res.ok) { alert('리포트 데이터 로드 실패'); return; }
                    const d = await res.json();

                    const bossS = Number(localStorage.getItem('salary_boss') || '0');
                    const teamS = Number(localStorage.getItem('salary_team') || '0');
                    const juniorS = Number(localStorage.getItem('salary_junior') || '0');
                    const totalSalary = bossS + teamS + juniorS;
                    const profit = d.totalRevenue - totalSalary;
                    const ratio = d.totalRevenue > 0 ? Math.round((totalSalary / d.totalRevenue) * 100) : 0;
                    const chg = d.revenueChange !== null ? `(전월 대비 ${d.revenueChange > 0 ? '+' : ''}${d.revenueChange}%)` : '';

                    const tRow = (cells: string[], head = false) => cells.map((c) => `<td style="border:1px solid #ddd;padding:6px 10px;${head ? 'background:#f5f5f5;font-weight:600;font-size:11px;color:#666;' : 'font-size:12px;color:#333;'}">${c}</td>`).join('');

                    const html = `<div id="pdf-report" style="width:700px;padding:40px;font-family:'Pretendard',-apple-system,sans-serif;background:#fff;color:#333;">
                      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
                        <div style="width:36px;height:36px;background:#E4002B;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:16px;">◆</div>
                        <div><div style="font-size:18px;font-weight:800;color:#1a1a1a;">3M 프로이즘 강남서초점</div><div style="font-size:11px;color:#999;">월간 리포트</div></div>
                      </div>
                      <div style="font-size:22px;font-weight:800;color:#1a1a1a;margin:16px 0 4px;">${d.year}년 ${d.month}월 리포트</div>
                      <div style="height:2px;background:linear-gradient(90deg,#C8A951,transparent);margin-bottom:24px;"></div>

                      <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:12px;">요약</div>
                      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:24px;">
                        <div style="background:#fafafa;border-radius:8px;padding:12px;"><div style="font-size:10px;color:#999;">총 시공</div><div style="font-size:20px;font-weight:700;">${d.totalCount}<span style="font-size:11px;color:#999;"> 건</span></div></div>
                        <div style="background:#fafafa;border-radius:8px;padding:12px;"><div style="font-size:10px;color:#999;">총 매출</div><div style="font-size:20px;font-weight:700;color:#C8A951;">${(d.totalRevenue/10000).toLocaleString()}<span style="font-size:11px;color:#999;"> 만원</span></div></div>
                        <div style="background:#fafafa;border-radius:8px;padding:12px;"><div style="font-size:10px;color:#999;">건당 평균</div><div style="font-size:20px;font-weight:700;">${(d.avgPerCase/10000).toLocaleString()}<span style="font-size:11px;color:#999;"> 만원</span></div></div>
                        <div style="background:#fafafa;border-radius:8px;padding:12px;"><div style="font-size:10px;color:#999;">전월 대비</div><div style="font-size:20px;font-weight:700;color:${d.revenueChange > 0 ? '#22C55E' : d.revenueChange < 0 ? '#EF4444' : '#333'};">${chg || '-'}</div></div>
                      </div>

                      <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:8px;">서비스별 현황</div>
                      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr>${tRow(['서비스','건수','매출'], true)}</tr>${d.byService.map((s: {name:string;count:number;revenue:number}) => `<tr>${tRow([s.name, `${s.count}건`, `${(s.revenue/10000).toLocaleString()}만원`])}</tr>`).join('')}</table>

                      ${d.carAnalysis.length > 0 ? `<div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:8px;">차종별 인기 서비스</div>
                      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr>${tRow(['차종','서비스 내역','건수'], true)}</tr>${d.carAnalysis.map((c: {car:string;services:string;total:number}) => `<tr>${tRow([c.car, c.services, `${c.total}건`])}</tr>`).join('')}</table>` : ''}

                      ${d.sourceAnalysis.length > 0 ? `<div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:8px;">유입 경로 분석</div>
                      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr>${tRow(['경로','고객수','시공건수','매출'], true)}</tr>${d.sourceAnalysis.map((s: {source:string;customerCount:number;count:number;revenue:number}) => `<tr>${tRow([s.source, `${s.customerCount}명`, `${s.count}건`, `${(s.revenue/10000).toLocaleString()}만원`])}</tr>`).join('')}</table>` : ''}

                      <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:8px;">담당자별 작업량</div>
                      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr>${tRow(['담당자','시공 건수'], true)}</tr>${d.managerWorkload.map((m: {name:string;count:number}) => `<tr>${tRow([m.name, `${m.count}건`])}</tr>`).join('')}</table>

                      ${totalSalary > 0 ? `<div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:8px;">수익 분석</div>
                      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
                        <tr>${tRow(['항목','금액'], true)}</tr>
                        <tr>${tRow(['매출', `${(d.totalRevenue/10000).toLocaleString()}만원`])}</tr>
                        <tr>${tRow(['인건비', `${(totalSalary/10000).toLocaleString()}만원 (${ratio}%)`])}</tr>
                        <tr>${tRow(['영업이익', `${(profit/10000).toLocaleString()}만원`])}</tr>
                      </table>` : ''}

                      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:10px;color:#aaa;text-align:center;">
                        3M 프로이즘 강남서초점 · 서울특별시 서초구 서초중앙로8길 82 1동 1층 1호 · 010-7287-7140
                      </div>
                    </div>`;

                    // 임시 DOM에 렌더링 → html2canvas → PDF
                    const container = document.createElement('div');
                    container.style.position = 'fixed';
                    container.style.left = '-9999px';
                    container.style.top = '0';
                    container.innerHTML = html;
                    document.body.appendChild(container);

                    const el = container.querySelector('#pdf-report') as HTMLElement;
                    const html2canvas = (await import('html2canvas')).default;
                    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
                    document.body.removeChild(container);

                    const { default: jsPDF } = await import('jspdf');
                    const imgW = 210;
                    const imgH = (canvas.height * imgW) / canvas.width;
                    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

                    let posY = 0;
                    const pageH = 297;
                    while (posY < imgH) {
                      if (posY > 0) pdf.addPage();
                      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, -posY, imgW, imgH);
                      posY += pageH;
                    }

                    pdf.save(`프로이즘-월간리포트-${d.year}년${String(d.month).padStart(2,'0')}월.pdf`);
                  }}
                  className="text-xs bg-[#C8A951] hover:bg-[#b89a41] text-[#09090b] font-semibold rounded-lg px-3 py-1.5 transition-colors"
                >
                  월간 리포트 PDF
                </button>
                <button onClick={fetchStats} className="text-xs bg-[var(--c-subtle)] hover:bg-[var(--c-hover)] text-[var(--c-text-2)] rounded-lg px-3 py-1.5 transition-colors">새로고침</button>
              </div>
            </div>

            {statsLoading ? (
              <div className="text-center text-[var(--c-text-3)] py-20">분석 데이터 불러오는 중...</div>
            ) : !statsData ? (
              <div className="text-center text-[var(--c-text-3)] py-20">시공 데이터가 없습니다.</div>
            ) : (
              <div className="space-y-6">
                {/* ── 요약 카드 ──────────────────────────────── */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
                    <div className="text-xs text-[var(--c-text-3)] mb-1">총 시공 건수</div>
                    <div className="text-2xl font-bold text-[var(--c-text-1)]">{statsData.totalCount}<span className="text-sm font-normal text-[var(--c-text-3)] ml-1">건</span></div>
                  </div>
                  <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
                    <div className="text-xs text-[var(--c-text-3)] mb-1">총 매출</div>
                    <div className="text-2xl font-bold text-[#C8A951]">{(statsData.totalRevenue / 10000).toLocaleString()}<span className="text-sm font-normal text-[var(--c-text-3)] ml-1">만원</span></div>
                  </div>
                  <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
                    <div className="text-xs text-[var(--c-text-3)] mb-1">건당 평균</div>
                    <div className="text-2xl font-bold text-[var(--c-text-1)]">{(statsData.avgPerCase / 10000).toLocaleString()}<span className="text-sm font-normal text-[var(--c-text-3)] ml-1">만원</span></div>
                  </div>
                  <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
                    <div className="text-xs text-[var(--c-text-3)] mb-1">서비스 종류</div>
                    <div className="text-2xl font-bold text-[var(--c-text-1)]">{statsData.byService.length}<span className="text-sm font-normal text-[var(--c-text-3)] ml-1">개</span></div>
                  </div>
                </div>

                {/* ── 분기별 매출 ────────────────────────────── */}
                <div className="grid grid-cols-4 gap-3">
                  {statsData.quarters.map((q) => (
                    <div key={q.label} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4 text-center">
                      <div className="text-xs text-[var(--c-text-3)] mb-1">{q.label}</div>
                      <div className="text-lg font-bold text-[var(--c-text-1)]">{q.revenue > 0 ? `${(q.revenue / 10000).toLocaleString()}만` : '-'}</div>
                      <div className="text-[10px] text-[var(--c-text-3)]">{q.count}건</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* ── 서비스별 현황 ──────────────────────── */}
                  <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-[#C8A951] mb-4">서비스별 현황</h3>
                    {statsData.byService.length === 0 ? (
                      <div className="text-sm text-[var(--c-text-3)] py-4 text-center">데이터 없음</div>
                    ) : (
                      <div className="space-y-3">
                        {statsData.byService.map((s) => {
                          const maxRev = Math.max(...statsData.byService.map((x) => x.revenue), 1);
                          return (
                            <div key={s.name}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm text-[var(--c-text-1)]">{s.name}</span>
                                <div className="text-xs text-[var(--c-text-3)]">
                                  <span className="text-[var(--c-text-2)]">{s.count}건</span>
                                  <span className="mx-1.5">·</span>
                                  <span className="text-[#C8A951]">{(s.revenue / 10000).toLocaleString()}만원</span>
                                </div>
                              </div>
                              <div className="w-full h-2 bg-[var(--c-subtle)] rounded-full overflow-hidden">
                                <div className="h-full bg-[#C8A951] rounded-full transition-all" style={{ width: `${(s.revenue / maxRev) * 100}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── 월별 매출 + 증감률 ────────────────── */}
                  <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-[#C8A951] mb-4">월별 매출</h3>
                    {(() => {
                      const maxRev = Math.max(...statsData.byMonth.map((m) => m.revenue), 1);
                      return (
                        <div className="flex items-end gap-1.5" style={{ height: '220px' }}>
                          {statsData.byMonth.map((m) => {
                            const h = maxRev > 0 ? (m.revenue / maxRev) * 160 : 0;
                            const monthNum = m.month.split('-')[1];
                            return (
                              <div key={m.month} className="flex-1 flex flex-col items-center justify-end h-full">
                                {m.change !== null && m.revenue > 0 && (
                                  <div className={`text-[9px] mb-0.5 ${m.change > 0 ? 'text-[#22C55E]' : m.change < 0 ? 'text-[#EF4444]' : 'text-[var(--c-text-3)]'}`}>
                                    {m.change > 0 ? '+' : ''}{m.change}%
                                  </div>
                                )}
                                {m.revenue > 0 && <div className="text-[10px] text-[var(--c-text-3)] mb-1">{Math.round(m.revenue / 10000)}</div>}
                                <div className="w-full rounded-t-sm transition-all" style={{ height: `${Math.max(h, m.revenue > 0 ? 4 : 0)}px`, backgroundColor: m.count > 0 ? '#C8A951' : '#1e1e22', opacity: m.count > 0 ? 0.8 : 0.3 }} />
                                <div className="text-[10px] text-[var(--c-text-3)] mt-1.5">{Number(monthNum)}월</div>
                                {m.count > 0 && <div className="text-[9px] text-[var(--c-text-2)]">{m.count}건</div>}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* ── 차종별 인기 서비스 ──────────────────── */}
                <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-[#C8A951] mb-4">차종별 인기 서비스</h3>
                  {statsData.carAnalysis.length === 0 ? (
                    <div className="text-sm text-[var(--c-text-3)] py-4 text-center">데이터 없음</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--c-border)]">
                            <th className="text-left py-2 px-3 text-[var(--c-text-3)] font-medium text-xs">차종</th>
                            <th className="text-left py-2 px-3 text-[var(--c-text-3)] font-medium text-xs">서비스 내역</th>
                            <th className="text-right py-2 px-3 text-[var(--c-text-3)] font-medium text-xs">건수</th>
                            <th className="text-right py-2 px-3 text-[var(--c-text-3)] font-medium text-xs">매출</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statsData.carAnalysis.map((c) => (
                            <tr key={c.car} className="border-b border-[var(--c-border)]/50 hover:bg-[var(--c-subtle)]/30">
                              <td className="py-2.5 px-3 text-[var(--c-text-1)] font-medium">{c.car}</td>
                              <td className="py-2.5 px-3">
                                <div className="flex flex-wrap gap-1">
                                  {c.services.map((s) => (
                                    <span key={s.name} className="text-[10px] bg-[var(--c-subtle)] text-[var(--c-text-2)] px-2 py-0.5 rounded">{s.name} {s.count}건</span>
                                  ))}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right text-[var(--c-text-2)]">{c.totalCount}</td>
                              <td className="py-2.5 px-3 text-right text-[#C8A951] font-medium">{c.totalRevenue > 0 ? `${(c.totalRevenue / 10000).toLocaleString()}만` : '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* ── 유입 경로 분석 ──────────────────────── */}
                <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-[#C8A951] mb-4">고객 유입 경로 분석</h3>
                  {statsData.sourceAnalysis.length === 0 ? (
                    <div className="text-sm text-[var(--c-text-3)] py-4 text-center">데이터 없음</div>
                  ) : (
                    <div className="space-y-3">
                      {statsData.sourceAnalysis.map((s) => {
                        const maxRev = Math.max(...statsData.sourceAnalysis.map((x) => x.revenue), 1);
                        return (
                          <div key={s.source}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-[var(--c-text-1)]">{s.source}</span>
                              <div className="text-xs text-[var(--c-text-3)] flex gap-3">
                                <span>고객 <span className="text-[var(--c-text-2)]">{s.customerCount}명</span></span>
                                <span>시공 <span className="text-[var(--c-text-2)]">{s.serviceCount}건</span></span>
                                <span>매출 <span className="text-[#C8A951]">{s.revenue > 0 ? `${(s.revenue / 10000).toLocaleString()}만` : '-'}</span></span>
                                <span>인당 <span className="text-[#3B82F6]">{s.avgPerCustomer > 0 ? `${(s.avgPerCustomer / 10000).toLocaleString()}만` : '-'}</span></span>
                              </div>
                            </div>
                            <div className="w-full h-2 bg-[var(--c-subtle)] rounded-full overflow-hidden">
                              <div className="h-full bg-[#3B82F6] rounded-full transition-all" style={{ width: `${(s.revenue / maxRev) * 100}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ── 이번 주 작업량 리포트 ───────────────── */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-[#C8A951] mb-4">이번 주 작업량</h3>
                    {statsData.weekDays && (() => {
                      const maxW = Math.max(...statsData.weekDays.map((d) => d.total), 1);
                      return (
                        <div className="flex items-end gap-2" style={{ height: '180px' }}>
                          {statsData.weekDays.map((d) => {
                            const h = (d.total / maxW) * 130;
                            const bossH = d.total > 0 ? (d.boss / d.total) * h : 0;
                            const teamH = h - bossH;
                            return (
                              <div key={d.label} className="flex-1 flex flex-col items-center justify-end h-full">
                                {d.total > 0 && <div className="text-[10px] text-[var(--c-text-3)] mb-1">{d.total}</div>}
                                <div className="w-full flex flex-col">
                                  {teamH > 0 && <div className="w-full rounded-t-sm bg-[#22C55E]" style={{ height: `${teamH}px`, opacity: 0.7 }} />}
                                  {bossH > 0 && <div className={`w-full ${teamH > 0 ? '' : 'rounded-t-sm'} bg-[#3B82F6]`} style={{ height: `${bossH}px`, opacity: 0.7 }} />}
                                  {d.total === 0 && <div className="w-full rounded-t-sm bg-[var(--c-subtle)]" style={{ height: '4px', opacity: 0.3 }} />}
                                </div>
                                <div className="text-[10px] text-[var(--c-text-3)] mt-1.5">{d.label}</div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                    <div className="flex items-center gap-4 mt-3 text-[10px] text-[var(--c-text-3)]">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#3B82F6]" /> 대표</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#22C55E]" /> 이팀장님</span>
                    </div>
                    {statsData.monthWorkload && (
                      <div className="mt-3 pt-3 border-t border-[var(--c-border)] flex gap-4 text-xs text-[var(--c-text-3)]">
                        <span>이번 달: <span className="text-[var(--c-text-1)] font-medium">{statsData.monthWorkload.total}건</span></span>
                        <span>일 평균: <span className="text-[var(--c-text-1)] font-medium">{statsData.monthWorkload.dailyAvg}건</span></span>
                      </div>
                    )}
                  </div>

                  {/* ── 수익 분석 ──────────────────────────── */}
                  <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-[#C8A951] mb-4">수익 분석</h3>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div>
                        <label className="text-[10px] text-[var(--c-text-3)] mb-1 block">대표 월급여</label>
                        <input type="text" inputMode="numeric" value={salaryBoss ? Number(salaryBoss).toLocaleString() : ''} onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ''); setSalaryBoss(v); localStorage.setItem('salary_boss', v); }} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="0" />
                      </div>
                      <div>
                        <label className="text-[10px] text-[var(--c-text-3)] mb-1 block">이팀장님 월급여</label>
                        <input type="text" inputMode="numeric" value={salaryTeam ? Number(salaryTeam).toLocaleString() : ''} onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ''); setSalaryTeam(v); localStorage.setItem('salary_team', v); }} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="0" />
                      </div>
                      <div>
                        <label className="text-[10px] text-[var(--c-text-3)] mb-1 block">김막내 월급여</label>
                        <input type="text" inputMode="numeric" value={salaryJunior ? Number(salaryJunior).toLocaleString() : ''} onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ''); setSalaryJunior(v); localStorage.setItem('salary_junior', v); }} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="0" />
                      </div>
                    </div>
                    {(() => {
                      const totalSalary = (Number(salaryBoss) || 0) + (Number(salaryTeam) || 0) + (Number(salaryJunior) || 0);
                      if (!totalSalary) return <div className="text-xs text-[var(--c-text-3)] text-center py-4">급여를 입력하면 수익 분석이 표시됩니다</div>;
                      return (
                        <div className="space-y-2">
                          {statsData.byMonth.filter((m) => m.revenue > 0).slice(-6).map((m) => {
                            const profit = m.revenue - totalSalary;
                            const ratio = m.revenue > 0 ? Math.round((totalSalary / m.revenue) * 100) : 0;
                            const monthNum = m.month.split('-')[1];
                            return (
                              <div key={m.month} className="flex items-center gap-3 text-xs">
                                <span className="text-[var(--c-text-3)] w-8">{Number(monthNum)}월</span>
                                <div className="flex-1 flex items-center gap-2">
                                  <span className="text-[var(--c-text-2)]">{(m.revenue / 10000).toLocaleString()}만</span>
                                  <span className="text-[var(--c-text-3)]">-</span>
                                  <span className="text-[#EF4444]/70">{(totalSalary / 10000).toLocaleString()}만</span>
                                  <span className="text-[var(--c-text-3)]">=</span>
                                  <span className={`font-medium ${profit >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>{(profit / 10000).toLocaleString()}만</span>
                                </div>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${ratio <= 30 ? 'bg-[#22C55E]/15 text-[#22C55E]' : ratio <= 50 ? 'bg-[#C8A951]/15 text-[#C8A951]' : 'bg-[#EF4444]/15 text-[#EF4444]'}`}>인건비 {ratio}%</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {/* ─── TAB: 재고 관리 ───────────────────────────────── */}
        {activeTab === 'inventory' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm text-[var(--c-text-3)]">{inventory.length}개 품목</h2>
            </div>
            {/* 등록/수정 폼 */}
            <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4 mb-4">
              <h3 className="text-xs text-[#C8A951] font-semibold mb-3">{editInventoryId ? '품목 수정' : '품목 등록'}</h3>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <input type="text" value={inventoryForm.name} onChange={(e) => setInventoryForm({ ...inventoryForm, name: e.target.value })} className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="품목명 *" />
                <input type="text" inputMode="numeric" value={inventoryForm.quantity} onChange={(e) => setInventoryForm({ ...inventoryForm, quantity: e.target.value.replace(/[^0-9]/g, '') })} className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="수량" />
                <select value={inventoryForm.unit} onChange={(e) => setInventoryForm({ ...inventoryForm, unit: e.target.value })} className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50">
                  {['롤', 'ft', 'm', '개', '병', '장'].map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <input type="text" inputMode="numeric" value={inventoryForm.min_stock} onChange={(e) => setInventoryForm({ ...inventoryForm, min_stock: e.target.value.replace(/[^0-9]/g, '') })} className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="최소재고" />
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!inventoryForm.name) return;
                      const body = { ...inventoryForm, quantity: Number(inventoryForm.quantity) || 0, min_stock: Number(inventoryForm.min_stock) || 0, ...(editInventoryId ? { id: editInventoryId } : {}) };
                      await fetch('/api/inventory', { method: editInventoryId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                      setInventoryForm({ name: '', quantity: '', unit: '롤', min_stock: '', memo: '' });
                      setEditInventoryId(null);
                      fetchInventory();
                    }}
                    className="flex-1 bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors"
                  >{editInventoryId ? '수정' : '등록'}</button>
                  {editInventoryId && <button onClick={() => { setEditInventoryId(null); setInventoryForm({ name: '', quantity: '', unit: '롤', min_stock: '', memo: '' }); }} className="text-xs text-[var(--c-text-3)] hover:text-[var(--c-text-2)]">취소</button>}
                </div>
              </div>
            </div>
            {/* 재고 목록 */}
            <div className="space-y-2">
              {inventory.map((item) => {
                const isLow = item.min_stock > 0 && item.quantity <= item.min_stock;
                return (
                  <div key={item.id} className={`bg-[var(--c-card)] border rounded-xl p-4 flex items-center justify-between ${isLow ? 'border-[#EF4444]/50' : 'border-[var(--c-border)]'}`}>
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="text-sm font-medium text-[var(--c-text-1)]">
                          {item.name}
                          {isLow && <span className="ml-2 text-[9px] bg-[#EF4444]/20 text-[#EF4444] px-1.5 py-0.5 rounded-full font-medium">재고 부족</span>}
                        </div>
                        <div className="text-xs text-[var(--c-text-3)] mt-0.5">
                          최소재고: {item.min_stock}{item.unit}
                          {item.memo && <span className="ml-2">· {item.memo}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className={`text-lg font-bold ${isLow ? 'text-[#EF4444]' : 'text-[var(--c-text-1)]'}`}>{item.quantity}<span className="text-xs font-normal text-[var(--c-text-3)] ml-1">{item.unit}</span></div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => { setEditInventoryId(item.id); setInventoryForm({ name: item.name, quantity: String(item.quantity), unit: item.unit, min_stock: String(item.min_stock), memo: item.memo || '' }); }} className="text-xs bg-[var(--c-subtle)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)] px-2 py-1 rounded-lg transition-colors">수정</button>
                        <button onClick={async () => { if (!confirm(`${item.name}을(를) 삭제하시겠습니까?`)) return; await fetch(`/api/inventory?id=${item.id}`, { method: 'DELETE' }); fetchInventory(); }} className="text-xs text-[var(--c-text-3)] hover:text-[#EF4444] px-2 py-1 rounded-lg transition-colors">삭제</button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {inventory.length === 0 && <div className="text-center py-12 text-sm text-[var(--c-text-3)]">등록된 품목이 없습니다</div>}
            </div>
          </div>
        )}
        {/* ─── TAB: 견적 템플릿 ──────────────────────────────── */}
        {activeTab === 'templates' && (
          <div className="space-y-6">
            {/* 견적서 생성 */}
            <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5">
              <h3 className="text-sm font-semibold text-[#C8A951] mb-4">Notion 견적서 생성</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <div className="col-span-2 lg:col-span-1">
                  <label className="text-xs text-[var(--c-text-3)] mb-1 block">고객 선택 *</label>
                  <select
                    value={estimateForm.customer_id}
                    onChange={(e) => setEstimateForm({ ...estimateForm, customer_id: e.target.value })}
                    className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50"
                  >
                    <option value="">선택</option>
                    {allCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.car_brand ? ` (${c.car_brand} ${c.car_model || ''})` : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--c-text-3)] mb-1 block">예상 금액</label>
                  <input type="text" inputMode="numeric" value={estimateForm.amount ? Number(estimateForm.amount).toLocaleString() : ''} onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ''); setEstimateForm({ ...estimateForm, amount: raw }); }} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="2,500,000" />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-text-3)] mb-1 block">작업 예정일</label>
                  <input type="date" value={estimateForm.scheduledDate} onChange={(e) => setEstimateForm({ ...estimateForm, scheduledDate: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-text-3)] mb-1 block">비고</label>
                  <input type="text" value={estimateForm.memo} onChange={(e) => setEstimateForm({ ...estimateForm, memo: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="추가 메모" />
                </div>
              </div>
              {/* 서비스 선택 */}
              <div className="mb-4">
                <label className="text-xs text-[var(--c-text-3)] mb-2 block">서비스 선택</label>
                <div className="flex flex-wrap gap-2">
                  {['PPF', '틴팅', '세라믹코팅', '래핑', '크롬죽이기', '신차패키지'].map((svc) => (
                    <button
                      key={svc}
                      onClick={() => setEstimateForm((f) => {
                        const selected = f.services.includes(svc);
                        const services = selected ? f.services.filter((s) => s !== svc) : [...f.services, svc];
                        const serviceDetails = { ...f.serviceDetails };
                        if (selected) delete serviceDetails[svc];
                        return { ...f, services, serviceDetails };
                      })}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        estimateForm.services.includes(svc)
                          ? 'bg-[#C8A951]/20 border-[#C8A951]/50 text-[#C8A951]'
                          : 'bg-[var(--c-input)] border-[var(--c-border)] text-[var(--c-text-3)] hover:text-[var(--c-text-2)]'
                      }`}
                    >
                      {svc}
                    </button>
                  ))}
                </div>
                {/* 서비스별 세부 내용 입력 */}
                {estimateForm.services.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {estimateForm.services.map((svc) => (
                      <div key={svc} className="flex items-start gap-2">
                        <span className="text-xs text-[#C8A951] bg-[#C8A951]/10 rounded px-2 py-1.5 whitespace-nowrap mt-px">{svc}</span>
                        <input
                          type="text"
                          value={estimateForm.serviceDetails[svc] || ''}
                          onChange={(e) => setEstimateForm((f) => ({ ...f, serviceDetails: { ...f.serviceDetails, [svc]: e.target.value } }))}
                          className="flex-1 bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50"
                          placeholder={svc === 'PPF' ? '전면 풀랩 + 사이드미러 + 도어엣지' : svc === '틴팅' ? '전면 크리스탈라인 70% + 측후면 루마 15%' : `${svc} 세부 내용`}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* 생성 버튼 + 결과 */}
              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    const cust = allCustomers.find((c) => c.id === estimateForm.customer_id);
                    if (!cust) { alert('고객을 선택해주세요.'); return; }
                    setEstimateLoading(true);
                    setEstimateUrl(null);
                    try {
                      const res = await fetch('/api/notion/estimate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          customerName: cust.name,
                          phone: cust.phone,
                          carModel: [cust.car_brand, cust.car_model].filter(Boolean).join(' ') || null,
                          services: estimateForm.services,
                          serviceDetails: estimateForm.serviceDetails,
                          amount: estimateForm.amount ? Number(estimateForm.amount) : null,
                          scheduledDate: estimateForm.scheduledDate || null,
                          memo: estimateForm.memo || null,
                        }),
                      });
                      const data = await res.json();
                      if (data.url) {
                        setEstimateUrl(data.url);
                      } else {
                        alert('견적서 생성 실패: ' + (data.error || ''));
                      }
                    } catch (err) { alert('견적서 생성 오류'); console.error(err); }
                    setEstimateLoading(false);
                  }}
                  disabled={estimateLoading}
                  className="bg-[#C8A951] hover:bg-[#b89a41] text-[#09090b] text-sm font-semibold rounded-lg px-5 py-2 transition-colors disabled:opacity-50"
                >
                  {estimateLoading ? '생성 중...' : 'Notion 견적서 생성'}
                </button>
                {estimateUrl && (
                  <div className="flex items-center gap-2">
                    <a href={estimateUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#3B82F6] hover:underline truncate max-w-[300px]">{estimateUrl}</a>
                    <button
                      onClick={() => { navigator.clipboard.writeText(estimateUrl); }}
                      className="text-xs bg-[#3B82F6]/10 hover:bg-[#3B82F6]/20 text-[#3B82F6] rounded-lg px-3 py-1.5 transition-colors whitespace-nowrap"
                    >
                      URL 복사
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 기존 견적 템플릿 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {TEMPLATE_KEYS.map((key) => (
              <div key={key} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-[#C8A951]">{key}</h3>
                  <button
                    onClick={() => handleResetTemplate(key)}
                    className="text-[10px] text-[var(--c-text-3)] hover:text-[var(--c-text-2)] transition-colors"
                  >
                    기본값 복원
                  </button>
                </div>
                <textarea
                  value={templates[key] || ''}
                  onChange={(e) => handleTemplateChange(key, e.target.value)}
                  className="flex-1 bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50 resize-y leading-relaxed"
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
          </div>
        )}
      </div>

      {/* ─── Modal: 고객 추가 ────────────────────────────────── */}
      {showAddCustomer && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => { setShowAddCustomer(false); setEditCustomerId(null); }}>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-lg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--c-text-1)] font-semibold text-base mb-4">{editCustomerId ? '고객 수정' : '고객 추가'}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">이름 *</label>
                <input type="text" value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="고객 이름" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">연락처</label>
                <input type="text" value={customerForm.phone} onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="010-0000-0000" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">유입경로</label>
                <select value={customerForm.source} onChange={(e) => setCustomerForm({ ...customerForm, source: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50">
                  <option value="">선택...</option>
                  {['카페', '블로그', '소개/재방문', '유튜브', '고정', '경로X', '기타'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">차량 브랜드</label>
                <input type="text" value={customerForm.car_brand} onChange={(e) => setCustomerForm({ ...customerForm, car_brand: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="BMW, 벤츠, 포르쉐 등" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">차량 모델</label>
                <input type="text" value={customerForm.car_model} onChange={(e) => setCustomerForm({ ...customerForm, car_model: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="X5, GLE, 카이엔 등" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">연식</label>
                <input type="text" value={customerForm.car_year} onChange={(e) => setCustomerForm({ ...customerForm, car_year: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="2024" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">색상</label>
                <input type="text" value={customerForm.car_color} onChange={(e) => setCustomerForm({ ...customerForm, car_color: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="블랙, 화이트 등" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">메모</label>
                <textarea value={customerForm.memo} onChange={(e) => setCustomerForm({ ...customerForm, memo: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50 resize-none h-20" placeholder="특이사항" />
              </div>
              {editCustomerId && (
              <div className="col-span-2 border-t border-[var(--c-border)] pt-3 mt-1">
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">예상 금액</label>
                <input type="text" inputMode="numeric" value={customerForm.appointment_amount ? Number(customerForm.appointment_amount).toLocaleString() : ''} onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ''); setCustomerForm({ ...customerForm, appointment_amount: raw }); }} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="2,500,000" />
              </div>
              )}
              {!editCustomerId && (<>
              <div className="col-span-2 border-t border-[var(--c-border)] pt-3 mt-1">
                <div className="text-xs text-[#C8A951] font-medium mb-2">예약 정보 (선택)</div>
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">시공 시작일</label>
                <input type="date" value={customerForm.appointment_start_date} onChange={(e) => setCustomerForm({ ...customerForm, appointment_start_date: e.target.value })} onInput={(e) => setCustomerForm({ ...customerForm, appointment_start_date: (e.target as HTMLInputElement).value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">시공 종료일</label>
                <input type="date" value={customerForm.appointment_end_date} onChange={(e) => setCustomerForm({ ...customerForm, appointment_end_date: e.target.value })} onInput={(e) => setCustomerForm({ ...customerForm, appointment_end_date: (e.target as HTMLInputElement).value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">시공 종류</label>
                <select value={customerForm.appointment_service_type} onChange={(e) => setCustomerForm({ ...customerForm, appointment_service_type: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50">
                  <option value="">선택...</option>
                  {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">예상 금액</label>
                <input type="text" inputMode="numeric" value={customerForm.appointment_amount ? Number(customerForm.appointment_amount).toLocaleString() : ''} onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ''); setCustomerForm({ ...customerForm, appointment_amount: raw }); }} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="2,500,000" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">예약 메모</label>
                <textarea value={customerForm.appointment_memo} onChange={(e) => setCustomerForm({ ...customerForm, appointment_memo: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50 resize-none h-16" placeholder="예약 관련 메모" />
              </div>
              </>)}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setShowAddCustomer(false); setEditCustomerId(null); }} className="px-4 py-2 text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-2)] transition-colors">취소</button>
              <button onClick={editCustomerId ? handleUpdateCustomer : handleAddCustomer} className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">{editCustomerId ? '수정' : '추가'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: 예약 추가 ────────────────────────────────── */}
      {showAddAppointment && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowAddAppointment(false)}>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-lg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--c-text-1)] font-semibold text-base mb-4">예약 추가</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">고객 *</label>
                <CustomerPicker value={appointmentForm.customer_id} onChange={(id) => setAppointmentForm({ ...appointmentForm, customer_id: id })} />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">시공 시작일 *</label>
                <input type="date" value={appointmentForm.appointment_date} onChange={(e) => setAppointmentForm({ ...appointmentForm, appointment_date: e.target.value })} onInput={(e) => setAppointmentForm({ ...appointmentForm, appointment_date: (e.target as HTMLInputElement).value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">시공 종료일</label>
                <input type="date" value={appointmentForm.end_date} onChange={(e) => setAppointmentForm({ ...appointmentForm, end_date: e.target.value })} onInput={(e) => setAppointmentForm({ ...appointmentForm, end_date: (e.target as HTMLInputElement).value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">시공 종류</label>
                <select value={appointmentForm.service_type} onChange={(e) => setAppointmentForm({ ...appointmentForm, service_type: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50">
                  <option value="">선택...</option>
                  {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">예상 금액</label>
                <input type="text" inputMode="numeric" value={appointmentForm.amount ? Number(appointmentForm.amount).toLocaleString() : ''} onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ''); setAppointmentForm({ ...appointmentForm, amount: raw }); }} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="2,500,000" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">메모</label>
                <textarea value={appointmentForm.memo} onChange={(e) => setAppointmentForm({ ...appointmentForm, memo: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50 resize-none h-20" placeholder="메모" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAddAppointment(false)} className="px-4 py-2 text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-2)] transition-colors">취소</button>
              <button onClick={handleAddAppointment} className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">추가</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: 상담 추가 ────────────────────────────────── */}
      {showAddConsultation && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowAddConsultation(false)}>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-lg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--c-text-1)] font-semibold text-base mb-4">상담 추가</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">고객 *</label>
                <CustomerPicker value={consultationForm.customer_id} onChange={(id) => setConsultationForm({ ...consultationForm, customer_id: id })} />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">상담 날짜 *</label>
                <input type="date" value={consultationForm.consultation_date} onChange={(e) => setConsultationForm({ ...consultationForm, consultation_date: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">상담 내용</label>
                <textarea value={consultationForm.content} onChange={(e) => setConsultationForm({ ...consultationForm, content: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50 resize-none h-24" placeholder="상담 내용을 입력하세요" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--c-text-3)] mb-1 block">견적</label>
                  <input type="text" value={consultationForm.estimate} onChange={(e) => setConsultationForm({ ...consultationForm, estimate: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="예: 350만원" />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-text-3)] mb-1 block">관심 시공</label>
                  <input type="text" value={consultationForm.interested_services} onChange={(e) => setConsultationForm({ ...consultationForm, interested_services: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="PPF, 썬팅 등" />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--c-text-3)] mb-1 block">메모</label>
                <input type="text" value={consultationForm.memo} onChange={(e) => setConsultationForm({ ...consultationForm, memo: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="메모" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAddConsultation(false)} className="px-4 py-2 text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-2)] transition-colors">취소</button>
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
      {showCalendarSub && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowCalendarSub(false)}>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-lg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--c-text-1)] font-semibold text-base mb-4">캘린더 구독</h3>
            <p className="text-xs text-[var(--c-text-3)] mb-3">아래 URL을 캘린더 앱에서 구독하면 예약 일정이 자동으로 동기화됩니다.</p>
            <div className="flex items-center gap-2 mb-4">
              <input readOnly value="https://proism-ai.vercel.app/api/calendar?token=proism2026" className="flex-1 bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-xs text-[var(--c-text-1)] outline-none select-all" onFocus={(e) => e.target.select()} />
              <button onClick={() => { navigator.clipboard.writeText('https://proism-ai.vercel.app/api/calendar?token=proism2026'); alert('URL이 복사되었습니다!'); }} className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-xs font-medium rounded-lg px-3 py-2 transition-colors whitespace-nowrap">URL 복사</button>
            </div>
            <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-4 text-xs text-[var(--c-text-2)] space-y-1.5">
              <div className="text-[#C8A951] font-medium mb-1">구독 방법</div>
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
      {showWarranty && warrantyAppointment && (
        <WarrantyModal
          warrantyForm={warrantyForm}
          setWarrantyForm={setWarrantyForm}
          onSave={handleSaveWarranty}
          onDownloaded={handleWarrantyDownloaded}
          onClose={() => { setShowWarranty(false); setWarrantyAppointment(null); }}
        />
      )}

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-[var(--c-input)]/80 backdrop-blur-sm border-t border-[var(--c-border)] py-1.5 px-4 text-center text-[10px] text-[var(--c-text-4)] z-10">
        3M 프로이즘 | 서초중앙로8길 82, 1동 1층 | 010-7287-7140 | poi_1357@naver.com
      </div>
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
      className="flex items-center gap-2 cursor-pointer text-sm text-[var(--c-text-1)] hover:text-[#C8A951] transition-colors select-none"
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
    <div className="border-t border-[var(--c-border)] pt-4 mt-4">
      <h4 className="text-sm font-semibold text-[#C8A951] mb-3">{title}</h4>
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
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
              <input type="text" value={workOrder.car_number} onChange={(e) => setWorkOrder({ ...workOrder, car_number: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="12가 3456" />
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
                    <input type="text" value={workOrder.tinting[brand].density} onChange={(e) => setTintingDensity(brand, e.target.value)} className="w-40 bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="전면 30 / 측후면 15" />
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
              <input type="text" value={workOrder.ppf_etc} onChange={(e) => setWorkOrder({ ...workOrder, ppf_etc: e.target.value })} className="w-full bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="기타 (직접 입력)" />
            </div>
            <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-3">
              <span className="text-xs font-medium text-[var(--c-text-2)] mb-2 block">랩핑</span>
              <div className="flex flex-wrap gap-3 mb-2">
                {['전체랩핑', '부분'].map((p) => (
                  <CheckItem key={p} label={p} checked={workOrder.wrapping.includes(p)} onChange={() => setWorkOrder({ ...workOrder, wrapping: toggleArray(workOrder.wrapping, p) })} />
                ))}
              </div>
              <input type="text" value={workOrder.wrapping_etc} onChange={(e) => setWorkOrder({ ...workOrder, wrapping_etc: e.target.value })} className="w-full bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="기타 (직접 입력)" />
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
              <input type="text" value={workOrder.electrical_etc} onChange={(e) => setWorkOrder({ ...workOrder, electrical_etc: e.target.value })} className="w-full bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="기타 (직접 입력)" />
            </div>
            <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-3">
              <span className="text-xs font-medium text-[var(--c-text-2)] mb-2 block">프리미엄광택</span>
              <div className="flex flex-wrap gap-3 mb-2">
                {['전체광택', '부분광택'].map((p) => (
                  <CheckItem key={p} label={p} checked={workOrder.polish.includes(p)} onChange={() => setWorkOrder({ ...workOrder, polish: toggleArray(workOrder.polish, p) })} />
                ))}
              </div>
              <input type="text" value={workOrder.polish_etc} onChange={(e) => setWorkOrder({ ...workOrder, polish_etc: e.target.value })} className="w-full bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50" placeholder="기타 (직접 입력)" />
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
            className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50 resize-none h-24"
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
          <button onClick={handlePdfSave} className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-sm font-medium rounded-lg px-5 py-2 transition-colors">PDF 저장</button>
          <button onClick={onSaveOnly} className="bg-[var(--c-subtle)] hover:bg-[var(--c-hover)] text-[var(--c-text-2)] text-sm font-medium rounded-lg px-5 py-2 transition-colors border border-[#2a2a2e]">저장만 하기</button>
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
  onDownloaded: () => Promise<void>;
  onClose: () => void;
}

function WarrantyModal({ warrantyForm, setWarrantyForm, onSave, onDownloaded, onClose }: WarrantyModalProps) {
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

  const inputClass = 'w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#22c55e]/50';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
            <label className="text-xs text-[var(--c-text-3)] mb-1 block">시공 내역</label>
            <textarea value={warrantyForm.work_details} onChange={(e) => setWarrantyForm({ ...warrantyForm, work_details: e.target.value })} className={`${inputClass} resize-none h-28`} placeholder={'그릴 랩핑 (3M 2080 글로스 블랙) ₩400,000\n루프 랩핑 (3M 2080 새틴 블랙) ₩600,000'} />
          </div>
          <div className="mt-3 px-1 py-2 border border-[#22c55e]/20 bg-[#22c55e]/5 rounded-lg text-center text-xs text-[#22c55e]">
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
                  {warrantyForm.work_details.split('\n').filter(Boolean).map((line, i) => {
                    const priceMatch = line.match(/(₩[\d,]+|[\d,]+원)/);
                    const detail = priceMatch ? line.replace(priceMatch[0], '').trim() : line.trim();
                    const amount = priceMatch ? priceMatch[0] : '';
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
                <div style={{ fontWeight: 700, marginBottom: '6px', color: '#E4002B' }}>[건적서 발행 참고 내용]</div>
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
          <button onClick={async () => { await onSave(); onClose(); }} className="bg-[var(--c-subtle)] hover:bg-[var(--c-hover)] text-[var(--c-text-2)] text-sm font-medium rounded-lg px-5 py-2 transition-colors border border-[#2a2a2e]">저장만 하기</button>
          <button onClick={handleDownloadPng} className="bg-[#22c55e] hover:bg-[#16a34a] text-white text-sm font-medium rounded-lg px-5 py-2 transition-colors">PNG 다운로드</button>
        </div>
      </div>
    </div>
  );
}
