'use client';

import { useState, useEffect, useCallback } from 'react';
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
  customer?: { name: string };
  service?: { service_type: string };
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

type Tab = 'customers' | 'appointments' | 'followups' | 'consultations';

const SERVICE_TYPES = ['PPF', '컬러PPF', 'PWF', '랩핑', '크롬죽이기', '썬팅', '유리막코팅', '가죽코팅', '실내PPF', '신차패키지'];
const APPOINTMENT_STATUSES = ['상담중', '예약확정', '시공중', '완료'];
const FOLLOW_UP_TYPES = ['QC점검', '메인터넌스'];

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
  const [customerForm, setCustomerForm] = useState({
    name: '', phone: '', car_brand: '', car_model: '', car_year: '', car_color: '', source: '', memo: '',
    appointment_date: '', appointment_service_type: '', appointment_memo: '',
  });

  // Appointment state
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [showAddAppointment, setShowAddAppointment] = useState(false);
  const [appointmentForm, setAppointmentForm] = useState({
    customer_id: '', appointment_date: '', service_type: '', memo: '',
  });

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
      .select('*, customer:customers(name), service:services(service_type)')
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
    console.log('[CRM] appointment_date:', formData.appointment_date);
    console.log('[CRM] appointment_service_type:', formData.appointment_service_type);

    // 2. 예약 생성
    let appointmentForWorkOrder: Appointment | null = null;
    const hasDateAndType = !!(formData.appointment_date && formData.appointment_service_type);

    console.log('[CRM] hasDateAndType:', hasDateAndType);

    if (hasDateAndType) {
      const { data: apptData, error: apptError } = await supabase
        .from('appointments')
        .insert({
          customer_id: customerId,
          appointment_date: formData.appointment_date,
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
    } else if (formData.appointment_date) {
      await supabase.from('appointments').insert({
        customer_id: customerId,
        appointment_date: formData.appointment_date,
        service_type: null,
        status: '상담중',
        memo: formData.appointment_memo || null,
      });
    }

    // 3. 폼 리셋 + 모달 닫기
    setCustomerForm({ name: '', phone: '', car_brand: '', car_model: '', car_year: '', car_color: '', source: '', memo: '', appointment_date: '', appointment_service_type: '', appointment_memo: '' });
    setShowAddCustomer(false);
    fetchCustomers();
    fetchAllCustomers();
    fetchAppointments();

    // 4. 작업 내역서 모달 또는 알림
    console.log('[CRM] appointmentForWorkOrder:', JSON.stringify(appointmentForWorkOrder));

    if (hasDateAndType && appointmentForWorkOrder) {
      console.log('[CRM] 작업 내역서 모달 열기!');
      resetWorkOrder();
      setWorkOrderAppointment(appointmentForWorkOrder);
      setTimeout(() => setShowWorkOrder(true), 200);
    } else if (formData.appointment_date) {
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
      service_type: appointmentForm.service_type || null,
      memo: appointmentForm.memo || null,
    });
    setAppointmentForm({ customer_id: '', appointment_date: '', service_type: '', memo: '' });
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
                onClick={() => setShowAddCustomer(true)}
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
                    <th className="w-10"></th>
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
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteCustomer(c.id, c.name); }}
                          className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded flex items-center justify-center text-[#71717a] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-all text-xs"
                          title="삭제"
                        >✕</button>
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
        {activeTab === 'appointments' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm text-[#71717a]">{appointments.length}건의 예약</h2>
              <button
                onClick={() => setShowAddAppointment(true)}
                className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
              >
                + 예약 추가
              </button>
            </div>

            <div className="space-y-2">
              {appointments.map((a) => {
                const isToday = a.appointment_date === today;
                const isPast = a.appointment_date < today;
                const borderClass = a.status === '완료'
                  ? 'border-[#1e1e22]'
                  : isToday
                    ? 'border-[#C8A951]/40'
                    : isPast
                      ? 'border-[#EF4444]/20'
                      : 'border-[#1e1e22]';
                const opacityClass = a.status === '완료' ? 'opacity-50' : isPast && a.status !== '완료' ? 'opacity-60' : '';
                // memo가 JSON 작업 내역서인지 판별
                let memoDisplay = a.memo;
                try { if (a.memo && JSON.parse(a.memo)?.car_number !== undefined) memoDisplay = null; } catch { /* not JSON */ }

                return (
                  <div key={a.id} className={`bg-[#111113] border rounded-xl p-4 flex items-center justify-between group ${borderClass} ${opacityClass}`}>
                    <div className="flex items-center gap-4">
                      <div className="text-center min-w-[60px]">
                        <div className={`text-lg font-bold ${isToday ? 'text-[#C8A951]' : 'text-[#fafaf9]'}`}>
                          {new Date(a.appointment_date).getDate()}
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
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor(a.status)}`}>
                        {a.status}
                      </span>
                      <button
                        onClick={() => handleOpenWorkOrder(a)}
                        className="bg-[#C8A951]/10 hover:bg-[#C8A951]/20 text-[#C8A951] text-xs font-medium rounded-lg px-2.5 py-1 transition-colors"
                      >
                        작업 내역서
                      </button>
                      {a.status !== '완료' && (
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) handleStatusChange(a, e.target.value);
                          }}
                          className="bg-[#1e1e22] border border-[#2a2a2e] rounded-lg px-2 py-1 text-xs text-[#a1a1aa] outline-none cursor-pointer"
                        >
                          <option value="">상태 변경</option>
                          {APPOINTMENT_STATUSES.filter((s) => s !== a.status).map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      )}
                      <button
                        onClick={() => handleDeleteAppointment(a.id)}
                        className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded flex items-center justify-center text-[#71717a] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-all text-xs"
                        title="삭제"
                      >✕</button>
                    </div>
                  </div>
                );
              })}
              {appointments.length === 0 && (
                <div className="text-center py-12 text-sm text-[#71717a]">등록된 예약이 없습니다</div>
              )}
            </div>
          </div>
        )}

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
              {filteredFollowUps.map((f) => (
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
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          f.follow_up_type === 'QC점검'
                            ? 'bg-[#3B82F6]/20 text-[#60A5FA]'
                            : 'bg-[#8B5CF6]/20 text-[#A78BFA]'
                        }`}>
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
                </div>
              ))}
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
      </div>

      {/* ─── Modal: 고객 추가 ────────────────────────────────── */}
      {showAddCustomer && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowAddCustomer(false)}>
          <div className="bg-[#111113] border border-[#1e1e22] rounded-xl w-full max-w-lg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[#fafaf9] font-semibold text-base mb-4">고객 추가</h3>
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
              <div className="col-span-2 border-t border-[#1e1e22] pt-3 mt-1">
                <div className="text-xs text-[#C8A951] font-medium mb-2">예약 정보 (선택)</div>
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">예약일</label>
                <input type="date" value={customerForm.appointment_date} onChange={(e) => setCustomerForm({ ...customerForm, appointment_date: e.target.value })} onInput={(e) => setCustomerForm({ ...customerForm, appointment_date: (e.target as HTMLInputElement).value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" />
              </div>
              <div>
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
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAddCustomer(false)} className="px-4 py-2 text-sm text-[#71717a] hover:text-[#a1a1aa] transition-colors">취소</button>
              <button onClick={handleAddCustomer} className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">추가</button>
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
                <label className="text-xs text-[#71717a] mb-1 block">예약 날짜 *</label>
                <input type="date" value={appointmentForm.appointment_date} onChange={(e) => setAppointmentForm({ ...appointmentForm, appointment_date: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" />
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

        {/* Footer */}
        <div className="sticky bottom-0 bg-[#111113] border-t border-[#1e1e22] px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#71717a] hover:text-[#a1a1aa] transition-colors">취소</button>
          <button onClick={onSaveOnly} className="bg-[#1e1e22] hover:bg-[#2a2a2e] text-[#a1a1aa] text-sm font-medium rounded-lg px-5 py-2 transition-colors border border-[#2a2a2e]">저장만 하기</button>
          <button onClick={onSubmit} className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-6 py-2 transition-colors">시공 완료 처리</button>
        </div>
      </div>
    </div>
  );
}
