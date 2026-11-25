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
  wrapping?: string[]; wrapping_etc?: string;
  coating?: string[];
  electrical?: string[]; electrical_etc?: string;
  polish?: string[]; polish_etc?: string;
  package_options?: string[];
  tinting?: Record<string, TintPick>;
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

/** "50시리즈"·"시리즈150"·"PRO200 무광" 같은 자유 입력에서 3M PPF 제품을 알아내 스펙 한 줄로 */
export function ppfProduct(text: string | undefined | null): string | null {
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

  // PPF: 범위 + 제품. ppf_etc 가 제품명이면 제품 줄로, 아니면 범위에 붙인다
  const ppfRanges = (w.ppf || []).map((p) => PPF_LABEL[p] || p);
  const ppfProd = ppfProduct(w.ppf_etc);
  const ppfList = ppfProd ? ppfRanges : join(ppfRanges, w.ppf_etc);
  if (ppfList.length || ppfProd) items.push({ group: 'PPF', text: ppfList.join(' · ') || 'PPF', product: ppfProd || undefined });

  const tints = Object.entries(w.tinting || {}).filter(([, t]) => (t?.selected || []).length > 0)
    .map(([b, t]) => `${TINT_LABEL[b] || b} ${(t.selected || []).join('·')}${t.density?.trim() ? ` (${t.density.trim()})` : ''}`);
  if (tints.length) {
    const is3m = tints.some((s) => /크리스탈라인|crystalline/i.test(s));
    items.push({ group: '썬팅', text: tints.join(' · '), product: is3m ? '3M 크리스탈라인 · 비금속 다층 광학 필름' : undefined });
  }

  const wrap = join(w.wrapping, w.wrapping_etc);
  if (wrap.length) {
    const isPwf = wrap.some((s) => /pwf|컬러\s*ppf/i.test(s));
    items.push({ group: isPwf ? '컬러PPF' : '랩핑', text: wrap.join(' · '), product: isPwf ? '3M PWF 컬러 PPF 필름' : '3M 2080 랩핑 필름' });
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

export function parseWorkOrder(memo: string | null | undefined): WorkOrderJson | null {
  if (!memo) return null;
  try { const p = JSON.parse(memo); return p && typeof p === 'object' ? (p as WorkOrderJson) : null; } catch { return null; }
}
