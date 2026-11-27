'use client';

import { useRef, useState } from 'react';
import Btn from '@/components/ui/Btn';
import { resizeAndUploadPhoto } from '@/lib/photo-upload';
import { todaySeoul } from '@/lib/local-date';
import type { Appointment } from '@/lib/crm-shared';
import { PPF_PRODUCT_OPTIONS, ppfOptionLabel } from '@/lib/work-order';
import WorkSheet from '@/components/WorkSheet';

/** 작업 내역서 창 (2026-11-23 page.tsx 에서 분리 — 동작 변경 없음) */
// ─── Work Order Modal Component ──────────────────────────
interface WorkOrderModalProps {
  appointment: Appointment;
  workOrder: ReturnType<typeof Object>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setWorkOrder: (v: any) => void;
  onSubmit: () => void;
  onSaveOnly: () => void;
  onClose: () => void;
  /** 완료 처리 진행 중 — 버튼 잠금 (이중 제출 방지) */
  busy?: boolean;
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

const PHOTO_MAX = 4;
/** 사진 칸 하나 (2026-11-27) — 작은 썸네일 + 고르기 버튼. 최대 4장(예전 기록이 더 많으면 그대로 두고 추가만 막음) */
function PhotoSlot({ title, hint, urls, busy, onPick, onRemove }: { title: string; hint: string; urls: string[]; busy: boolean; onPick: (f: FileList | null) => void; onRemove: (u: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label className="text-xs font-semibold text-[var(--c-text-1)]">{title} <span className="font-normal text-[var(--c-text-3)]">최대 {PHOTO_MAX}장 · {hint}</span></label>
        <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
        <Btn size="sm" variant="outline" icon="camera" onClick={() => ref.current?.click()} disabled={busy || urls.length >= PHOTO_MAX}>{busy ? '올리는 중…' : '사진 고르기'}</Btn>
      </div>
      {urls.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {urls.map((u) => (
            <div key={u} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={title} className="w-16 h-16 object-cover rounded-lg border border-[var(--c-border)]" />
              <button type="button" onClick={() => onRemove(u)} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--c-text-1)] text-[var(--c-card)] text-[10px] leading-none flex items-center justify-center" aria-label="사진 빼기">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WorkOrderModal({ appointment, workOrder, setWorkOrder, onSubmit, onSaveOnly, onClose, busy }: WorkOrderModalProps & { workOrder: any }) {
  const printRef = useRef<HTMLDivElement>(null);
  const [photoBusy, setPhotoBusy] = useState<'' | 'photos' | 'photos_internal'>('');
  // 사진 칸 둘 (2026-11-27 사장님): photos = 출고 사진(손님·딜러 페이지에 보임), photos_internal = 입고 상태 사진(내부용, CRM 안에서만). 칸마다 최대 4장
  const uploadPhotos = async (key: 'photos' | 'photos_internal', files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPhotoBusy(key);
    try {
      let next: string[] = [...((workOrder[key] as string[] | undefined) || [])];
      for (const f of Array.from(files).slice(0, Math.max(0, PHOTO_MAX - next.length))) {
        const r = await resizeAndUploadPhoto(f);
        if ('error' in r) { alert(r.error); continue; }
        next = [...next, r.url];
      }
      setWorkOrder({ ...workOrder, [key]: next });
    } finally { setPhotoBusy(''); }
  };

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
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">메인터넌스 기간 *</label>
              <select value={workOrder.maintenance_years || ''} onChange={(e) => setWorkOrder({ ...workOrder, maintenance_years: e.target.value })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50 mb-3" title="이 기간 동안 6개월마다 메인터넌스를 잡고, 보증서 기간으로도 들어갑니다">
                <option value="">선택</option>
                {['2', '3', '4', '5', '7', '10'].map((y) => <option key={y} value={y}>{y}년</option>)}
              </select>
              <label className="text-xs text-[var(--c-text-3)] mb-1 block">금액 (원)</label>
              <input type="text" inputMode="numeric" value={workOrder.amount ? Number(String(workOrder.amount).replace(/[^\d]/g, '') || 0).toLocaleString() : ''} onChange={(e) => setWorkOrder({ ...workOrder, amount: e.target.value.replace(/[^\d]/g, '') })} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder={appointment.amount ? Number(appointment.amount).toLocaleString() : '예: 5,500,000'} />
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
            {/* 기타 필름: 네 브랜드에 없는 필름을 받아와 시공한 경우 — 제품명 수기 + 농도 (2026-11-26 사장님) */}
            <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-3">
              <div className="flex items-center justify-between mb-2 gap-3">
                <span className="text-xs font-medium text-[var(--c-text-2)] whitespace-nowrap">기타 필름</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-[var(--c-text-3)]">농도:</span>
                  <input type="text" value={workOrder.tint_other?.density || ''} onChange={(e) => setWorkOrder({ ...workOrder, tint_other: { ...(workOrder.tint_other || {}), density: e.target.value } })} className="w-40 bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="전면 30 / 측후면 15" />
                </div>
              </div>
              <input type="text" value={workOrder.tint_other?.name || ''} onChange={(e) => setWorkOrder({ ...workOrder, tint_other: { ...(workOrder.tint_other || {}), name: e.target.value } })} className="w-full bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="브랜드·제품명 직접 기입 (예: 3M 크리스탈라인 70)" />
            </div>
          </div>

          {/* PPF & 랩핑 */}
          <SectionTitle title="PPF & 컬러PPF & 랩핑" />
          <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-3">
              <span className="text-xs font-medium text-[var(--c-text-2)] mb-2 block">PPF</span>
              <div className="flex flex-wrap gap-3 mb-2">
                {['전체PPF', '프론트패키지', '생활보호패키지'].map((p) => (
                  <CheckItem key={p} label={p} checked={workOrder.ppf.includes(p)} onChange={() => setWorkOrder({ ...workOrder, ppf: toggleArray(workOrder.ppf, p) })} />
                ))}
              </div>
              <label className="text-[11px] text-[var(--c-text-3)] mb-1 block">제품</label>
              <select value={workOrder.ppf_product || ''} onChange={(e) => setWorkOrder({ ...workOrder, ppf_product: e.target.value })} className="w-full bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1.5 text-xs text-[var(--c-text-1)] outline-none focus:border-[var(--c-text-1)] mb-2">
                <option value="">선택 (PPF 를 했으면 고르기)</option>
                {PPF_PRODUCT_OPTIONS.map((p) => <option key={p} value={p}>{ppfOptionLabel(p)}</option>)}
              </select>
              <input type="text" value={workOrder.ppf_etc} onChange={(e) => setWorkOrder({ ...workOrder, ppf_etc: e.target.value })} className="w-full bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="기타 (메모 — 제품은 위에서 선택)" />
            </div>
            <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-3">
              <span className="text-xs font-medium text-[var(--c-text-2)] mb-2 block">컬러PPF</span>
              <div className="flex flex-wrap gap-3 mb-2">
                {['전체', '부분', '투톤'].map((p) => (
                  <CheckItem key={p} label={p} checked={(workOrder.color_ppf || []).includes(p)} onChange={() => setWorkOrder({ ...workOrder, color_ppf: toggleArray(workOrder.color_ppf || [], p) })} />
                ))}
              </div>
              <input type="text" value={workOrder.color_ppf_etc || ''} onChange={(e) => setWorkOrder({ ...workOrder, color_ppf_etc: e.target.value })} className="w-full bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-[var(--c-text-1)]" placeholder="제품명 직접 기입 (예: PWF 매트블랙)" />
            </div>
            <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-3">
              <span className="text-xs font-medium text-[var(--c-text-2)] mb-2 block">랩핑</span>
              <div className="flex flex-wrap gap-3 mb-2">
                {['전체랩핑', '부분'].map((p) => (
                  <CheckItem key={p} label={p} checked={workOrder.wrapping.includes(p)} onChange={() => setWorkOrder({ ...workOrder, wrapping: toggleArray(workOrder.wrapping, p) })} />
                ))}
              </div>
              <input type="text" value={workOrder.wrapping_etc} onChange={(e) => setWorkOrder({ ...workOrder, wrapping_etc: e.target.value })} className="w-full bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="기타 · 제품명 직접 기입 (예: 2080 사틴블랙)" />
            </div>
            {/* 기타 시공: PPF·컬러PPF·랩핑 밖의 작업 (2026-11-26 사장님 "윈드쉴드 같은 시공도 가끔") */}
            <div className="bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg p-3">
              <span className="text-xs font-medium text-[var(--c-text-2)] mb-2 block">기타 시공</span>
              <input type="text" value={workOrder.other_work || ''} onChange={(e) => setWorkOrder({ ...workOrder, other_work: e.target.value })} className="w-full bg-[var(--c-card)] border border-[var(--c-border)] rounded px-2 py-1 text-xs text-[var(--c-text-1)] outline-none focus:border-gold/50" placeholder="예: 윈드쉴드 보호필름" />
              <div className="text-[11px] text-[var(--c-text-4)] mt-1.5">증명서에 '기타' 항목으로 그대로 들어갑니다</div>
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
          <WorkSheet ref={printRef} workOrder={workOrder} head={{ date: new Date().toLocaleDateString('ko-KR'), car: appointment.service_type, plate: workOrder.car_number, name: appointment.customer?.name, source: null, phone: appointment.customer?.phone }} />

          {/* 작업 사진·현장 메모 (2026-11-25 사장님 "완료 처리 때 사진 서너 장" → 2026-11-27 입고 상태(내부)·출고(공개) 둘로, 과정 사진은 드라이브에 따로): 현장 메모는 시공기 폼에 미리 채워진다 */}
          <div className="mt-5 border-t border-[var(--c-border)] pt-4">
            <PhotoSlot title="입고 상태 사진" hint="내부용 — 손님·딜러에게 안 보임 · 문제 부위 기록" urls={(workOrder.photos_internal as string[] | undefined) || []} busy={photoBusy === 'photos_internal'} onPick={(f) => uploadPhotos('photos_internal', f)} onRemove={(u) => setWorkOrder({ ...workOrder, photos_internal: ((workOrder.photos_internal as string[] | undefined) || []).filter((x) => x !== u) })} />
            <PhotoSlot title="출고 사진" hint="손님 페이지·딜러 페이지에 보임 (번호판·얼굴은 가려서)" urls={(workOrder.photos as string[] | undefined) || []} busy={photoBusy === 'photos'} onPick={(f) => uploadPhotos('photos', f)} onRemove={(u) => setWorkOrder({ ...workOrder, photos: ((workOrder.photos as string[] | undefined) || []).filter((x) => x !== u) })} />
            <label className="text-xs font-semibold text-[var(--c-text-1)] mb-1 block">현장 메모 <span className="font-normal text-[var(--c-text-3)]">이 차에서 있었던 일 한두 줄 — 시공기 쓸 때 그대로 재료가 됩니다</span></label>
            <textarea value={workOrder.field_note || ''} onChange={(e) => setWorkOrder({ ...workOrder, field_note: e.target.value })} rows={3} placeholder="예: 딜러 통해 입고. 본넷 끝단이 깊어 안쪽 마감에 시간이 갔고, 손님은 출고 때 도어 끝부터 보셨음" className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[var(--c-text-1)] resize-none" />
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-[var(--c-card)] border-t border-[var(--c-border)] px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-2)] transition-colors">취소</button>
          <button onClick={handlePdfSave} className="bg-info hover:bg-info text-white text-sm font-medium rounded-lg px-5 py-2 transition-colors">PDF 저장</button>
          <button onClick={onSaveOnly} className="bg-[var(--c-subtle)] hover:bg-[var(--c-hover)] text-[var(--c-text-2)] text-sm font-medium rounded-lg px-5 py-2 transition-colors border border-[var(--c-border)]">저장만 하기</button>
          <button onClick={onSubmit} disabled={busy} className="bg-brand hover:bg-brand-dark disabled:opacity-50 disabled:cursor-wait text-white text-sm font-medium rounded-lg px-6 py-2 transition-colors">{busy ? '처리 중…' : '시공 완료 처리'}</button>
        </div>
      </div>
    </div>
  );
}

