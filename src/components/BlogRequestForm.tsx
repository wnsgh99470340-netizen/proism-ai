'use client';

import { useMemo, useState } from 'react';
import { CAR_BRANDS, REGIONS, SERVICES, buildBlogMessage, type BlogRequest, type ServiceKey } from '@/config/blog-options';

interface Props {
  disabled: boolean;
  onSubmit: (message: string, request: BlogRequest) => void;
}

const inputCls =
  'w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-2.5 py-2 text-xs text-[var(--c-text-1)] placeholder-[var(--c-text-4)] outline-none focus:border-[#C8A951]/60';
const labelCls = 'block text-[10px] text-[var(--c-text-3)] mb-1';

/**
 * 시공기 빠른 생성 폼.
 * 차량·시공·제품·지역만 고르면 리서치 → 작성까지 한 번에 돌아가는 메시지를 만든다.
 */
export default function BlogRequestForm({ disabled, onSubmit }: Props) {
  const [brand, setBrand] = useState<string>('BMW');
  const [customBrand, setCustomBrand] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [serviceKey, setServiceKey] = useState<ServiceKey>('PPF');
  const [range, setRange] = useState<string>(SERVICES[0].ranges[0]);
  const [product, setProduct] = useState<string>(SERVICES[0].products[0]);
  const [extra, setExtra] = useState('');
  const [region, setRegion] = useState<string>(REGIONS[0]);
  const [notes, setNotes] = useState('');

  const service = useMemo(() => SERVICES.find((s) => s.key === serviceKey)!, [serviceKey]);

  const changeService = (key: ServiceKey) => {
    const s = SERVICES.find((x) => x.key === key)!;
    setServiceKey(key);
    setRange(s.ranges[0]);
    setProduct(s.products[0] ?? '');
    setExtra('');
  };

  const finalBrand = brand === '기타' ? customBrand.trim() : brand;
  const canSubmit = !disabled && finalBrand.length > 0 && model.trim().length > 0 && (service.products.length === 0 ? extra.trim().length > 0 : product.length > 0);

  const submit = () => {
    if (!canSubmit) return;
    const req: BlogRequest = {
      brand: finalBrand,
      model: model.trim(),
      color: color.trim() || undefined,
      serviceKey,
      serviceLabel: service.label,
      range,
      product: service.products.length === 0 ? extra.trim() : product,
      extra: service.products.length === 0 ? undefined : (extra.trim() || undefined),
      region,
      notes: notes.trim() || undefined,
    };
    onSubmit(buildBlogMessage(req), req);
  };

  return (
    <div className="mx-4 mt-3 mb-1 bg-[var(--c-card)] border border-[#C8A951]/30 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-[var(--c-text-1)]">⚡ 시공기 빠른 생성</span>
        <span className="text-[10px] text-[var(--c-text-3)]">차량·시공·제품만 고르면 조사부터 초안까지 자동</span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2">
        <div>
          <label className={labelCls}>브랜드</label>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls}>
            {CAR_BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
            <option value="기타">기타(직접 입력)</option>
          </select>
          {brand === '기타' && (
            <input value={customBrand} onChange={(e) => setCustomBrand(e.target.value)} placeholder="브랜드명" className={`${inputCls} mt-1`} />
          )}
        </div>
        <div>
          <label className={labelCls}>모델명</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="예: M2, GLC, 모델Y" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>차량 색상 (선택)</label>
          <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="예: 블랙 사파이어" className={inputCls} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2">
        <div>
          <label className={labelCls}>시공 종류</label>
          <select value={serviceKey} onChange={(e) => changeService(e.target.value as ServiceKey)} className={inputCls}>
            {SERVICES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>시공 범위</label>
          <select value={range} onChange={(e) => setRange(e.target.value)} className={inputCls}>
            {service.ranges.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>지역 (제목·본문 키워드)</label>
          <select value={region} onChange={(e) => setRegion(e.target.value)} className={inputCls}>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div className={`grid ${service.extraLabel ? 'grid-cols-2' : 'grid-cols-1'} gap-2 mb-2`}>
        {service.products.length > 0 && (
          <div>
            <label className={labelCls}>제품</label>
            <select value={product} onChange={(e) => setProduct(e.target.value)} className={inputCls}>
              {service.products.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}
        {service.extraLabel && (
          <div>
            <label className={labelCls}>{service.extraLabel}</label>
            <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={service.extraPlaceholder} className={inputCls} />
          </div>
        )}
      </div>

      <div className="mb-2">
        <label className={labelCls}>참고 메모 (선택) — 고객 요청, 까다로웠던 부위, 입고 상황 등. 여기 적은 것만 글에 반영됩니다</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="예: 신차 출고 직후 입고. 프론트 립 하단이 까다로웠음"
          className={`${inputCls} resize-none`}
        />
      </div>

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="w-full bg-[#E4002B] hover:bg-[#c60026] disabled:bg-[var(--c-subtle)] disabled:text-[var(--c-text-3)] text-white text-xs font-semibold py-2.5 rounded-lg transition-colors"
      >
        {disabled ? '작성 중...' : '🔎 조사 → ✍️ 시공기 생성'}
      </button>
    </div>
  );
}
