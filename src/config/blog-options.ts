/**
 * 시공기 빠른 생성 폼의 선택지.
 * 제품·시공 종류는 CLAUDE.md "제품 스펙" 절에 있는 것만 넣는다. 여기 없는 제품은 AI가 쓰면 안 된다.
 */

export const CAR_BRANDS = [
  'BMW', '벤츠', '아우디', '포르쉐', '테슬라', '제네시스', '현대', '기아', '렉서스', '볼보',
  '랜드로버', '레인지로버', '마세라티', '람보르기니', '페라리', '맥라렌', '벤틀리', '롤스로이스',
  '재규어', '링컨', '캐딜락', '미니', '토요타', '혼다', '쉐보레', '폭스바겐', '지프',
] as const;

export const REGIONS = [
  '서초', '강남', '반포', '잠원', '방배', '역삼', '논현', '양재', '대치', '청담', '압구정', '신사', '개포', '일원', '세곡',
] as const;

/**
 * 자동 생성 대상 서비스 (2026-11-05 사장님 결정): PPF·컬러PPF·랩핑·크롬죽이기만.
 * 썬팅·유리막코팅·신차패키지·실내PPF는 자동 생성에서 제외 (필요 시 여기와 SERVICES에 다시 추가)
 */
export type ServiceKey = 'PPF' | '컬러PPF' | '랩핑' | '크롬죽이기';

export interface ServiceOption {
  key: ServiceKey;
  label: string;
  /** 제품 선택지. 비어 있으면 자유 입력 */
  products: string[];
  /** 제품 외에 추가로 받을 입력 (예: 컬러, 농도) */
  extraLabel?: string;
  extraPlaceholder?: string;
  /** 시공 범위 선택지 */
  ranges: string[];
}

export const SERVICES: ServiceOption[] = [
  {
    key: 'PPF',
    label: 'PPF (투명 보호필름)',
    products: ['3M 시리즈50', '3M 시리즈100', '3M 시리즈150', '3M PRO200 유광', '3M PRO200 무광'],
    ranges: ['전체', '프론트(보닛·범퍼·펜더)', '부분'],
  },
  {
    key: '컬러PPF',
    label: '컬러PPF (3M PWF)',
    products: ['3M PWF'],
    extraLabel: '컬러',
    extraPlaceholder: '예: 매트 블랙, 새틴 그레이',
    ranges: ['전체', '부분'],
  },
  {
    key: '랩핑',
    label: '랩핑 (3M 2080)',
    products: ['3M 2080'],
    extraLabel: '컬러·마감',
    extraPlaceholder: '예: 글로스 블랙, 매트 밀리터리 그린',
    ranges: ['전체', '루프', '부분'],
  },
  {
    key: '크롬죽이기',
    label: '크롬죽이기 (3M 2080 글로스블랙)',
    products: ['3M 2080 글로스블랙'],
    ranges: ['윈도우몰딩', '전체 크롬', '그릴·엠블럼', '부분'],
  },
];

/** CRM 시공 기록의 service_type → 폼 서비스 키. 여기 없는 종류(썬팅·코팅 등)는 자동 생성 대상이 아님 */
export const CRM_SERVICE_TO_KEY: Record<string, ServiceKey> = {
  PPF: 'PPF',
  컬러PPF: '컬러PPF',
  PWF: '컬러PPF',
  랩핑: '랩핑',
  크롬죽이기: '크롬죽이기',
};

/** CRM → 블로그 폼 미리 채우기 (sessionStorage 로 전달) */
export const BLOG_PREFILL_KEY = 'proism_blog_prefill';
export interface BlogPrefill {
  brand?: string;
  model?: string;
  color?: string;
  serviceKey: ServiceKey;
  range?: string;
  product?: string;
  extra?: string;
  notes?: string;
  /** 어디서 왔는지 (예: "CRM 예약 11/03 홍길동") */
  source?: string;
}

/** 서버로 보내는 구조화된 요청. 정규식 추출보다 우선한다 */
export interface BlogRequest {
  brand: string;
  model: string;
  color?: string;
  serviceKey: ServiceKey;
  serviceLabel: string;
  range: string;
  product: string;
  extra?: string;
  region: string;
  notes?: string;
}

/** 폼 입력을 기존 채팅 파이프라인이 이해하는 한 문장으로 만든다 */
export function buildBlogMessage(r: BlogRequest): string {
  const car = `${r.brand} ${r.model}`.trim();
  const productLine = [r.product, r.extra].filter(Boolean).join(' ');
  const parts = [
    `${r.region} ${car} ${r.range} ${r.serviceKey} 시공기 써줘.`,
    productLine ? `제품: ${productLine}.` : '',
    r.color ? `차량 색상: ${r.color}.` : '',
    r.notes ? `참고: ${r.notes}` : '',
    `제목과 본문의 지역명은 "${r.region}"으로 써줘.`,
  ];
  return parts.filter(Boolean).join(' ');
}
