/**
 * 작업 내역서(예약 memo JSON) 해석 — 손님용 회원 페이지 시공 증명서와 CRM 보증서 자동 발급이 같이 쓴다 (2026-11-19)
 * - 작업 내역서는 CRM 완료 창에서 저장하는 JSON: ppf[]·ppf_etc·tinting{브랜드:{selected,density}}·wrapping[]·coating[]·electrical[]·polish[]·package_options[]
 * - 제품 스펙은 CLAUDE.md "제품 스펙" 그대로만. 시리즈50·100 은 발수코팅을 적지 않는다
 */
export type TintPick = { selected?: string[]; density?: string };
export interface WorkOrderJson {
  warranty_issued?: boolean;
  warranty?: { date?: string; work_details?: string; warranty_period?: string; customer_name?: string; phone?: string; car_type?: string; car_number?: string; price?: string };
  warranty_url?: string;
  car_number?: string;
  /** 메인터넌스 기간(년) 2·3·4·5·7·10 (2026-11-22). 보증서 기간이자 6개월 반복의 한계 */
  maintenance_years?: string | number;
  /** 완료 처리 때 붙인 작업 사진(Blob 주소, 최대 6장) — 손님 페이지·딜러 현황 페이지에 보이고 시공기 재료 (2026-11-25) */
  photos?: string[];
  /** 이 차에서 있었던 일 한두 줄(사장님 말) — 시공기 폼 현장 메모로 미리 채워짐 (2026-11-25) */
  field_note?: string;
  ppf?: string[]; ppf_etc?: string;
  /** PPF 제품 — 선택식 (2026-11-25 사장님 "제품은 적는 방식 말고 선택하는 방식으로"). 값은 PPF_PRODUCT_OPTIONS 중 하나. 기타(ppf_etc)는 메모 */
  ppf_product?: string;
  wrapping?: string[]; wrapping_etc?: string;
  /** 컬러PPF(PWF) 범위 + 기타(제품명은 사장님이 직접 기입, 2026-11-25 "컬러PPF·랩핑은 선택 말고 기타에 제품명 내가 기입") */
  color_ppf?: string[]; color_ppf_etc?: string;
  coating?: string[];
  electrical?: string[]; electrical_etc?: string;
  polish?: string[]; polish_etc?: string;
  package_options?: string[];
  tinting?: Record<string, TintPick>;
  /** 특이사항 및 비고 (작업 내역서 PDF 아래 칸, 시공기 폼 참고 메모로도) */
  notes?: string;
  /** 작업 내역서 상단 체크 — 완료 처리 때 자동 true */
  crm_recorded?: boolean;
  amount?: string | number;
}

export interface WorkItem {
  /** PPF · 썬팅 · 랩핑 · 코팅 · 전장 · 광택 · 패키지 */
  group: string;
  /** 시공 범위 (프론트 패키지, 전체 PPF …) */
  text: string;
  /** 쓴 제품과 스펙 (3M PPF 시리즈50 · 185μm · 셀프힐링 · 고광택) — 확인된 제품일 때만 */
  product?: string;
}

const TINT_LABEL: Record<string, string> = { vertex: '루마 버텍스', rainbow: '레인보우', glasstint: '글라스틴트', tinain: '티나인' };
const PPF_LABEL: Record<string, string> = { '전체PPF': '전체 PPF', '프론트패키지': '프론트 패키지', '생활보호패키지': '생활보호 패키지' };

/** CLAUDE.md 제품 스펙 그대로. 시리즈50·100 에는 발수코팅을 적지 않는다 */
const PPF_SPECS: { test: RegExp; name: string; spec: string }[] = [
  { test: /pro\s*-?\s*200|프로\s*200/i, name: 'PRO200', spec: '' },
  { test: /150/, name: '시리즈150', spec: '190μm · 셀프힐링 · 발수코팅 · 고광택' },
  { test: /100/, name: '시리즈100', spec: '190μm · 셀프힐링 · 고광택' },
  { test: /50/, name: '시리즈50', spec: '185μm · 셀프힐링 · 고광택' },
];

/** 작업 내역서 PPF 제품 선택지 (2026-11-25). 스펙 표기는 ppfProduct 가 만든다 */
export const PPF_PRODUCT_OPTIONS = ['시리즈50', '시리즈100', '시리즈150', 'PRO200 유광', 'PRO200 무광', '오벨 PPF'] as const;
/** 선택지 표시용 이름: 3M 라인은 "3M 시리즈50", 오벨은 그대로 (2026-11-26 사장님 "PPF·컬러PPF·랩핑은 3M 만 쓰는 게 아니라 오벨도 씀") */
export const ppfOptionLabel = (p: string) => (/^오벨|obel/i.test(p) ? p : `3M ${p}`);
export const isObel = (t: string | null | undefined) => /오벨|obel/i.test(t || '');

/** 제품 선택 칸 우선, 없으면 옛 기록의 기타 글자에서 알아낸다 */
export function ppfProductOf(w: Pick<WorkOrderJson, 'ppf_product' | 'ppf_etc'>): string | null {
  return ppfProduct(w.ppf_product) || ppfProduct(w.ppf_etc);
}

/** "50시리즈"·"시리즈150"·"PRO200 무광" 같은 자유 입력에서 3M PPF 제품을 알아내 스펙 한 줄로 */
export function ppfProduct(text: string | undefined | null): string | null {
  if (isObel(text)) return `오벨 ${String(text).replace(/^오벨\s*/i, '').trim()}`.trim(); // 오벨 라인은 이름만(스펙 확인 전)
  const t = (text || '').trim();
  if (!t) return null;
  for (const p of PPF_SPECS) {
    if (!p.test.test(t)) continue;
    if (p.name === 'PRO200') {
      const matte = /무광|matte/i.test(t);
      return matte ? '3M PPF PRO200 무광 · 200μm · 셀프힐링 · 발수코팅' : '3M PPF PRO200 유광 · 200μm · 셀프힐링 · 발수코팅 · 고광택';
    }
    return `3M PPF ${p.name} · ${p.spec}`;
  }
  return null;
}

/** 작업 내역서 → 증명서 줄 목록 */
export function workItems(w: WorkOrderJson): WorkItem[] {
  const items: WorkItem[] = [];
  const join = (arr?: string[], etc?: string) => [...(arr || []), ...(etc?.trim() ? [etc.trim()] : [])];

  // PPF: 범위 + 제품. 제품은 선택 칸(ppf_product) 우선. 옛 기록은 ppf_etc 가 제품명이면 제품 줄로, 아니면 범위에 붙인다
  const ppfRanges = (w.ppf || []).map((p) => PPF_LABEL[p] || p);
  const ppfProd = ppfProductOf(w);
  const etcIsProduct = !w.ppf_product && !!ppfProduct(w.ppf_etc);
  const ppfList = etcIsProduct ? ppfRanges : join(ppfRanges, w.ppf_etc);
  if (ppfList.length || ppfProd) items.push({ group: 'PPF', text: ppfList.join(' · ') || 'PPF', product: ppfProd || undefined });

  const tints = Object.entries(w.tinting || {}).filter(([, t]) => (t?.selected || []).length > 0)
    .map(([b, t]) => `${TINT_LABEL[b] || b} ${(t.selected || []).join('·')}${t.density?.trim() ? ` (${t.density.trim()})` : ''}`);
  if (tints.length) {
    const is3m = tints.some((s) => /크리스탈라인|crystalline/i.test(s));
    items.push({ group: '썬팅', text: tints.join(' · '), product: is3m ? '3M 크리스탈라인 · 비금속 다층 광학 필름' : undefined });
  }

  // 컬러PPF 칸 (2026-11-25): 범위는 체크, 제품명은 기타에 사장님이 적은 그대로(없으면 PWF 기본)
  // 기타에 적은 제품명: 3M 이나 오벨이 적혀 있으면 그대로, 브랜드가 없으면 3M 으로 본다(PWF 등). 오벨 글자가 있으면 3M 을 붙이지 않는다 (2026-11-26)
  const asProduct = (etc: string | undefined, base: string) => { const t = (etc || '').trim(); if (!t) return base; return /3m/i.test(t) || isObel(t) ? t : `3M ${t}`; };
  const cp = w.color_ppf || [];
  if (cp.length || (w.color_ppf_etc || '').trim()) items.push({ group: '컬러PPF', text: cp.length ? cp.join(' · ') : '컬러PPF', product: asProduct(w.color_ppf_etc, '3M PWF 컬러 PPF 필름') });

  const obelWrap = isObel(w.wrapping_etc) ? (w.wrapping_etc || '').trim() : null; // 랩핑 기타에 오벨 제품명을 적으면 그 제품으로, 범위 글자에는 안 붙임 (2026-11-26)
  const wrap = obelWrap ? [...(w.wrapping || [])] : join(w.wrapping, w.wrapping_etc);
  if (wrap.length || obelWrap) {
    const isPwf = wrap.some((s) => /pwf|컬러\s*ppf/i.test(s));
    items.push({ group: isPwf ? '컬러PPF' : '랩핑', text: wrap.join(' · ') || '랩핑', product: obelWrap || (isPwf ? '3M PWF 컬러 PPF 필름' : '3M 2080 랩핑 필름') });
  }
  const coat = w.coating || [];
  if (coat.length) items.push({ group: '코팅', text: coat.join(' · ') });
  const elec = join(w.electrical, w.electrical_etc);
  if (elec.length) items.push({ group: '전장', text: elec.join(' · ') });
  const pol = join(w.polish, w.polish_etc);
  if (pol.length) items.push({ group: '광택', text: pol.join(' · ') });
  const pkg = w.package_options || [];
  if (pkg.length) items.push({ group: '패키지', text: pkg.join(' · ') });
  return items;
}

/** 보증서 "시공 내역" 글자 한 줄 (CRM 보증서 창 work_details 형식: 항목은 줄바꿈으로 구분) */
export function workDetailsText(w: WorkOrderJson, fallback: string): string {
  const items = workItems(w);
  if (items.length === 0) return fallback;
  return items.map((i) => `${i.group} ${i.text}${i.product ? ` (${i.product.split(' · ')[0]})` : ''}`).join('\n');
}

/**
 * 사후관리 카드용 작업 내역 한 줄씩 (2026-11-26 사장님 "성함만 있어서 무슨 작업했는지 기억이 안 나").
 * 작업 내역서 JSON 이면 항목마다 "PPF 전체 PPF · 시리즈50", 옛 기록(글자 메모)이면 film_used·service_area 로, 그것도 없으면 빈 배열
 */
export function workSummaryLines(memo: string | null | undefined, fallback?: { film_used?: string | null; service_area?: string | null }): string[] {
  const w = parseWorkOrder(memo);
  if (w) {
    const lines = workItems(w).map((i) => `${i.group} ${i.text}${i.product ? ` · ${i.product.split(' · ')[0].replace(/^3M PPF /, '')}` : ''}`);
    if (lines.length) return lines;
  }
  const fb = [fallback?.service_area, fallback?.film_used].map((x) => (x || '').trim()).filter(Boolean);
  if (fb.length) return [fb.join(' · ')];
  if (memo && !w && memo.trim()) return [memo.trim().split('\n')[0].slice(0, 80)];
  return [];
}

export function parseWorkOrder(memo: string | null | undefined): WorkOrderJson | null {
  if (!memo) return null;
  try { const p = JSON.parse(memo); return p && typeof p === 'object' ? (p as WorkOrderJson) : null; } catch { return null; }
}
