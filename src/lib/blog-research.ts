import { researchWithWebSearch } from '@/lib/claude-client';
import type { BlogRequest } from '@/config/blog-options';

/** 폼에서 온 구조화 요청이 있으면 그것을, 없으면 메시지에서 정규식으로 추출 */
export function resolveTarget(message: string, request?: BlogRequest | null): { carModel: string | null; serviceType: string; product: string } {
  if (request && request.model) {
    return {
      carModel: `${request.brand} ${request.model}`.trim(),
      serviceType: request.serviceKey === '컬러PPF' ? '컬러PPF(PWF)' : request.serviceKey,
      product: [request.product, request.extra].filter(Boolean).join(' '),
    };
  }
  return { carModel: extractCarModel(message), serviceType: extractServiceType(message), product: '' };
}

/* ───────────────────────────────────────────────────────────────
 * 블로그 시공기 사전 조사 모듈
 * - 요청 문장에서 차종·시공 종류를 뽑고
 * - Claude 웹 검색으로 차량 구조 + 같은 차종 시공 사례를 조사해
 * - 작성용 시스템 프롬프트에 주입할 텍스트를 만든다
 * /api/research 와 /api/chat 양쪽에서 사용
 * ─────────────────────────────────────────────────────────────── */

/**
 * 블로그 글 작성 요청인지 판별
 */
export function isBlogWriteRequest(message: string): boolean {
  const keywords = ['블로그', '글 써', '글 작성', '써줘', '써 줘', '시공기', '포스팅', '작업기', '초안', '원고'];
  return keywords.some(k => message.includes(k));
}

/**
 * 사용자 메시지에서 차종을 추출
 */
export function extractCarModel(message: string): string | null {
  // 브랜드 + 모델명 패턴 매칭
  // 서비스·동작 단어가 나오면 차종 추출을 멈춘다 ("BMW M2 전체 PPF 시공기 작성해줘" → "BMW M2")
  const stopWords = '(?:전체|부분|프론트|리어|실내|신차|컬러|PPF|PWF|랩핑|래핑|썬팅|선팅|틴팅|크롬|코팅|시공|작업|후기|블로그|글|써|작성|패키지|검수)';
  const patterns = [
    new RegExp(`(?:BMW|벤츠|메르세데스|아우디|포르쉐|테슬라|제네시스|렉서스|볼보|현대|기아|랜드로버|레인지로버|링컨|캐딜락|마세라티|재규어|롤스로이스|벤틀리|람보르기니|페라리|맥라렌|미니|토요타|혼다|쉐보레|폭스바겐|지프)(?:\\s+(?!${stopWords})[A-Za-z0-9가-힣\\-]+){0,3}`),
    /(?:카이엔|파나메라|타이칸|마칸|카이맨|박스터|911)/,
    /(?:모델[YX3SyxsS]|사이버트럭)/,
    /(?:GV[0-9]+|G[0-9]+[ei]?|GLE|GLC|GLS|GLB|CLE|CLA|AMG|EQS|EQE|S클래스|E클래스|C클래스|A클래스)/,
    /(?:그랜저|쏘나타|아반떼|투싼|싼타페|팰리세이드|아이오닉[0-9]*|쏘렌토|카니발|스포티지|EV[0-9]+|레이|니로)/,
    /(?:카마로|콜벳|머스탱|디펜더|레인지로버|디스커버리)/,
  ];
  for (const p of patterns) {
    const match = message.match(p);
    if (match) return match[0].trim();
  }
  return null;
}

/**
 * 사용자 메시지에서 시공 종류를 추출
 */
export function extractServiceType(message: string): string {
  const m = message;
  if (/신차\s*패키지/.test(m)) return '신차패키지';
  if (/크롬\s*죽이기|크롬\s*삭제|블랙\s*아웃/.test(m)) return '크롬죽이기';
  if (/컬러\s*PPF|PWF|컬러\s*피피에프/i.test(m)) return '컬러PPF(PWF)';
  if (/실내\s*PPF/i.test(m)) return '실내PPF';
  if (/PPF|보호\s*필름|피피에프/i.test(m)) return 'PPF';
  if (/랩핑|래핑|wrap/i.test(m)) return '랩핑';
  if (/썬팅|선팅|틴팅/.test(m)) return '썬팅';
  if (/유리막|코팅/.test(m)) return '유리막코팅';
  return '시공';
}

const RESEARCH_MAX_SEARCHES = 10;
const NAVER_POST_FETCH_LIMIT = 4;     // 본문까지 읽을 네이버 블로그 글 수
const NAVER_POST_MAX_CHARS = 2500;    // 글당 발췌 글자 수

/* ───────── 네이버 검색 API (블로그·카페) ─────────
 * 2026-07-31부로 개발자센터(developers.naver.com) 신규 신청이 끝나고
 * 네이버 클라우드 플랫폼 NAVER API HUB 로 이관됨 (기존 키는 2027-06-30까지만 동작).
 *  - 신규(우선): NCP_APIGW_KEY_ID / NCP_APIGW_KEY  → https://naverapihub.apigw.ntruss.com/search/v1/{blog|cafearticle}
 *  - 구형(호환): NAVER_CLIENT_ID / NAVER_CLIENT_SECRET → https://openapi.naver.com/v1/search/{blog|cafearticle}.json
 * 둘 다 없으면 조용히 건너뛰고 Claude 웹 검색만 사용한다.
 */
export interface NaverItem {
  title: string;
  link: string;
  description: string;
  source: '블로그' | '카페';
  date?: string;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").trim();
}

// PC 블로그 주소는 iframe 구조라 본문을 못 읽으므로 모바일 주소로 바꾼다
function toMobileUrl(link: string): string {
  return link
    .replace(/^https?:\/\/blog\.naver\.com\//, 'https://m.blog.naver.com/')
    .replace(/^https?:\/\/cafe\.naver\.com\//, 'https://m.cafe.naver.com/');
}

function naverAuth(): { url: (type: 'blog' | 'cafearticle', qs: string) => string; headers: Record<string, string> } | null {
  const ncpId = process.env.NCP_APIGW_KEY_ID;
  const ncpKey = process.env.NCP_APIGW_KEY;
  if (ncpId && ncpKey) {
    return {
      url: (type, qs) => `https://naverapihub.apigw.ntruss.com/search/v1/${type}?${qs}&format=json`,
      headers: { 'X-NCP-APIGW-API-KEY-ID': ncpId, 'X-NCP-APIGW-API-KEY': ncpKey },
    };
  }
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (id && secret) {
    return {
      url: (type, qs) => `https://openapi.naver.com/v1/search/${type}.json?${qs}`,
      headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
    };
  }
  return null;
}

export function isNaverSearchEnabled(): boolean {
  return naverAuth() !== null;
}

async function naverSearch(query: string, type: 'blog' | 'cafearticle', display = 8): Promise<NaverItem[]> {
  const auth = naverAuth();
  if (!auth) return [];
  const url = auth.url(type, `query=${encodeURIComponent(query)}&display=${display}&start=1&sort=sim`);
  const res = await fetch(url, { headers: auth.headers });
  if (!res.ok) throw new Error(`네이버 검색 API 오류: ${res.status} ${await res.text()}`);
  const data = await res.json() as { items?: { title: string; link: string; description: string; postdate?: string; bloggername?: string; cafename?: string }[] };
  return (data.items || []).map(it => ({
    title: stripHtml(it.title),
    link: toMobileUrl(it.link),
    description: stripHtml(it.description),
    source: type === 'blog' ? '블로그' : '카페',
    date: it.postdate,
  }));
}

/**
 * 네이버 블로그는 Anthropic 웹 읽기 크롤러를 차단하므로(web_fetch 400),
 * 우리 서버가 모바일 페이지를 직접 받아 본문 텍스트만 뽑는다. 실패하면 빈 문자열.
 */
export async function fetchNaverPostText(url: string, maxChars = NAVER_POST_MAX_CHARS): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return '';
    const html = await res.text();
    const start = html.indexOf('se-main-container');
    const section = start >= 0 ? html.slice(start) : html;
    const text = section
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim();
    return text.slice(0, maxChars);
  } catch {
    return '';
  }
}

/**
 * 같은 차종·같은 시공의 한국어 시공기 후보를 네이버에서 모은다 (최대 15건, 프로이즘 자체 글 제외)
 */
export async function searchNaverCases(carModel: string, serviceType: string): Promise<NaverItem[]> {
  if (!isNaverSearchEnabled()) return [];
  const svc = serviceType.replace(/\(.*\)/, ''); // "컬러PPF(PWF)" → "컬러PPF"
  const queries: [string, 'blog' | 'cafearticle'][] = [
    [`${carModel} ${svc} 시공`, 'blog'],
    [`${carModel} ${svc} 후기`, 'blog'],
    [`${carModel} ${svc}`, 'cafearticle'],
  ];
  const results = await Promise.allSettled(queries.map(([q, t]) => naverSearch(q, t)));
  const seen = new Set<string>();
  const items: NaverItem[] = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') { console.warn('[naver]', r.reason); continue; }
    for (const it of r.value) {
      if (seen.has(it.link) || /roice_/.test(it.link)) continue;
      seen.add(it.link);
      items.push(it);
    }
  }
  return items.slice(0, 15);
}

const RESEARCH_SYSTEM_PROMPT = `당신은 자동차 외장 시공(PPF·컬러PPF·랩핑·크롬죽이기·썬팅) 전문 블로그 작가를 돕는 리서처입니다.
웹 검색으로 사실만 수집하고, 추측은 절대 하지 않습니다. 확인되지 않은 항목은 "확인 안 됨"이라고 적습니다.
결과는 한국어로, 아래 출력 형식을 정확히 지켜 작성합니다. 출처의 문장을 그대로 복사하지 말고 요약합니다.`;

/**
 * 블로그 글 작성 전 웹 검색 리서치
 * 1) 해당 차량의 형상·범퍼 구조·특이 부위
 * 2) 같은 차종의 같은 시공 사례 (다른 매장 시공기, 커뮤니티 글)
 * 결과를 작성용 시스템 프롬프트에 주입할 텍스트로 반환
 */
export async function researchForBlogPost(
  userMessage: string,
  carModel: string,
  serviceType: string,
): Promise<{ context: string; summary: string }> {
  // 네이버 블로그·카페에서 한국어 시공기 후보를 먼저 모은다 (키 없으면 빈 배열)
  let naverItems: NaverItem[] = [];
  try { naverItems = await searchNaverCases(carModel, serviceType); } catch (e) { console.warn('[naver]', e); }

  // 상위 블로그 글 본문을 우리 서버가 직접 읽어 발췌 (네이버는 Anthropic 크롤러 차단)
  const blogTargets = naverItems.filter(it => it.source === '블로그').slice(0, NAVER_POST_FETCH_LIMIT);
  const bodies = await Promise.all(blogTargets.map(it => fetchNaverPostText(it.link)));
  const excerpts = blogTargets
    .map((it, i) => ({ it, text: bodies[i] }))
    .filter(x => x.text.length > 200);
  const naverFetched = excerpts.length;

  const naverSection = naverItems.length > 0
    ? `

## 네이버 검색 결과 — 한국어 시공기 후보 ${naverItems.length}건 (B 항목에 우선 활용)
제목·요약이 "${carModel} ${serviceType}"과 맞는 글만 참고하고, 광고성·무관한 글은 건너뜁니다. 아래 URL은 web_fetch 로 열 수 없으니(차단됨) 요약과 발췌만 사용하세요.
${naverItems.map((it, i) => `${i + 1}. [${it.source}] ${it.title}${it.date ? ` (${it.date})` : ''}
   요약: ${it.description}
   URL: ${it.link}`).join('\n')}${excerpts.length > 0 ? `

## 네이버 블로그 본문 발췌 (${excerpts.length}건, 글당 최대 ${NAVER_POST_MAX_CHARS}자)
${excerpts.map((x, i) => `[발췌 ${i + 1}] ${x.it.title}\n${x.text}`).join('\n\n')}` : ''}`
    : '';

  const researchPrompt = `아래 블로그 작성 요청을 위해 웹 검색으로 사전 조사를 해주세요.${naverSection}

[작성 요청 원문]
${userMessage}

[추출된 정보]
- 차종: ${carModel}
- 시공 종류: ${serviceType}

## 검색 예산
- 웹 검색은 최대 ${RESEARCH_MAX_SEARCHES}회입니다. A(차량 구조)에 절반, B(시공 사례)에 절반을 배분하세요
- 한 번의 검색에 여러 키워드를 묶어 효율적으로 검색하세요 (예: "${carModel} 앞범퍼 번호판 그릴 구조", "${carModel} ${serviceType} 시공 후기 블로그")
- B(시공 사례)는 한국어 검색을 먼저 하세요. 예: "${carModel} ${serviceType} 시공 후기", "${carModel} ${serviceType} 블로그", "blog.naver.com ${carModel} ${serviceType}", "보배드림 ${carModel} ${serviceType}". 코드명(예: G87)으로도 한 번 검색하세요. 한국어 사례가 부족하면 영어(예: "${carModel} paint protection film install")로 보완합니다
- 예산을 다 쓰면 검색을 멈추고, 찾은 것만으로 정리합니다

## 조사 항목

### A. 차량 형상·구조 (한국어·영어 검색 병행. 현행 세대 기준, 세대/코드명 명시)
1. 세대·코드명·출시연도 (예: G87, 2세대)
2. 번호판 위치 (앞: 범퍼/그릴, 뒤: 트렁크/범퍼)
3. 앞범퍼 구조 (그릴 형태, 에어인테이크, 안개등, 센서·카메라 위치, 립 유무)
4. 뒷범퍼 구조 (디퓨저, 배기구 개수·형태, 센서, 하단 형태)
5. 헤드램프·테일램프 형태
6. 사이드미러 형태 (카메라·방향지시등 내장 여부)
7. 하이그로시·크롬 트림 위치 (윈도우 몰딩, 그릴, 엠블럼, 머플러 팁 등)
8. 필러 구조·도어 타입 (프레임/프레임리스)
9. 휀더·휠아치 형상 (와이드 휀더, 블리스터 등)
10. 루프 (글라스루프, 카본루프, 루프레일 등)
11. 이 차종만의 특이 구조 (예: 돌출 휀더, 스플리터, 에어브리더, 숨겨진 도어핸들 등)
12. 외장 재질 특이점 (알루미늄 보닛, 카본 부품, 플라스틱 범퍼 등)

### B. 같은 차종 "${carModel} ${serviceType}" 시공 사례 (최소 3건 이상 찾을 것)
- 검색 대상: 네이버 블로그·카페, 보배드림, 클리앙, 유튜브 설명란, 인스타 등 다른 매장 시공기와 커뮤니티 글
- 정리할 것:
  - 여러 사례에서 공통적으로 언급되는 부위와 그 이유
  - 이 차종 오너들이 자주 요청하는 시공 범위·부위
  - 자주 쓰이는 필름 등급·제품 (사실 확인된 것만)
  - 작업 중 반복적으로 등장하는 주의점 (탈거 여부, 센서, 곡면, 에어덕트 등)
  - 오너들이 상담에서 자주 묻는 질문
  - 사례별 글의 구성·분량·강조점 (톤은 따라하지 않을 것이므로 구조만)

## 출력 형식 (이 형식 그대로)

[차량 기본 정보]
- ...

[외관 구조]
1. 번호판: ...
2. 앞범퍼: ...
(12개 항목 모두, 확인 안 되면 "확인 안 됨")

[시공 사례에서 반복 언급된 포인트]
- 부위 / 이유 / 몇 건의 사례에서 언급
- ...

[오너들이 자주 묻는 것]
- ...

[참고한 출처] (제목 — URL)
- ...

[확인 안 된 항목]
- ...`;

  try {
    const result = await researchWithWebSearch(RESEARCH_SYSTEM_PROMPT, researchPrompt, {
      maxSearches: RESEARCH_MAX_SEARCHES,
    });

    if (!result.text) throw new Error('empty research');

    const context = `[사전 조사 결과 — 웹 검색 ${result.searchCount}회 기반: ${carModel} ${serviceType}]
${result.text}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
위 사전 조사 결과 활용 규칙 (반드시 준수)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 차량 구조 정보는 부위 묘사의 사실 근거로만 사용. 조사에 없는 구조는 추측하지 말고 일반적 표현 사용
- **차량 소개는 최소화**. 조사 결과의 세대·출력·크기·디자인 평가 같은 차량 스펙 정보로 본문을 채우지 말 것. 차량 설명은 두세 줄이면 충분하고, 나머지는 "이 차의 이 구조를 어떻게 시공했는지"로 채울 것
- 타 매장 시공기의 문장·표현·비유는 절대 복사 금지. 사실(어떤 부위가 왜 중요한지)만 가져와 프로이즘 톤으로 완전히 새로 서술
- 타 매장 상호, 출처 URL, "다른 업체에서는" 같은 언급을 본문에 넣지 말 것
- 조사에서 "주의 부위"로 나온 곳은 차량 구조 설명 맥락에서 언급할 수 있지만, "까다로웠다/신경 썼다/공들였다" 어휘는 사장님(사용자 메시지)이 직접 알려준 부위에만 사용. 조사 결과만으로 까다로운 부위를 지정하지 말 것
- 타 매장 글에 열 성형·히팅건·오버랩 묘사가 있어도 PPF/컬러PPF/PWF 글에는 절대 반영 금지 (프로이즘은 습식·열 없음·오버랩 없음)
- 제품·스펙은 사용자가 알려준 것만. 조사 결과의 타 브랜드·타 등급 제품 언급 금지
- "확인 안 됨" 항목은 본문에서 구체적으로 묘사하지 말 것
- 사장님이 알려준 정보와 조사 결과가 다르면 사장님 정보가 우선`;

    const naverNote = naverItems.length > 0
      ? ` 네이버 블로그·카페 후보 ${naverItems.length}건 중 ${naverFetched}건은 본문까지 읽었습니다.`
      : (isNaverSearchEnabled() ? ' 네이버에서는 맞는 시공기를 찾지 못했습니다.' : ' (네이버 검색 API 키가 없어 네이버 블로그 검색은 건너뛰었습니다)');
    const summary = `사전 조사: 웹 검색 ${result.searchCount}회로 ${carModel} 구조와 ${serviceType} 시공 사례를 확인한 뒤 작성했습니다.${naverNote}`;
    return { context, summary };
  } catch (err) {
    console.warn('[chat] 웹 검색 리서치 실패, 기존 지식으로 대체:', err);
    const context = `[차량 구조 사전 조사 — ${carModel} ${serviceType}]
(웹 검색 리서치 실패 — 기존 지식으로만 파악)

아래 항목을 아는 범위에서만 파악해 글에 반영하세요. 확인 안 되는 부위는 일반적 표현을 쓰고, 추측해서 구체적으로 쓰지 말 것:
번호판 위치 / 앞범퍼 구조 / 뒷범퍼 구조 / 사이드미러 / 하이그로시·크롬 트림 / 필러·도어 타입 / 휀더 / 루프 / 해당 차종만의 특이 구조
사장님이 알려준 정보가 있으면 최우선 반영.`;
    return { context, summary: '사전 조사: 웹 검색이 실패해 기존 지식으로만 작성했습니다. 차량 구조 묘사를 한 번 더 확인해주세요.' };
  }
}
