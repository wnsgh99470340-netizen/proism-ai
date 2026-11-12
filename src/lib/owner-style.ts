/**
 * 사장님 글에서 배운 기준 (2026-11-12 사장님: "규칙을 하나씩 쌓지 말고 내 블로그 글 전부에서 배워라")
 * - 입력: blog_posts kind=owner 전체 (네이버 블로그에서 가져온 글 + 직접 추가한 글)
 * - 어휘: 후보 용어 목록을 전체 글에서 세어 "쓰는 말 / 안 쓰는 말"을 결정론적으로 뽑는다
 * - 문체 카드: 시공 종류별 대표 글을 Claude 에 보여 도입·자기소개·작업 묘사 수준·관리 안내·마무리 패턴을 요약
 * - 저장: Vercel Blob style/owner-style.json (글 생성 때 읽어 프롬프트에 붙인다, 5분 캐시)
 */
import { list, put } from '@vercel/blob';
import { listPosts, type BlogPost } from './posts';
import { callClaude } from './claude-client';

export interface OwnerStyle {
  builtAt: string;
  postCount: number;
  usedTerms: { term: string; count: number }[];
  unusedTerms: string[];
  card: string;
  sampleTitles: string[];
}

const BLOB_PATH = 'style/owner-style.json';

/** 부위·공정 후보 용어. 전체 글에서 2회 이상 나온 것만 "쓰는 말"로 인정 */
const CANDIDATE_TERMS = [
  // 부위
  '본넷', '보닛', '휀다', '휀더', '앞범퍼', '뒷범퍼', '범퍼', '도어', '루프', '트렁크', '그릴', '헤드라이트', '테일램프', '사이드미러', '손잡이', '도어캐치', '도어컵', '도어엣지',
  '필러', 'A필러', 'B필러', 'C필러', '주유구', '엠블럼', '디퓨저', '스포일러', '사이드스텝', '사이드스커트', '휠', '캘리퍼', '윈도우몰딩', '몰딩', '크롬', '트렁크리드',
  '안개등', '번호판', '키드니그릴', '썬루프', '파노라마', '앞유리', '뒷유리', '측면유리', '실내', '대시보드', '센터페시아', '콘솔', '피아노블랙', '트림', '라인',
  '카울', '휠아치', '휠하우스', '에어브리더', '벨트라인', '숄더라인', '스플리터', '에어커튼', '에어덕트', '인테이크', '캐릭터라인', '프레스라인', '립',
  // 공정·관리
  '습식', '건식', '판시공', '핸드커팅', '안쪽마감', '말아', '탈거', '재단', '밀착', '슬라이딩', '스퀴지', '열성형', '수축', '스팀', '보양', '클리닝', '탈지', '세차',
  '철분', '디테일링', '광택', '폴리싱', '마스킹', '텐션', '장력', '기포', '물자국', 'QC', '메인터넌스', '셀프힐링', '발수', '스톤칩', '잔기스', '워시마크', '끝단', '경계',
  '겹침', '오버랩', '커팅라인', '고압수', '손세차', '자동세차', '왁스', '유리막', '코팅',
];

function countTerms(bodies: string[]): { used: { term: string; count: number }[]; unused: string[] } {
  const all = bodies.join('\n');
  const used: { term: string; count: number }[] = [];
  const unused: string[] = [];
  for (const term of CANDIDATE_TERMS) {
    const n = all.split(term).length - 1;
    if (n >= 2) used.push({ term, count: n }); else unused.push(term);
  }
  used.sort((a, b) => b.count - a.count);
  return { used, unused };
}

/** 시공 종류별 최근 글 2편 + 나머지 최근 글로 최대 14편 */
function pickSamples(posts: BlogPost[]): BlogPost[] {
  const byType = new Map<string, BlogPost[]>();
  for (const p of posts) {
    const k = p.service_type || '기타';
    if (!byType.has(k)) byType.set(k, []);
    byType.get(k)!.push(p);
  }
  const picked: BlogPost[] = [];
  for (const arr of byType.values()) picked.push(...arr.slice(0, 2));
  for (const p of posts) { if (picked.length >= 14) break; if (!picked.includes(p)) picked.push(p); }
  return picked.slice(0, 14);
}

const trim = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n) + '\n(…이하 생략)');

export async function buildOwnerStyle(): Promise<OwnerStyle> {
  const posts = await listPosts('owner', 400);
  if (posts.length === 0) throw new Error('사장님 글이 없습니다. 먼저 블로그 글을 불러와 주세요.');
  const { used, unused } = countTerms(posts.map(p => p.body));
  const samples = pickSamples(posts);
  const sampleText = samples.map((p, i) => `[글 ${i + 1}] ${p.title} (${p.service_type || '-'})\n${trim(p.body.replace(/\[사진\s*\d+\]/g, '').trim(), 2500)}`).join('\n\n');

  const prompt = `아래는 3M 프로이즘 강남서초점 대표가 네이버 블로그에 직접 쓴 시공기 ${samples.length}편입니다 (전체 ${posts.length}편 중 시공 종류별 대표). 이 글들을 읽고 "이 사람이 글을 어떻게 쓰는지"를 다음 글을 쓸 라이터에게 넘길 기준으로 정리하세요.

조건:
- 글에 실제로 있는 것만 적는다. 추측·일반론 금지. 각 항목은 글에서 가져온 짧은 예시 표현을 1~2개 붙인다(문장 통째 인용 말고 표현 단위)
- 한국어, 2,500자 이내, 아래 제목 순서 그대로, 각 제목 아래 3~6줄
1. 말투와 호흡 (문장 길이, 종결어미, 독자에게 말 거는 방식)
2. 도입 방식 (어떤 이야기로 시작하는지 유형별)
3. 자기소개 (어떤 문장으로 어느 자리에 소개하는지)
4. 작업 묘사의 수준 (어떤 디테일까지 쓰고 어떤 건 안 쓰는지, 시공 종류별로)
5. 관리 안내 (시공 뒤 고객에게 실제로 하는 안내만)
6. 마무리 (끝맺는 방식, 연락처 앞뒤 문장)
7. 자주 쓰는 표현 15개
8. 이 글들에 없는 것 (라이터가 흔히 넣지만 이 사람은 안 쓰는 것)

${sampleText}`;
  const card = (await callClaude('당신은 글쓰기 기준을 정리하는 편집자입니다. 지시한 형식으로만 답합니다.', [{ role: 'user', content: prompt }], 3000, 'claude-sonnet-4-6')).trim();

  const style: OwnerStyle = { builtAt: new Date().toISOString(), postCount: posts.length, usedTerms: used, unusedTerms: unused, card, sampleTitles: samples.map(s => s.title) };
  await put(BLOB_PATH, JSON.stringify(style), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
  cached = { at: Date.now(), style };
  return style;
}

let cached: { at: number; style: OwnerStyle | null } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function getOwnerStyle(): Promise<OwnerStyle | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.style;
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
    const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
    const b = blobs[0];
    if (!b) { cached = { at: Date.now(), style: null }; return null; }
    const res = await fetch(b.url, { cache: 'no-store' });
    const style = (await res.json()) as OwnerStyle;
    cached = { at: Date.now(), style };
    return style;
  } catch (e) {
    console.warn('[owner-style] load failed:', e);
    return null;
  }
}

/** 작성 프롬프트에 붙이는 블록 */
export function styleToPrompt(style: OwnerStyle): string {
  const used = style.usedTerms.map(t => t.term).join(', ');
  const unused = style.unusedTerms.join(', ');
  return `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[사장님 글에서 배운 기준 — 블로그 ${style.postCount}편 전체, ${style.builtAt.slice(0, 10)}]
이 기준이 위의 일반 규칙보다 우선한다. 작업 묘사·관리 안내·부위 이름은 여기 있는 수준과 말 안에서만 쓴다.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
사장님이 쓰는 부위·공정 말 (이 안에서만): ${used}
사장님 글에 없는 말 (쓰지 않는다): ${unused}

${style.card}`;
}
