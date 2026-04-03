'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { useParams } from 'next/navigation';

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
}

interface Service {
  id: string;
  service_type: string;
  film_used: string | null;
  service_area: string | null;
  service_date: string | null;
  completion_date: string | null;
  amount: number | null;
  memo: string | null;
}

interface Consultation {
  id: string;
  consultation_date: string;
  content: string | null;
  estimate: string | null;
  interested_services: string | null;
  memo: string | null;
}

interface FollowUp {
  id: string;
  follow_up_type: string;
  scheduled_date: string;
  is_completed: boolean;
  completed_date: string | null;
  memo: string | null;
  service?: { service_type: string };
}

type DetailTab = 'services' | 'consultations' | 'followups';

const SERVICE_TYPE_OPTIONS = ['PPF', '컬러PPF', 'PWF', '랩핑', '크롬죽이기', '썬팅', '유리막코팅', '가죽코팅', '실내PPF', '신차패키지'];

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function CustomerDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [activeTab, setActiveTab] = useState<DetailTab>('services');

  // Service edit modal state
  const [editService, setEditService] = useState<Service | null>(null);
  const [serviceForm, setServiceForm] = useState({
    service_type: '', service_date: '', completion_date: '', amount: '', memo: '',
  });

  const handleEditService = (s: Service) => {
    setServiceForm({
      service_type: s.service_type || '',
      service_date: s.service_date || '',
      completion_date: s.completion_date || '',
      amount: s.amount ? String(s.amount) : '',
      memo: (() => {
        if (!s.memo) return '';
        try { const p = JSON.parse(s.memo); return (p && typeof p === 'object' && 'car_number' in p) ? '' : s.memo; } catch { return s.memo; }
      })(),
    });
    setEditService(s);
  };

  const handleUpdateService = async () => {
    if (!editService) return;
    await supabase.from('services').update({
      service_type: serviceForm.service_type,
      service_date: serviceForm.service_date || null,
      completion_date: serviceForm.completion_date || null,
      amount: serviceForm.amount ? Number(serviceForm.amount) : null,
      ...(serviceForm.memo ? { memo: serviceForm.memo } : {}),
    }).eq('id', editService.id);
    setEditService(null);
    fetchData();
  };

  const handleDeleteService = async (serviceId: string) => {
    if (!confirm('이 시공 이력을 삭제하시겠습니까?\n관련 사후관리도 함께 삭제됩니다.')) return;
    await supabase.from('follow_ups').delete().eq('service_id', serviceId);
    await supabase.from('services').delete().eq('id', serviceId);
    fetchData();
  };

  const fetchData = useCallback(async () => {
    const [{ data: c }, { data: s }, { data: con }, { data: f }] = await Promise.all([
      supabase.from('customers').select('*').eq('id', id).single(),
      supabase.from('services').select('*').eq('customer_id', id).order('service_date', { ascending: false }),
      supabase.from('consultations').select('*').eq('customer_id', id).order('consultation_date', { ascending: false }),
      supabase.from('follow_ups').select('*, service:services(service_type)').eq('customer_id', id).order('scheduled_date', { ascending: false }),
    ]);
    if (c) setCustomer(c);
    if (s) setServices(s);
    if (con) setConsultations(con);
    if (f) setFollowUps(f as FollowUp[]);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (!customer) {
    return (
      <div className="h-screen bg-[#09090b] flex items-center justify-center text-[#71717a] text-sm">
        불러오는 중...
      </div>
    );
  }

  const tabs: { key: DetailTab; label: string; count: number }[] = [
    { key: 'services', label: '시공 이력', count: services.length },
    { key: 'consultations', label: '상담 기록', count: consultations.length },
    { key: 'followups', label: '사후관리', count: followUps.length },
  ];

  return (
    <div className="h-screen flex flex-col bg-[#09090b]">
      {/* Header */}
      <div className="h-14 border-b border-[#1e1e22] bg-[#111113] flex items-center px-4 justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/crm" className="text-[#71717a] hover:text-[#fafaf9] transition-colors text-sm">
            ← CRM
          </Link>
          <span className="text-[#1e1e22]">|</span>
          <span className="text-[#fafaf9] font-semibold text-sm">{customer.name}</span>
          {customer.phone && <span className="text-[#71717a] text-xs">{customer.phone}</span>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Customer Info Card */}
        <div className="bg-[#111113] border border-[#1e1e22] rounded-xl p-5 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InfoItem label="차량" value={
              [customer.car_brand, customer.car_model].filter(Boolean).join(' ') || '-'
            } />
            <InfoItem label="연식" value={customer.car_year || '-'} />
            <InfoItem label="색상" value={customer.car_color || '-'} />
            <InfoItem label="유입경로" value={customer.source || '-'} />
            <InfoItem label="등록일" value={formatDate(customer.created_at)} />
            <InfoItem label="시공 횟수" value={`${services.length}회`} />
            <InfoItem label="총 매출" value={
              services.reduce((sum, s) => sum + (s.amount || 0), 0) > 0
                ? `${services.reduce((sum, s) => sum + (s.amount || 0), 0).toLocaleString()}원`
                : '-'
            } />
            {customer.memo && <InfoItem label="메모" value={customer.memo} />}
          </div>
        </div>

        {/* Detail Tabs */}
        <div className="border-b border-[#1e1e22] flex gap-0 mb-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === tab.key ? 'text-[#C8A951]' : 'text-[#71717a] hover:text-[#a1a1aa]'
              }`}
            >
              {tab.label} <span className="text-xs ml-1 opacity-60">{tab.count}</span>
              {activeTab === tab.key && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#C8A951]" />}
            </button>
          ))}
        </div>

        {/* Services Tab */}
        {activeTab === 'services' && (
          <div className="space-y-2">
            {services.map((s) => (
              <div key={s.id} className="bg-[#111113] border border-[#1e1e22] rounded-xl p-4 group">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#fafaf9]">{s.service_type}</span>
                    {s.amount != null && s.amount > 0 && <span className="text-xs text-[#C8A951]">{s.amount.toLocaleString()}원</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#71717a]">{formatDate(s.service_date)}{s.completion_date && ` → ${formatDate(s.completion_date)}`}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      <button onClick={() => handleEditService(s)} className="w-6 h-6 rounded flex items-center justify-center text-[#71717a] hover:text-[#C8A951] hover:bg-[#C8A951]/10 transition-all text-xs" title="수정">✎</button>
                      <button onClick={() => handleDeleteService(s.id)} className="w-6 h-6 rounded flex items-center justify-center text-[#71717a] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-all text-xs" title="삭제">✕</button>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-[#71717a]">
                  {s.film_used && <span>필름: {s.film_used}</span>}
                  {s.service_area && <span>부위: {s.service_area}</span>}
                  {s.memo && (() => {
                    try {
                      const wo = JSON.parse(s.memo);
                      if (wo && typeof wo === 'object' && 'car_number' in wo) {
                        const items: string[] = [];
                        if (wo.car_number) items.push(`차량번호: ${wo.car_number}`);
                        const allChecked: string[] = [];
                        if (wo.tinting) {
                          for (const [k, v] of Object.entries(wo.tinting) as [string, { selected?: string[]; density?: string }][]) {
                            if (v?.selected?.length) allChecked.push(`${k}(${v.selected.join(',')}${v.density ? ' ' + v.density : ''})`);
                          }
                        }
                        for (const key of ['ppf', 'wrapping', 'coating', 'electrical', 'polish', 'package_options'] as const) {
                          const arr = wo[key];
                          if (Array.isArray(arr) && arr.length) allChecked.push(...arr);
                        }
                        if (wo.electrical_etc) allChecked.push(wo.electrical_etc);
                        if (wo.polish_etc) allChecked.push(wo.polish_etc);
                        if (wo.ppf_etc) allChecked.push(wo.ppf_etc);
                        if (wo.wrapping_etc) allChecked.push(wo.wrapping_etc);
                        if (allChecked.length) items.push(`시공: ${allChecked.join(', ')}`);
                        if (wo.notes) items.push(`특이사항: ${wo.notes}`);
                        return <span>{items.join(' | ')}</span>;
                      }
                    } catch { /* not JSON */ }
                    return <span>메모: {s.memo}</span>;
                  })()}
                </div>
              </div>
            ))}
            {services.length === 0 && <Empty text="시공 이력이 없습니다" />}
          </div>
        )}

        {/* Consultations Tab */}
        {activeTab === 'consultations' && (
          <div className="space-y-2">
            {consultations.map((c) => (
              <div key={c.id} className="bg-[#111113] border border-[#1e1e22] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[#71717a]">{formatDate(c.consultation_date)}</span>
                  {c.estimate && <span className="text-xs text-[#C8A951]">견적: {c.estimate}</span>}
                </div>
                {c.content && <p className="text-sm text-[#a1a1aa] mb-2">{c.content}</p>}
                <div className="flex gap-3 text-xs text-[#71717a]">
                  {c.interested_services && <span>관심 시공: {c.interested_services}</span>}
                  {c.memo && <span>메모: {c.memo}</span>}
                </div>
              </div>
            ))}
            {consultations.length === 0 && <Empty text="상담 기록이 없습니다" />}
          </div>
        )}

        {/* Follow-ups Tab */}
        {activeTab === 'followups' && (
          <div className="space-y-2">
            {followUps.map((f) => {
              const today = new Date().toISOString().split('T')[0];
              const isOverdue = !f.is_completed && f.scheduled_date < today;
              return (
                <div key={f.id} className={`bg-[#111113] border rounded-xl p-4 ${
                  isOverdue ? 'border-[#EF4444]/30' : 'border-[#1e1e22]'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        f.follow_up_type === 'QC점검'
                          ? 'bg-[#3B82F6]/20 text-[#60A5FA]'
                          : 'bg-[#8B5CF6]/20 text-[#A78BFA]'
                      }`}>{f.follow_up_type}</span>
                      <span className="text-xs text-[#71717a]">{f.service?.service_type || ''}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#71717a]">{formatDate(f.scheduled_date)}</span>
                      {f.is_completed
                        ? <span className="text-xs text-[#10B981]">완료</span>
                        : isOverdue
                          ? <span className="text-xs text-[#EF4444]">지남</span>
                          : <span className="text-xs text-[#C8A951]">예정</span>
                      }
                    </div>
                  </div>
                  {f.memo && <p className="text-xs text-[#71717a] mt-1">{f.memo}</p>}
                </div>
              );
            })}
            {followUps.length === 0 && <Empty text="사후관리 내역이 없습니다" />}
          </div>
        )}
      </div>

      {/* Service Edit Modal */}
      {editService && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setEditService(null)}>
          <div className="bg-[#111113] border border-[#1e1e22] rounded-xl w-full max-w-lg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[#fafaf9] font-semibold text-base mb-4">시공 이력 수정</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">시공 종류</label>
                <select value={serviceForm.service_type} onChange={(e) => setServiceForm({ ...serviceForm, service_type: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50">
                  <option value="">선택...</option>
                  {SERVICE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#71717a] mb-1 block">시공일</label>
                  <input type="date" value={serviceForm.service_date} onChange={(e) => setServiceForm({ ...serviceForm, service_date: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" />
                </div>
                <div>
                  <label className="text-xs text-[#71717a] mb-1 block">완료일</label>
                  <input type="date" value={serviceForm.completion_date} onChange={(e) => setServiceForm({ ...serviceForm, completion_date: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" />
                </div>
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">금액</label>
                <input type="number" value={serviceForm.amount} onChange={(e) => setServiceForm({ ...serviceForm, amount: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50" placeholder="0" />
              </div>
              <div>
                <label className="text-xs text-[#71717a] mb-1 block">메모</label>
                <textarea value={serviceForm.memo} onChange={(e) => setServiceForm({ ...serviceForm, memo: e.target.value })} className="w-full bg-[#0d0d0f] border border-[#1e1e22] rounded-lg px-3 py-2 text-sm text-[#fafaf9] outline-none focus:border-[#C8A951]/50 resize-none h-20" placeholder="특이사항" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditService(null)} className="px-4 py-2 text-sm text-[#71717a] hover:text-[#a1a1aa] transition-colors">취소</button>
              <button onClick={handleUpdateService} className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[#71717a] mb-0.5">{label}</div>
      <div className="text-sm text-[#fafaf9]">{value}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-center py-12 text-sm text-[#71717a]">{text}</div>;
}
