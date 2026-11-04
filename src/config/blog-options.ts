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

export type ServiceKey = 'PPF' | '컬러PPF' | '랩핑' | '크롬죽이기' | '썬팅' | '신차패키지' | '실내PPF' | '유리막코팅';

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
  {
    key: '썬팅',
    label: '썬팅',
    products: ['3M 크리스탈라인', '루마 버텍스 900'],
    extraLabel: '농도',
    extraPlaceholder: '예: 전면 70 측후면 40 (크리스탈라인은 20/40/50/60/70만)',
    ranges: ['전면+측후면', '측후면', '전면', '선루프 포함'],
  },
  {
    key: '신차패키지',
    label: '신차패키지 (검수→썬팅→PPF→코팅)',
    products: ['3M 크리스탈라인 + 생활보호 PPF', '루마 버텍스 900 + 생활보호 PPF'],
    extraLabel: '썬팅 농도·PPF 등급·코팅',
    extraPlaceholder: '예: 전면 70 측후면 40, PPF 시리즈100, 유리막코팅 포함',
    ranges: ['기본(검수+썬팅+PPF+코팅)', '썬팅+PPF', '직접 입력'],
  },
  {
    key: '실내PPF',
    label: '실내PPF (컴퓨터 재단)',
    products: ['3M 시리즈50', '3M 시리즈100', '3M 시리즈150', '3M PRO200 유광', '3M PRO200 무광'],
    ranges: ['피아노블랙 트림 전체', '센터 콘솔', '도어 트림', '부분'],
  },
  {
    key: '유리막코팅',
    label: '유리막코팅',
    products: [],
    extraLabel: '코팅 제품',
    extraPlaceholder: '사용한 제품명을 그대로 입력',
    ranges: ['전체'],
  },
];

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
