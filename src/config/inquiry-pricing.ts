/**
 * 문의 자동 답변용 시장 평균가·시공 시간 기준 (2026-11-12)
 * - 사장님 결정: 문의 답변에는 "많은 업체들 평균가"를 쓴다(우리 견적표가 아님). 실내 하이그로시처럼
 *   차량마다 다른 항목은 여러 업체 가격을 찾아 평균값으로 안내한다.
 * - 수입 중형 세단 기준, 단위 만원. min~max 는 찾은 업체 가격의 범위, typical 이 답변에 쓰는 값.
 * - confidence: high=여러 업체·브랜드 표에서 확인 / mid=2~3곳 / low=자료 적음(차량마다 다름) / ours=시장 자료 없어 우리 견적표 값
 * - 출처(2026-11 조사): GSWF 표준 시공가, XPEL 코리아 가격표, 오늘의카 가격 모음·후기, 대전 공업사 부위별 표(2026.08),
 *   테슬라 샵 PPF, 올댓오토모빌(필러), 벤츠 E200 실내 PPF 후기. 네이버 블로그 본문은 서버에서 못 읽어 제외.
 * - 시공 시간(사장님 2026-11-12): 전체 PPF 3박 4일(시공 규칙), 전체 랩핑 2박 3일, 전체 크롬죽이기·썬팅 1박 2일, 부분 PPF·실내는 6시간 안팎(당일 출고).
 */

export type Confidence = 'high' | 'mid' | 'low' | 'ours';
export type ItemGroup = 'ppf-full' | 'ppf-front' | 'ppf-part' | 'interior' | 'chrome' | 'wrap' | 'tint' | 'coating';

export interface MarketItem {
  key: string;
  /** 답변에 쓰는 이름 */
  label: string;
  /** 문의 글에서 이 항목을 뜻하는 표현 */
  match: RegExp;
  min: number;
  max: number;
  typical: number;
  confidence: Confidence;
  group: ItemGroup;
  /** 괄호 설명(구성·개수) */
  unit?: string;
  /** 사장님께 보여 주는 참고 */
  note?: string;
}

export const MARKET_ITEMS: MarketItem[] = [
  // ── PPF 전체·프론트 ──
  { key: 'ppf_full', label: '전체 PPF', match: /전체\s*(ppf|피피에프)|풀\s*(ppf|바디)|(ppf|피피에프)\s*전체|전신\s*ppf/i, min: 450, max: 700, typical: 550, confidence: 'high', group: 'ppf-full', note: '수입 세단 기준. 필름 등급 따라 위로 올라감' },
  { key: 'ppf_front', label: '프론트 PPF 패키지', match: /프론트\s*(ppf|패키지|풀)|앞쪽\s*ppf|전면부\s*ppf/i, min: 150, max: 250, typical: 200, confidence: 'high', group: 'ppf-front', unit: '앞범퍼·본넷·앞휀다' },
  { key: 'bumper_front', label: '앞범퍼 PPF', match: /앞\s*범퍼|프론트\s*범퍼|전면\s*범퍼/, min: 50, max: 130, typical: 80, confidence: 'mid', group: 'ppf-part' },
  { key: 'bonnet', label: '본넷 PPF', match: /본넷|보닛|본네트|후드/, min: 70, max: 150, typical: 100, confidence: 'mid', group: 'ppf-part' },
  { key: 'roof', label: '루프 PPF', match: /루프\s*(ppf|피피에프)|지붕/, min: 45, max: 160, typical: 90, confidence: 'mid', group: 'ppf-part', note: '파노라마 글라스 제외' },
  // ── 생활보호·부분 ──
  { key: 'life5', label: '생활보호 PPF 5~6종', match: /생활\s*보호\s*(패키지)?\s*[5-7]종|생활\s*(기스|스크래치)\s*(방지)?\s*[5-7]종|[5-7]종\s*(생활|패키지)/, min: 30, max: 50, typical: 40, confidence: 'high', group: 'ppf-part', unit: '도어컵·도어엣지·주유구·트렁크리드·헤드라이트' },
  { key: 'life3', label: '생활보호 PPF 기본 3종', match: /생활\s*보호|생활\s*(기스|스크래치|흠집)|기본\s*(기스|스크래치)|도어\s*컵|도어\s*엣지|주유구/, min: 10, max: 40, typical: 15, confidence: 'mid', group: 'ppf-part', unit: '도어컵·도어엣지·주유구' },
  { key: 'headlight', label: '헤드라이트 PPF', match: /헤드\s*라이트|헤드\s*램프|전조등/, min: 8, max: 50, typical: 20, confidence: 'high', group: 'ppf-part', unit: '2개' },
  { key: 'side_mirror', label: '사이드미러 PPF', match: /사이드\s*미러|백미러/, min: 8, max: 45, typical: 15, confidence: 'mid', group: 'ppf-part', unit: '2개' },
  { key: 'trunk_lid', label: '트렁크리드 PPF', match: /트렁크\s*리드|트렁크\s*(입구|턱)/, min: 5, max: 40, typical: 10, confidence: 'mid', group: 'ppf-part' },
  { key: 'pillar', label: 'B·C필러 PPF', match: /[bc]\s*[,·/]?\s*[bc]?\s*필러|필러\s*(ppf|피피에프|하이그로시)|기둥\s*(ppf|필름)/i, min: 10, max: 40, typical: 20, confidence: 'mid', group: 'ppf-part', unit: '4짝' },
  { key: 'door_sill', label: '사이드스텝(도어실) PPF', match: /사이드\s*스텝|도어\s*실|스커프|문턱/, min: 15, max: 40, typical: 25, confidence: 'mid', group: 'interior', unit: '4짝' },
  // ── 실내 ──
  { key: 'display', label: '네비게이션 디스플레이 PPF', match: /액정|디스플레이|네비|내비|모니터|계기판|클러스터/, min: 5, max: 15, typical: 7, confidence: 'low', group: 'interior', note: '시장 자료 적음. 화면 크기 따라 다름' },
  { key: 'interior_gloss', label: '실내 하이그로시 PPF', match: /실내\s*(하이그로시|피아노|유광)|하이그로시|센터\s*페시아|센터\s*콘솔|도어\s*트림/, min: 20, max: 40, typical: 30, confidence: 'low', group: 'interior', unit: '센터페시아·기어판넬·도어 하이그로시', note: '차량마다 면적이 달라 평균값. 실차 보고 조정' },
  { key: 'gear_panel', label: '기어판넬 PPF', match: /기어\s*(판넬|패널|봉|노브)|변속기\s*주변/, min: 10, max: 20, typical: 15, confidence: 'low', group: 'interior' },
  { key: 'leather', label: '가죽코팅(침투형)', match: /가죽\s*코팅|시트\s*코팅/, min: 50, max: 50, typical: 50, confidence: 'ours', group: 'coating' },
  // ── 크롬죽이기·랩핑 ──
  { key: 'chrome_full', label: '전체 크롬죽이기', match: /(전체|풀)\s*크롬|크롬\s*(죽이기|삭제|제거|블랙)\s*(전체|풀)|크롬\s*(죽이기|삭제|제거|블랙)/, min: 55, max: 110, typical: 80, confidence: 'high', group: 'chrome', note: '그릴·루프랙 포함 여부 따라 위아래' },
  { key: 'chrome_window', label: '윈도우몰딩 크롬죽이기', match: /윈도우\s*몰딩|창틀\s*(크롬|몰딩)|유리\s*몰딩/, min: 20, max: 35, typical: 30, confidence: 'high', group: 'chrome' },
  { key: 'wrap_full', label: '전체 랩핑', match: /전체\s*랩핑|풀\s*랩핑|랩핑\s*전체|컬러\s*체인지/, min: 130, max: 220, typical: 180, confidence: 'mid', group: 'wrap', note: '3M 2080 정품 기준은 범위 상단 이상' },
  { key: 'color_ppf_full', label: '전체 컬러 PPF', match: /컬러\s*(ppf|피피에프)|pwf|컬러\s*필름\s*전체/i, min: 650, max: 650, typical: 650, confidence: 'ours', group: 'ppf-full', note: '시장 자료 없음. 우리 견적표 값' },
  { key: 'two_tone_wrap', label: '투톤 랩핑', match: /투톤\s*랩핑|루프\s*랩핑|상단\s*랩핑/, min: 25, max: 200, typical: 200, confidence: 'ours', group: 'wrap', note: '루프만은 25만, 상단 전체 200만(우리 견적표)' },
  // ── 썬팅·유리막 ──
  { key: 'tint', label: '썬팅(전면+측후면)', match: /썬팅|선팅|틴팅|열차단\s*필름/, min: 70, max: 270, typical: 145, confidence: 'ours', group: 'tint', note: '필름 등급 따라 70~270만(우리 견적표). 등급 정해지면 확정' },
  { key: 'glass_coating', label: '유리막코팅', match: /유리막|세라믹\s*코팅/, min: 0, max: 0, typical: 0, confidence: 'ours', group: 'coating', note: '가격 미정. 상담 때 안내' },
];

/** 문의 글 한 덩어리에서 항목 찾기(정규식). 더 구체적인 항목이 먼저 잡히도록 순서 조정 */
export function matchItems(text: string): MarketItem[] {
  const t = text.replace(/\s+/g, ' ');
  const found: MarketItem[] = [];
  const order = ['life5', 'ppf_front', 'ppf_full', 'color_ppf_full', 'chrome_window', 'chrome_full', 'wrap_full', 'two_tone_wrap', 'interior_gloss', 'gear_panel', 'display', 'pillar', 'door_sill', 'headlight', 'side_mirror', 'trunk_lid', 'bumper_front', 'bonnet', 'roof', 'life3', 'leather', 'tint', 'glass_coating'];
  for (const key of order) {
    const it = MARKET_ITEMS.find(m => m.key === key)!;
    if (it.match.test(t)) found.push(it);
  }
  // 5~6종을 말했으면 기본 3종은 따로 세지 않는다. 전체 PPF 를 말했으면 그 안의 부분(범퍼·본넷·루프·헤드라이트 등)은 뺀다
  const keys = new Set(found.map(f => f.key));
  return found.filter(f => {
    if (f.key === 'life3' && keys.has('life5')) return false;
    if (keys.has('ppf_full') && ['bumper_front', 'bonnet', 'roof', 'ppf_front', 'headlight', 'side_mirror', 'trunk_lid', 'life3', 'life5'].includes(f.key)) return false;
    if (keys.has('ppf_front') && ['bumper_front', 'bonnet'].includes(f.key)) return false;
    if (f.key === 'chrome_full' && keys.has('chrome_window') && !/전체|풀/.test(t)) return false;
    return true;
  });
}

/** 시공 시간 안내(사장님 기준 2026-11-12). 긴 작업 순으로 하나만 고른다. 모르는 조합은 빈 문자열 → 답변에서 "차량 보고 안내" */
export function estimateDuration(items: MarketItem[]): string {
  const groups = new Set(items.map(i => i.group));
  const keys = new Set(items.map(i => i.key));
  if (items.length === 0) return '';
  if (keys.has('ppf_full') || keys.has('color_ppf_full')) return '3박 4일';
  if (keys.has('wrap_full')) return '2박 3일';
  if (groups.has('ppf-front')) return '';
  if (keys.has('chrome_full') || groups.has('tint')) return '1박 2일';
  if (keys.has('two_tone_wrap')) return '';
  return '6시간 안팎(당일 출고)';
}

export const fmtMan = (n: number) => `${n.toLocaleString()}만원`;

/** 한 항목의 가격 표기. 사장님 문자 형식대로 "30만원"(2026-11-12 사장님: "만 원 선·안팎" 같은 말 안 씀) */
export function priceText(it: MarketItem): string {
  if (it.typical <= 0) return '상담 때 안내';
  return fmtMan(it.typical);
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: '여러 업체 확인',
  mid: '업체 2~3곳',
  low: '자료 적음(차량마다 다름)',
  ours: '시장 자료 없음 · 우리 견적표',
};

/** 답장에 붙일 글 링크를 고르기 위한 시공 종류(견적 문자 FIRST_LINK 의 키와 같음). PPF 가 섞이면 PPF 우선 */
export function serviceKeyFor(items: MarketItem[]): string {
  const g = new Set(items.map(i => i.group));
  const k = new Set(items.map(i => i.key));
  if (k.has('color_ppf_full')) return '컬러PPF';
  if (g.has('ppf-full') || g.has('ppf-front') || g.has('ppf-part')) return 'PPF';
  if (g.has('wrap')) return '랩핑';
  if (g.has('chrome')) return '크롬죽이기';
  if (g.has('tint')) return '썬팅';
  if (g.has('interior')) return '실내PPF';
  if (k.has('glass_coating')) return '유리막코팅';
  return 'PPF';
}
