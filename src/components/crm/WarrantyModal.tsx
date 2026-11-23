'use client';

import { useRef, useState } from 'react';
import { todaySeoul } from '@/lib/local-date';

/** 보증서 창 (2026-11-23 page.tsx 에서 분리 — 동작 변경 없음) */
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

export default function WarrantyModal({ warrantyForm, setWarrantyForm, onSave, onDownloaded, onClose }: WarrantyModalProps) {
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
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">보증·메인터넌스 기간</label>
              <select value={warrantyForm.warranty_period} onChange={(e) => setWarrantyForm({ ...warrantyForm, warranty_period: e.target.value })} className={inputClass}>
                {!['2', '3', '4', '5', '7', '10'].some((y) => warrantyForm.warranty_period === `시공일로부터 ${y}년`) && <option value={warrantyForm.warranty_period}>{warrantyForm.warranty_period || '선택'}</option>}
                {['2', '3', '4', '5', '7', '10'].map((y) => <option key={y} value={`시공일로부터 ${y}년`}>시공일로부터 {y}년</option>)}
              </select>
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

