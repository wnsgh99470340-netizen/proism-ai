'use client';

/** 고객 목록 탭 (2026-11-23 page.tsx 에서 분리 — 동작 변경 없음). 상태·핸들러는 page.tsx 에 있고 props 로 받는다 */
import { EMPTY_CUSTOMER_FORM, type CustomerFormValues } from '@/components/crm/CustomerFormModal';
import { useState } from 'react';
import { DEALER_KIND } from '@/lib/dealers';
import { isBlacklisted, blacklistInfo } from '@/lib/blacklist';
import type { Vehicle } from '@/lib/vehicles';
import { type Customer, formatDate } from '@/lib/crm-shared';

interface CustomersTabProps {
  customerSearch: string;
  setCustomerSearch: (v: string) => void;
  /** 검색어로 거른 고객 (page.tsx 에서 계산) */
  filteredCustomers: Customer[];
  vehiclesByCustomer: Map<string, Vehicle[]>;
  /** 딜러 id → 이름 (2026-11-23): 손님 줄에 "딜러 ○○○" 표시 */
  dealerNames?: Map<string, string>;
  router: { push: (href: string) => void };
  setCustomerForm: (form: CustomerFormValues) => void;
  setEditCustomerId: (id: string | null) => void;
  setShowAddCustomer: (v: boolean) => void;
  handleEditCustomer: (customer: Customer) => void;
  handleDeleteCustomer: (id: string, name: string) => void;
}

export default function CustomersTab({
  customerSearch, setCustomerSearch, filteredCustomers, vehiclesByCustomer, router, dealerNames,
  setCustomerForm, setEditCustomerId, setShowAddCustomer, handleEditCustomer, handleDeleteCustomer,
}: CustomersTabProps) {
  // 종류 필터 (2026-11-23): 전체 / 고객만 / 딜러만. 딜러가 한 명도 없으면 숨김
  const [kindFilter, setKindFilter] = useState<'all' | 'customer' | 'dealer'>('customer'); // 기본은 고객만 — 딜러 31명이 목록 맨 위를 차지하지 않게 (2026-11-23)
  const hasDealers = filteredCustomers.some((c) => c.kind === DEALER_KIND) || kindFilter !== 'customer';
  const rows = kindFilter === 'all' ? filteredCustomers : filteredCustomers.filter((c) => (c.kind === DEALER_KIND) === (kindFilter === 'dealer'));
  return (
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
          <span className="text-xs text-[var(--c-text-3)]">{rows.length}명</span>
          {hasDealers && (
            <div className="inline-flex rounded-lg border border-[var(--c-border)] overflow-hidden text-[11px] font-semibold">
              {([['customer', '고객'], ['dealer', '딜러'], ['all', '전체']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setKindFilter(k)} className={`px-2.5 py-1.5 transition-colors ${kindFilter === k ? 'bg-[var(--c-text-1)] text-[var(--c-card)]' : 'text-[var(--c-text-2)] hover:bg-[var(--c-subtle)]'}`}>{l}</button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => { setEditCustomerId(null); setCustomerForm({ ...EMPTY_CUSTOMER_FORM }); setShowAddCustomer(true); }}
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
            {rows.map((c) => (
              <tr
                key={c.id}
                onClick={() => router.push(`/crm/${c.id}`)}
                className="border-b border-[var(--c-border)] last:border-b-0 hover:bg-[var(--c-page)] cursor-pointer transition-colors group"
              >
                <td className="px-4 py-3 text-sm text-[var(--c-text-1)] font-medium">
                  {c.name}
                  {c.kind === DEALER_KIND && <span className="ml-1.5 text-[9px] bg-[var(--c-text-1)] text-[var(--c-card)] px-1.5 py-0.5 rounded-full font-semibold">딜러</span>}
                  {c.dealer_id && dealerNames?.get(c.dealer_id) && <span className="ml-1.5 text-[9px] bg-[var(--c-subtle)] text-[var(--c-text-3)] px-1.5 py-0.5 rounded-full font-medium" title="이 차를 넣어 준 딜러">딜러 {dealerNames.get(c.dealer_id)}</span>}
                  {isBlacklisted(c.memo) && <span className="ml-1.5 text-[9px] bg-danger/15 text-danger px-1.5 py-0.5 rounded-full font-semibold" title={blacklistInfo(c.memo)?.reason || ''}>⛔ 블랙리스트</span>}
                  {c.service_count >= 2 && <span className="ml-1.5 text-[9px] bg-gold/20 text-gold px-1.5 py-0.5 rounded-full font-medium">재방문</span>}
                  {(vehiclesByCustomer.get(c.id)?.length || 0) > 1 && <span className="ml-1 text-[9px] bg-info/15 text-info px-1.5 py-0.5 rounded-full font-medium">차 {vehiclesByCustomer.get(c.id)!.length}대</span>}
                </td>
                <td className="px-4 py-3 text-sm text-[var(--c-text-2)]">{c.phone || '-'}</td>
                <td className="px-4 py-3 text-sm text-[var(--c-text-2)]">
                  {c.kind === DEALER_KIND
                    ? <span className="text-[var(--c-text-3)]">{(c.memo || '').split('\n')[0] || '-'}</span>
                    : c.car_brand || c.car_model
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
            {rows.length === 0 && (
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
  );
}
