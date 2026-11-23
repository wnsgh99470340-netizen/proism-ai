'use client';

/** 상담 기록 탭 (2026-11-23 page.tsx 에서 분리 — 동작 변경 없음). 상태·핸들러는 page.tsx 에 있고 props 로 받는다 */
import type { QuoteSmsInitial } from '@/components/crm/QuoteSmsModal';
import { hideRefToken } from '@/components/crm/ReferrerPicker';
import { type Customer, type Consultation, formatDate } from '@/lib/crm-shared';

interface ConsultationsTabProps {
  consultations: Consultation[];
  customers: Customer[];
  handleAddCustomerFromQuote: (who: string) => void;
  setQuoteSms: (v: QuoteSmsInitial | null) => void;
  setShowInquiry: (v: boolean) => void;
  setShowAddConsultation: (v: boolean) => void;
}

export default function ConsultationsTab({ consultations, customers, handleAddCustomerFromQuote, setQuoteSms, setShowInquiry, setShowAddConsultation }: ConsultationsTabProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">{/* 폰에서 버튼 글자가 세로로 깨지던 것 (2026-11-23) */}
        <h2 className="text-sm text-[var(--c-text-3)] whitespace-nowrap">{consultations.length}건의 상담</h2>
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
                  className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${c.memo === '회원 문자' ? 'hidden' : 'bg-gold/10 hover:bg-gold/20 text-gold'}`}
                >
                  📩 견적 문자
                </button>
                {c.memo === '회원 문자' && <span className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-ok/10 text-ok" title="회원 링크·소개 감사 문자를 보내면 자동으로 남는 기록입니다">🔗 회원 문자</span>}
                <span className="text-xs text-[var(--c-text-3)]">{formatDate(c.consultation_date)}</span>
              </div>
            </div>
            {c.content && (/^\[(견적 문자 발송|문의 답변|회원 문자)\]/.test(c.content)
              ? <details className="mb-2 text-sm text-[var(--c-text-2)]"><summary className="cursor-pointer">{c.content.split('\n')[0]} — {c.content.startsWith('[회원 문자]') ? '자동 기록 · 링크 보기' : '보낸 문자 보기'}</summary><pre className="whitespace-pre-wrap font-sans mt-2 text-xs text-[var(--c-text-2)] bg-[var(--c-input)] rounded-lg p-3">{c.content.split('\n').slice(1).join('\n')}</pre></details>
              : <p className="text-sm text-[var(--c-text-2)] mb-2">{c.content}</p>)}
            <div className="flex items-center gap-3 text-xs text-[var(--c-text-3)]">
              {c.estimate && <span>견적: <span className="text-gold">{c.estimate}</span></span>}
              {c.interested_services && <span>관심: <span className="text-[var(--c-text-2)]">{c.interested_services}</span></span>}
              {c.memo && c.memo !== '회원 문자' && <span>메모: {hideRefToken(c.memo).split(' · ').filter((seg) => !seg.startsWith('사진: ')).join(' · ') || '-'}</span>}
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
  );
}
