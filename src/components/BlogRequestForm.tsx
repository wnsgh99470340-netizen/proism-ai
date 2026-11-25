'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CAR_BRANDS, REGIONS, SERVICES, buildBlogMessage, type BlogRequest, type BlogPrefill, type ServiceKey, FAQ_SERVICE_OPTIONS } from '@/config/blog-options';
import { INQUIRY_FAQS } from '@/config/inquiry-faq';
import { OPENING_IDEAS, pickOpeningIdeas, type OpeningIdea } from '@/config/blog-opening-ideas';

interface Props {
  disabled: boolean;
  onSubmit: (message: string, request: BlogRequest) => void;
  /** CRM 시공 기록에서 넘어온 값. 있으면 차량·시공은 채우고 메모 칸에 포커스 */
  initial?: BlogPrefill | null;
}

const inputCls =
  'w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-2.5 py-2 text-xs text-[var(--c-text-1)] placeholder-[var(--c-text-4)] outline-none focus:border-gold/60 min-h-[36px]';
const labelCls = 'block text-[10px] text-[var(--c-text-3)] mb-1';

/**
 * 시공기 빠른 생성 폼.
 * 차량·시공·제품·지역만 고르면 리서치 → 작성까지 한 번에 돌아가는 메시지를 만든다.
 */
export default function BlogRequestForm({ disabled, onSubmit, initial = null }: Props) {
  const initService = SERVICES.find((x) => x.key === initial?.serviceKey) ?? SERVICES[0];
  const knownBrand = initial?.brand && (CAR_BRANDS as readonly string[]).includes(initial.brand);
  const [brand, setBrand] = useState<string>(initial?.brand ? (knownBrand ? initial.brand : '기타') : 'BMW');
  const [customBrand, setCustomBrand] = useState(initial?.brand && !knownBrand ? initial.brand : '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [color, setColor] = useState(initial?.color ?? '');
  const [serviceKey, setServiceKey] = useState<ServiceKey>(initService.key);
  const [range, setRange] = useState<string>(initial?.range && initService.ranges.includes(initial.range) ? initial.range : initService.ranges[0]);
  // CRM에서 넘어온 경우 제품 등급은 기록에 없으므로 비워두고 직접 고르게 한다 (임의 제품명 방지)
  const [product, setProduct] = useState<string>(initial ? (initial.product ?? '') : SERVICES[0].products[0]);
  const [extra, setExtra] = useState(initial?.extra ?? '');
  const [region, setRegion] = useState<string>(REGIONS[0]);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [keyword, setKeyword] = useState('');
  const [photosUrl, setPhotosUrl] = useState('');
  const [refLinks, setRefLinks] = useState('');
  // 글 종류 (2026-11-21 사장님: 이 기능은 FAQ·공지, 시공기는 마케팅 실장) — 기본 FAQ
  const [mode, setMode] = useState<'work' | 'faq'>(initial ? 'work' : 'faq');
  const [topic, setTopic] = useState('');
  const [faqService, setFaqService] = useState<string>('PPF');
  const [vertical, setVertical] = useState(false);
  // 도입 아이디어(2026-11-25): 세 블로그에서 추린 방식 3개를 보여 주고, 고르면 요청문에 한 줄만 붙인다
  const [ideas, setIdeas] = useState<OpeningIdea[]>(() => pickOpeningIdeas(3));
  const [opening, setOpening] = useState<string>('');
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initial) notesRef.current?.focus();
  }, [initial]);

  const service = useMemo(() => SERVICES.find((s) => s.key === serviceKey)!, [serviceKey]);

  const changeService = (key: ServiceKey) => {
    const s = SERVICES.find((x) => x.key === key)!;
    setServiceKey(key);
    setRange(s.ranges[0]);
    setProduct(s.products[0] ?? '');
    setExtra('');
  };

  const finalBrand = brand === '기타' ? customBrand.trim() : brand;
  const photosUrlTrim = photosUrl.trim();
  const photosUrlOk = photosUrlTrim === '' || /^https?:\/\/drive\.google\.com\//.test(photosUrlTrim);
  const canSubmitWork = !disabled && finalBrand.length > 0 && model.trim().length > 0 && (service.products.length === 0 ? extra.trim().length > 0 : product.length > 0) && photosUrlOk;
  const canSubmit = mode === 'faq' ? (!disabled && topic.trim().length >= 3) : canSubmitWork;

  const submit = () => {
    if (!canSubmit) return;
    if (mode === 'faq') {
      const req: BlogRequest = {
        brand: '', model: '', serviceKey: 'PPF', serviceLabel: faqService, range: '', product: '',
        region, notes: notes.trim() || undefined, keyword: keyword.trim() || undefined,
        refLinks: (refLinks.match(/https?:\/\/[^\s]+/g) || []).slice(0, 3),
        kind: 'faq', topic: topic.trim(),
      };
      onSubmit(buildBlogMessage(req), req);
      return;
    }
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
      keyword: keyword.trim() || undefined,
      photosUrl: photosUrlTrim || undefined,
      vertical: photosUrlTrim ? vertical : undefined,
      refLinks: (refLinks.match(/https?:\/\/[^\s]+/g) || []).slice(0, 3),
      opening: opening ? (() => { const o = OPENING_IDEAS.find(i => i.key === opening); return o ? `${o.label} — ${o.hint}` : undefined; })() : undefined,
    };
    onSubmit(buildBlogMessage(req), req);
  };

  return (
    <div className="@container mx-3 md:mx-4 mt-3 mb-1 bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={() => setMode('faq')} className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${mode === 'faq' ? 'bg-[var(--c-text-1)] text-[var(--c-card)] border-transparent' : 'border-[var(--c-border)] text-[var(--c-text-2)] hover:bg-[var(--c-subtle)]'}`}>FAQ·공지 글</button>
          <button type="button" onClick={() => setMode('work')} className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${mode === 'work' ? 'bg-[var(--c-text-1)] text-[var(--c-card)] border-transparent' : 'border-[var(--c-border)] text-[var(--c-text-2)] hover:bg-[var(--c-subtle)]'}`}>시공기</button>
        </div>
        <span className="text-[10px] text-[var(--c-text-3)] hidden @sm:inline truncate">{mode === 'faq' ? '손님 질문 하나를 적으면 조사 → 사실표 확인 → 글' : '차량·시공·제품만 고르면 조사부터 초안까지 자동'}</span>
      </div>

      {initial && (
        <div className="mb-2 rounded-lg border border-gold/40 bg-gold/10 px-2.5 py-2 text-[11px] text-[var(--c-text-1)] leading-relaxed">
          📋 {initial.source || 'CRM'}에서 가져왔습니다. <b>제품 등급을 확인</b>하고, 아래 <b>참고 메모에 그 차의 이야기 두세 줄</b>(입고 상황·고객 요청·특이 부위)을 적은 뒤 생성하세요. 메모에 적은 것만 글에 들어갑니다.
        </div>
      )}
      {mode === 'faq' && (
        <div className="mb-2">
          <label className={labelCls}>주제·질문 — 손님이 실제로 묻는 말로 적을수록 좋습니다</label>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={2}
            placeholder="예: 앞유리 썬팅 15%로 해도 되나요? / 테슬라 루프 유리도 썬팅하나요? / PPF 시리즈50과 150은 뭐가 다른가요?"
            className={`${inputCls} resize-none`}
          />
          {/* 자주 묻는 질문에서 고르기 (2026-11-22): 문의 답변과 같은 목록(src/config/inquiry-faq.ts) → 답장과 글이 같은 문장에서 나온다 */}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {INQUIRY_FAQS.map((f) => (
              <button key={f.key} type="button" onClick={() => setTopic(f.question)} className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${topic === f.question ? 'bg-brand text-white border-brand' : 'border-[var(--c-border)] text-[var(--c-text-3)] hover:bg-[var(--c-hover)]'}`}>{f.question}</button>
            ))}
          </div>
        </div>
      )}
      {mode === 'work' && (<>
      <div className="grid grid-cols-2 @lg:grid-cols-3 gap-2 mb-2">
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

      <div className="grid grid-cols-2 @lg:grid-cols-3 gap-2 mb-2">
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
            <select value={product} onChange={(e) => setProduct(e.target.value)} className={`${inputCls} ${!product ? 'border-brand/60' : ''}`}>
              {!product && <option value="">제품을 선택하세요</option>}
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

      </>)}

      <div className="grid grid-cols-1 @lg:grid-cols-2 gap-2 mb-2">
        <div>
          <label className={labelCls}>제목 키워드 (선택) — 이번 글 제목에 꼭 넣을 말. 본문에도 3~5회 들어갑니다</label>
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="예: 양재 랩핑" className={inputCls} />
        </div>
        {mode === 'faq' ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>시공 분야</label>
            <select value={faqService} onChange={(e) => setFaqService(e.target.value)} className={inputCls}>
              {FAQ_SERVICE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>지역 (제목·본문 키워드)</label>
            <select value={region} onChange={(e) => setRegion(e.target.value)} className={inputCls}>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        ) : (
        <div>
          <label className={labelCls}>사진 폴더 링크 (선택) — 구글 드라이브 공유 폴더. 넣으면 글 완성 뒤 영상까지 자동 제작</label>
          <input
            value={photosUrl}
            onChange={(e) => setPhotosUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/..."
            className={`${inputCls} ${!photosUrlOk ? 'border-brand/60' : ''}`}
          />
          {!photosUrlOk && <p className="text-[10px] text-brand mt-1">구글 드라이브 폴더 링크만 됩니다 (링크가 있는 모든 사용자 보기 권한)</p>}
          {photosUrlTrim && photosUrlOk && (
            <label className="flex items-center gap-1.5 mt-1 text-[10px] text-[var(--c-text-2)]">
              <input type="checkbox" checked={vertical} onChange={(e) => setVertical(e.target.checked)} className="accent-brand" />
              세로 영상(인스타 릴스·네이버 클립용)도 함께 만들기
            </label>
          )}
        </div>
        )}
      </div>

      <div className="mb-2">
        <label className={labelCls}>참고 글 링크 (선택) — 내 블로그 글이나 참고할 글, 한 줄에 하나(최대 3). 말투와 제품 설명·관리 안내를 여기서 가져옵니다</label>
        <textarea
          value={refLinks}
          onChange={(e) => setRefLinks(e.target.value)}
          rows={2}
          placeholder="https://blog.naver.com/roice_/2244..."
          className={`${inputCls} resize-none`}
        />
      </div>

      <div className="mb-2">
        <label className={labelCls}>{mode === 'faq' ? '사장님 입장 메모 (선택) — 이 질문에 대한 사장님 기준·권하는 것·권하지 않는 것. 조사로 알 수 없는 건 이것뿐입니다' : '현장 메모 — 글의 몸통입니다. 이 차에서 있었던 일을 1분 말하듯'}</label>
        <textarea
          ref={notesRef}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={mode === 'faq' ? (initial ? 4 : 2) : 5}
          placeholder={mode === 'faq' ? "예: 앞유리 30% 아래는 권하지 않음, 밤·눈·비에 위험 / 루프는 썬쉐이드 권함" : "말하듯 적어 주세요 (폰 음성 메모 글자로 바꿔 붙여 넣어도 됩니다)\n· 이 손님이 왜 왔는지, 뭘 고민하다 뭘 골랐는지\n· 어디서 시간이 갔는지, 어떻게 했는지\n· 끝나고 손님이 뭐라고 했는지\n여기 적힌 만큼이 글이 됩니다. 비면 조사 자료로만 써서 밋밋해집니다"}
          className={`${inputCls} resize-none`}
        />
        {mode === 'work' && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-[var(--c-text-3)]">도입 아이디어(선택)</span>
            {ideas.map((o) => (
              <button
                key={o.key}
                type="button"
                title={`${o.hint}\n예) ${o.example}`}
                onClick={() => setOpening(opening === o.key ? '' : o.key)}
                className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${opening === o.key ? 'bg-brand text-white border-brand' : 'border-[var(--c-border)] text-[var(--c-text-3)] hover:bg-[var(--c-hover)]'}`}
              >{o.label}</button>
            ))}
            <button type="button" onClick={() => { setIdeas(pickOpeningIdeas(3, ideas.map(i => i.key))); }} className="text-[11px] px-2 py-1 rounded-full text-[var(--c-text-3)] hover:text-[var(--c-text-1)]">다른 것</button>
            {opening && <span className="basis-full text-[10px] text-[var(--c-text-3)]">{OPENING_IDEAS.find(i => i.key === opening)?.hint} — 메모에 그 이야기를 적어 주시면 그걸로 시작합니다</span>}
          </div>
        )}
      </div>

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="w-full bg-brand hover:bg-brand-dark disabled:bg-[var(--c-subtle)] disabled:text-[var(--c-text-3)] text-white text-sm font-semibold py-3 rounded-full transition-colors"
      >
        {disabled ? '작성 중…' : mode === 'faq' ? '조사하고 사실표 만들기' : '조사하고 시공기 쓰기'}
      </button>
    </div>
  );
}
