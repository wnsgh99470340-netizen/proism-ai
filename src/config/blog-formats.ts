/**
 * 시공기 글 형식 돌려쓰기 (2026-11-13 사장님: "다 비슷비슷하다, 매 글마다 새로운 느낌을 주고 싶다")
 * 최근 생성 글 12편이 전처리 → 가장 이야기하고 싶은 부위 → 두 번째 → 세 번째 → 루프 → 전체 → 개인적으로 → QC 2주 → 6개월 → 연락처
 * 뼈대로 수렴해 있었음. 접수 때 최근 글에 안 쓴 형식을 골라 프롬프트에 [이번 글의 형식]으로 못 박는다.
 * 사실(QC 2주·메인터넌스 6개월·끝단 안쪽 마감)은 반복돼도 되고, 글의 모양(순서·축)을 바꾸는 것이 목적.
 */
export interface BlogFormat {
  key: string;
  name: string;
  /** 프롬프트에 들어가는 지시 (2~4줄) */
  brief: string;
  /** 이전 글이 이 형식이었는지 짐작하는 표식 (본문 앞 12줄 기준). 없으면 판별 안 함 */
  detect?: RegExp;
}

export const BLOG_FORMATS: BlogFormat[] = [
  {
    key: 'standard',
    name: '기본 시공기',
    brief: '평범한 시공기. 도입 한 가지(고객 고민·차의 구조·제품을 고른 이유 중 하나) → 자기소개 → 차량·의뢰 → 작업을 실제 순서대로(전처리 → 사장님이 알려준 까다로운 부위 1~2곳을 깊게 → 나머지는 한 문단) → 완성 → 관리 2~3줄 → 상담 문턱 한 줄 → 연락처. 부위에 번호를 매기지 않고, 완성 사진 설명으로 열지 않는다.',
  },
  {
    key: 'one_part',
    name: '한 부위만 끝까지',
    brief: '이 차에서 가장 중요한 부위 하나(뒷범퍼·도어·루프 중 사장님이 알려준 것)를 글 전체의 축으로 삼는다. 그 부위의 구조 → 왜 어려운지 → 어떤 순서로 붙였는지 → 완성 뒤 어떻게 보이는지를 길게 쓴다. 다른 부위는 마지막에 한 문단으로만.',
    detect: /한 (부위|곳)만|이 글은 .{0,8}(범퍼|도어|루프).{0,6}이야기/,
  },
  {
    key: 'consult',
    name: '상담 흐름 재구성',
    brief: '고객이 처음 연락해 온 순간부터 시작해 무엇을 물었고 무엇을 고민했는지, 어떤 설명을 듣고 무엇을 결정했는지를 순서대로 쓴다(따옴표 인용 없이 간접 서술). 시공 묘사는 그 결정이 실제로 어떻게 구현됐는지 보여 주는 자리로만 2곳.',
    detect: /^(.{0,40}(처음 (연락|문의|전화)|상담 (때|하러|오셨)|문의를 주셨)).*/m,
  },
  {
    key: 'topic',
    name: '오해 하나 바로잡기',
    brief: '이 시공에 대한 흔한 오해나 비교 질문 하나(예: 컬러PPF와 랩핑은 뭐가 다른가, 무광은 관리가 어렵다, 전체보다 전면만 하면 되지 않나)를 글의 주제로 잡는다. 이 차는 그 주제를 증명하는 사례로만 쓰고, 시공 묘사는 주제와 직접 이어지는 장면 2곳만.',
    detect: /(뭐가 다른|차이가 뭔|오해|착각)/,
  },
  {
    key: 'diary',
    name: '작업 일지',
    brief: '입고부터 출고까지 시간 순서로 쓴다. 1일차·2일차처럼 날을 나누거나(3박 4일 작업이면 하루씩) 오전·오후로 나누고, 각 구간에 그날의 한 장면과 그 장면에서 결정한 것 하나씩만. 부위를 모아서 설명하지 않고 그날 손이 간 자리만 말한다.',
    detect: /(1일차|첫째 날|첫날|둘째 날|이튿날|마지막 날)/,
  },
  {
    key: 'reader',
    name: '읽는 분 조건별',
    brief: '"이런 차라면" "이렇게 타시는 분이라면" 식으로 읽는 사람의 조건 2~3가지를 소제목 없이 문단으로 나누고, 각 조건에서 이 시공이 어떻게 달라지는지(범위·등급·관리)를 이 차의 작업을 예로 들어 설명한다. 등급 권유·비교 광고로 흐르지 않는다.',
    detect: /(라면\n|이신 분|타시는 분|이런 분)/,
  },
  {
    key: 'care',
    name: 'QC 시점에서 거꾸로',
    brief: '시공 2주 뒤 QC로 다시 들어온 날(또는 출고 직전 마지막 점검)에서 시작한다. 그때 무엇을 보고 무엇을 확인했는지를 먼저 쓰고, 그 자리들이 시공 때 어떻게 만들어졌는지 거꾸로 돌아가 2곳만 설명한다. 관리 안내는 이 흐름 안에 자연스럽게 녹인다(따로 블록 만들지 않음).',
    detect: /^.{0,60}(QC|2주 뒤|다시 (들어온|오신))/m,
  },
  {
    key: 'scene',
    name: '완성 뒤 한 장면',
    brief: '완성 사진을 설명하는 대신, 출고할 때의 한 장면(고객이 차 주위를 도는 모습, 지하주차장 조명 아래 보이는 면, 도어를 닫았을 때 이어지는 질감 등) 하나로 시작한다. 그 장면이 왜 그렇게 보이는지를 만든 작업 2곳만 설명하고, 다른 부위는 한 문장으로 정리한다. "완성된 모습부터 보여드립니다" 류 문장은 쓰지 않는다.',
    detect: /^.{0,80}(출고(하|할|하던) (날|때|순간)|출고 날|차 키를|조명 아래|주차장 (조명|불빛))/m,
  },
];

/** 본문 앞부분으로 이전 글의 형식을 짐작한다 (못 찾으면 null) */
export function detectFormat(body: string): BlogFormat | null {
  const head = body.split('\n').map(l => l.trim()).filter(l => l && !/^\[사진/.test(l)).slice(0, 12).join('\n');
  return BLOG_FORMATS.find(f => f.detect && f.detect.test(head)) || null;
}

/** 최근 글에 쓰인 형식을 피해 하나 고른다. 전부 쓰였으면 가장 오래전에 쓰인 것 */
export function pickFormat(recentKeys: (string | null)[]): BlogFormat {
  const used = recentKeys.filter((k): k is string => Boolean(k));
  const unused = BLOG_FORMATS.filter(f => !used.includes(f.key));
  if (unused.length > 0) return unused[Math.floor(Math.random() * unused.length)];
  // recentKeys 는 최신순 → 뒤에 있을수록 오래전
  const lastIndex = (key: string) => recentKeys.indexOf(key);
  return [...BLOG_FORMATS].sort((a, b) => lastIndex(b.key) - lastIndex(a.key))[0];
}

export function formatByKey(key: string | null | undefined): BlogFormat | null {
  return BLOG_FORMATS.find(f => f.key === key) || null;
}

/** 채팅·메모에서 사장님이 형식을 지정했으면 찾는다: "형식: 기본", "평범한 시공기로", "작업 일지로 써줘" */
export function formatFromMessage(text: string): BlogFormat | null {
  const t = text || '';
  if (/평범한 시공기|기본 시공기|보통 시공기|형식\s*[:：]\s*(기본|평범|보통)/.test(t)) return formatByKey('standard');
  const m = t.match(/형식\s*[:：]\s*([^\n.。,]+)/);
  const want = m ? m[1].trim() : '';
  const byName = (s: string) => BLOG_FORMATS.find(f => s.includes(f.name) || f.name.includes(s));
  if (want) { const f = byName(want); if (f) return f; }
  for (const f of BLOG_FORMATS) if (f.key !== 'standard' && new RegExp(f.name + '(으)?로').test(t)) return f;
  return null;
}

/**
 * 몸통에서 글마다 되풀이되던 관용구 (2026-11-13, 최근 12편 비교).
 * 이전 글에도 있고 이번 글에도 있으면 1회 수정에서 다른 말로 바꾸거나 뺀다.
 * minCount: 공정 표현처럼 한 번은 자연스러운 것은 그 횟수 이상일 때만 잡는다
 */
export const STOCK_PHRASES: { key: string; label: string; re: RegExp; minCount?: number }[] = [
  { key: 'numbered', label: '"가장 이야기하고 싶은 부분 → 두 번째로 → 세 번째는" 번호 매긴 부위 소개', re: /(가장 이야기하고 싶은|두 번째로|세 번째[는로])/g },
  { key: 'edge_wrap', label: '"끝단을 안쪽으로 말아 넣었다" 3회 이상', re: /안쪽으로 (말아|넘겨|넘기|충분히)|안쪽까지 (돌|넘)/g, minCount: 3 },
  { key: 'years', label: '"한 번 마감하면 수년을 타는데"', re: /수년을 타/g },
  { key: 'personally', label: '"개인적으로"로 시작하는 감상', re: /개인적으로/g },
  { key: 'factory', label: '"원래 이렇게 출고됐어도"', re: /출고(됐|되었)어도/g },
  { key: 'visible', label: '"시공한 티가 난다"', re: /시공한 티/g },
  { key: 'other_car', label: '"완전히 다른 차"', re: /완전히 다른 차/g },
  { key: 'one_tone', label: '"면 전체가 한 톤으로"', re: /한 톤으로/g },
  { key: 'heavy', label: '"묵직한 질감"', re: /묵직한 질감/g },
  { key: 'no_reason', label: '"그 시간을 아낄 이유가 없다"', re: /아낄 이유가/g },
];

export function stockPhrasesIn(body: string): string[] {
  return STOCK_PHRASES.filter(p => (body.match(p.re) || []).length >= (p.minCount || 1)).map(p => p.key);
}
