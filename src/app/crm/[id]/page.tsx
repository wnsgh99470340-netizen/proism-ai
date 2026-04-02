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
              <div key={s.id} className="bg-[#111113] border border-[#1e1e22] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[#fafaf9]">{s.service_type}</span>
                  <div className="flex items-center gap-3 text-xs text-[#71717a]">
                    {s.amount && <span className="text-[#C8A951]">{s.amount.toLocaleString()}원</span>}
                    <span>{formatDate(s.service_date)}{s.completion_date && ` → ${formatDate(s.completion_date)}`}</span>
                  </div>
                </div>
                <div className="flex gap-3 text-xs text-[#71717a]">
                  {s.film_used && <span>필름: {s.film_used}</span>}
                  {s.service_area && <span>부위: {s.service_area}</span>}
                  {s.memo && <span>메모: {s.memo}</span>}
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
