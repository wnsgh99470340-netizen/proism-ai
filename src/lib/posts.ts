import { supabase } from './supabase';
import { isOwnerVoiceTitle } from '@/config/owner-voice-posts';

/**
 * 사장님 글 데이터베이스 (Supabase blog_posts 테이블)
 * - owner: 사장님이 직접 쓴 글 (톤 기준)
 * - draft: AI 초안 (이전 글 목록·중복 방지용)
 * - final: 사장님이 고쳐서 확정한 글 + 피드백 (톤 학습 + 반드시 지킬 교정 사항)
 * 테이블이 없거나 연결이 안 되면 모든 함수가 빈 값으로 조용히 실패한다.
 */
export type PostKind = 'owner' | 'draft' | 'final';

export interface BlogPost {
  id: string;
  kind: PostKind;
  title: string;
  body: string;
  car_model?: string | null;
  service_type?: string | null;
  product?: string | null;
  region?: string | null;
  feedback?: string | null;
  draft_id?: string | null;
  created_at?: string;
}

export type NewBlogPost = Omit<BlogPost, 'id' | 'created_at'>;

export async function savePost(input: NewBlogPost): Promise<BlogPost | null> {
  try {
    const { data, error } = await supabase.from('blog_posts').insert(input).select().single();
    if (error) { console.warn('[posts] insert failed:', error.message); return null; }
    return data as BlogPost;
  } catch (e) {
    console.warn('[posts] insert error:', e);
    return null;
  }
}

/** 같은 초안을 덮어쓰기 (2026-11-18 사장님: 수정할 때마다 글이 하나씩 늘지 않게). 없으면 null */
export async function updatePost(id: string, patch: Partial<NewBlogPost>): Promise<BlogPost | null> {
  try {
    const { data, error } = await supabase.from('blog_posts').update(patch).eq('id', id).select().single();
    if (error) { console.warn('[posts] update failed:', error.message); return null; }
    return data as BlogPost;
  } catch (e) {
    console.warn('[posts] update error:', e);
    return null;
  }
}

export async function getPost(id: string): Promise<BlogPost | null> {
  try {
    const { data, error } = await supabase.from('blog_posts').select('*').eq('id', id).single();
    if (error || !data) return null;
    return data as BlogPost;
  } catch {
    return null;
  }
}

export async function listPosts(kind?: PostKind, limit = 20): Promise<BlogPost[]> {
  try {
    let q = supabase.from('blog_posts').select('*').order('created_at', { ascending: false }).limit(limit);
    if (kind) q = q.eq('kind', kind);
    const { data, error } = await q;
    if (error) { console.warn('[posts] list failed:', error.message); return []; }
    return (data || []) as BlogPost[];
  } catch {
    return [];
  }
}

export async function deletePost(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('blog_posts').delete().eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

/** 글자 수 제한으로 앞부분만 (문단 경계에서 자름) */
function excerpt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastBreak = cut.lastIndexOf('\n');
  return (lastBreak > maxChars * 0.6 ? cut.slice(0, lastBreak) : cut) + '\n(…이하 생략)';
}

/**
 * 글 생성 프롬프트에 붙일 "사장님 문체 참고" 블록.
 * - owner/final 최근 글 최대 3편의 앞부분 (각 700자)
 * - final 에 남긴 피드백 최근 15개 (중복 제거)
 * 글이 없으면 빈 문자열.
 */
/**
 * 이 시스템이 써서 발행된 글인지 (2026-11-19): 제목이 초안·최종본과 같거나, 본문 줄의 30% 이상이 어떤 초안·최종본과 그대로 겹치면 AI 글.
 * 사장님이 제목을 바꿔 발행하면 제목 비교만으로는 못 잡아 사장님 글 기준·문체 참고에 AI 글이 섞였던 일
 */
const normAi = (s: string) => s.replace(/\s+/g, '').toLowerCase();
/** 어느 글에나 있는 줄(연락처·주소·서명·인사·해시태그)은 겹침 계산에서 뺀다 */
const AI_FIXED_RE = /010-|서초중앙로|서울특별시|서초구|강남서초점|프로이즘|감사합니다|안녕하세요|톡톡|^#/;
const lineSetOf = (body: string) => new Set(body.replace(/<[^>]+>/g, '\n').split('\n').filter(l => !AI_FIXED_RE.test(l.trim())).map(l => normAi(l)).filter(l => l.length >= 10));
export function aiPostIndex(aiPosts: BlogPost[]): { title: string; lines: Set<string> }[] {
  return aiPosts.map(p => ({ title: normAi(p.title), lines: lineSetOf(p.body) }));
}
export function looksAiWritten(p: BlogPost, index: { title: string; lines: Set<string> }[]): boolean {
  const t = normAi(p.title);
  if (index.some(a => a.title === t)) return true;
  const lines = [...lineSetOf(p.body)];
  if (lines.length < 20) return false;
  // (1) 어느 한 초안·최종본과 줄의 30% 이상 겹침 (2026-11-19)
  if (index.some(a => { let hit = 0; for (const l of lines) if (a.lines.has(l)) hit++; return hit / lines.length >= 0.3; })) return true;
  // (2) 2026-11-20: 사장님이 많이 고쳐 올린 AI 글(M2 17줄·GV70 8줄 겹침)이 (1)을 빠져나가 문체 참고로 다시 들어왔음
  //     → 전체 초안·최종본 줄과 합쳐 6줄 이상 겹치면, 또는 2026-10 이후 글이 4줄 이상 겹치면 AI 글로 본다
  //     (사장님이 직접 쓴 옛 글은 많아야 5줄 안팎: 마세라티 2026-04 5줄)
  const all = new Set<string>();
  for (const a of index) for (const l of a.lines) all.add(l);
  let hit = 0; for (const l of lines) if (all.has(l)) hit++;
  const recent = (p.created_at || '') >= '2026-10-01';
  return hit >= 6 || (recent && hit >= 4);
}

/** 배열에서 n개를 무작위로 (문체 참고 글을 매번 같은 2편으로 주지 않기 위해, 2026-11-19) */
function pickRandom<T>(arr: T[], n: number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

export async function buildToneReference(_serviceType?: string): Promise<string> {
  const [ownersAll, finals, drafts] = await Promise.all([listPosts('owner', 400), listPosts('final', 20), listPosts('draft', 40)]);
  if (ownersAll.length === 0 && finals.length === 0) return '';

  // 사장님 글 중 이 시스템이 쓴 글(제목 바꿔 발행한 것 포함)은 문체 참고에서 뺀다 — AI 가 자기 글을 다시 배우면 같은 글이 된다
  const aiIdx = aiPostIndex([...finals, ...drafts]);
  const owners = ownersAll.filter((o) => !looksAiWritten(o, aiIdx));

  // 참고 글 (2026-11-19 사장님 "최근 10편 중 2편이 아니라 총 게시글 중 무작위 3편으로"): 같은 시공 종류 우선 없이 전체에서 3편, 각 3000자
  // (이전: 같은 종류 최신 2편 전문 + 1편 앞부분 → 그 2편의 문장이 다음 글마다 되풀이됐음)
  const samples = owners.length > 0 ? pickRandom(owners, 2) : finals.slice(0, 2); // 2026-11-20 재설계: 2편
  const sampleText = samples
    .map((p, i) => `[참고 글 ${i + 1}] ${p.title}\n${excerpt(p.body.replace(/\[사진\s*\d+\]/g, '').trim(), 2500)}`)
    .join('\n\n');
  // 2026-11-20 정리: "교정 피드백 — 반드시 반영" 블록은 뺐다(final 의 feedback 이 수정 이력 창고가 되어 2.6K 가 매 글에 들어가고 있었음)
  return `\n\n[사장님 글 ${samples.length}편 — 말투·호흡·문단 길이만 참고. 문장과 차량·제품·사실은 가져오지 않는다]\n${sampleText}`;
}

/** 차종 문자열에서 브랜드와 모델 토큰을 나눈다 ("아우디 Q7" → 아우디 / Q7) */
const BRANDS = ['아우디', 'BMW', '벤츠', '메르세데스', '포르쉐', '테슬라', '제네시스', '현대', '기아', '랜드로버', '레인지로버', '벤틀리', '마세라티', '볼보', '렉서스', '토요타', '폭스바겐', '미니', '람보르기니', '페라리', '롤스로이스', '쉐보레', '지프', '링컨', '캐딜락', '푸조', '재규어'];
export function splitCarModel(carModel: string): { brand: string | null; model: string } {
  const t = carModel.trim();
  const brand = BRANDS.find(b => t.toLowerCase().startsWith(b.toLowerCase())) || null;
  const model = brand ? t.slice(brand.length).trim() : t;
  return { brand, model };
}

/**
 * 조사 단계에서 사장님이 같은 차종(없으면 같은 브랜드)·같은 시공에 대해 전에 쓴 글을 찾는다 (2026-11-20 사장님:
 * "조사에서 차종이랑 내가 쓴 글을 찾아보고 작성하라고 했을 텐데" — 그동안 조사는 roice_ 를 일부러 빼고 말투용 무작위 3편만 썼음).
 * AI 가 쓴 글은 제외. 점수: 모델 토큰 일치 3, 브랜드 1, 같은 시공 2. 상위 2편 전문(3,000자) + 나머지 제목
 */
export async function ownerPostsForCar(carModel: string, serviceType: string, hint = ''): Promise<{ context: string; summary: string; count: number }> {
  // 요청문에 적힌 제품·부위 말(레인보우·IS200·크리스탈라인·본넷 …)이 제목에도 있으면 가산 — 같은 제품을 다룬 글이 먼저 오게
  const hintTokens = Array.from(new Set((hint.match(/[A-Za-z0-9]{3,}|[가-힣]{2,}/g) || []).filter(t => !/^(시공기|써줘|사진|폴더|부위|이것만|않기|지정|전면|측면|후면|작성)$/.test(t))));
  const { brand, model } = splitCarModel(carModel);
  if (!brand && !model) return { context: '', summary: '', count: 0 };
  const [owners, finals, drafts] = await Promise.all([listPosts('owner', 400), listPosts('final', 40), listPosts('draft', 60)]);
  const aiIdx = aiPostIndex([...finals, ...drafts]);
  const svc = serviceType.replace(/\(.*\)/, '');
  const modelRe = model ? new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'i') : null;
  const scored = owners
    .filter(p => !looksAiWritten(p, aiIdx))
    .map(p => {
      const hay = `${p.title} ${p.car_model || ''}`;
      let score = 0;
      if (modelRe && modelRe.test(hay)) score += 3;
      if (brand && hay.includes(brand)) score += 1;
      if (svc && (p.service_type || '').includes(svc)) score += 2;
      score += Math.min(4, hintTokens.filter(t => p.title.includes(t)).length); // 같은 제품(레인보우 IS200)을 다룬 글이 최신 글보다 앞서게
      return { p, score };
    })
    .filter(x => x.score >= 3 || (x.score >= 1 && brand && x.p.title.includes(brand)))
    .sort((a, b) => b.score - a.score || (b.p.created_at || '').localeCompare(a.p.created_at || ''));
  if (scored.length === 0) return { context: '', summary: '', count: 0 };
  const top = scored.slice(0, 2);
  const others = scored.slice(2, 8);
  const body = (p: BlogPost) => excerpt(p.body.replace(/\[사진\s*\d+\]/g, '').trim(), 3000);
  const context = `[사장님이 같은 차종·브랜드에 대해 전에 쓴 글 ${scored.length}편 — 여기 적힌 제품 설명·관리 안내·부위 이름·판단은 사실로 가져와도 된다. 단 그 차에서 한 작업을 이 차에서 한 것으로 옮기지는 않는다]
${top.map((x, i) => `[사장님 글 ${i + 1}] ${x.p.title} (${x.p.created_at?.slice(0, 10) || ''}, ${x.p.service_type || '-'})\n${body(x.p)}`).join('\n\n')}${others.length ? `\n\n그 밖의 같은 차종·브랜드 글 제목: ${others.map(x => x.p.title).join(' / ')}` : ''}`;
  const summary = `사장님 글 참고: 같은 차종·브랜드 ${scored.length}편 중 전문 ${top.length}편 — ${top.map(x => x.p.title).join(' / ')}`;
  return { context, summary, count: scored.length };
}

/**
 * 말투 참고 — 사장님이 직접 쓴 FAQ·공지 글 중 무작위 n편 (2026-11-20 사장님 "FAQ나 공지글 참고해").
 * 시공기는 실장·AI 글이 섞여 있어 말투 기준에서 뺀다. 목록은 src/config/owner-voice-posts.ts
 */
export async function ownerVoiceReference(n = 2): Promise<string> {
  const owners = await listPosts('owner', 400);
  const pool = owners.filter(p => isOwnerVoiceTitle(p.title) && p.body.replace(/\s/g, '').length >= 1500);
  if (pool.length === 0) return '';
  const picked = pickRandom(pool, n);
  return `\n\n[사장님이 직접 쓴 글 ${picked.length}편 — 말투·호흡·독자에게 말 거는 방식만 참고. 주제·주장·문장은 가져오지 않는다]\n${picked.map((p, i) => `[사장님 글 ${i + 1}] ${p.title}\n${excerpt(p.body.replace(/\[사진\s*\d+\]/g, '').trim(), 2500)}`).join('\n\n')}`;
}

/**
 * 사장님이 전에 쓴 글에서 이 주제에 대한 입장 찾기 (FAQ 글용, 2026-11-21)
 * 주제어가 제목·본문에 많이 나오는 사장님 글(AI 글 제외) 상위 n편에서, 주제어가 든 문단만 모아 준다
 */
export async function ownerStanceForTopic(topic: string, n = 3): Promise<{ context: string; summary: string; count: number }> {
  const tokens = Array.from(new Set((topic.match(/[A-Za-z0-9]{2,}|[가-힣]{2,}/g) || []).filter(t => !/^(글|관련|대해|대한|무엇|어떻게|하나요|인가요|있나요|해도|되나요|경우|이유|방법|정리|질문)$/.test(t))));
  if (tokens.length === 0) return { context: '', summary: '', count: 0 };
  const [owners, finals, drafts] = await Promise.all([listPosts('owner', 400), listPosts('final', 40), listPosts('draft', 60)]);
  const aiIdx = aiPostIndex([...finals, ...drafts]);
  const scored = owners
    .filter(p => !looksAiWritten(p, aiIdx))
    .map(p => {
      const body = p.body.replace(/<[^>]+>/g, '\n');
      const score = tokens.reduce((a, t) => a + (p.title.includes(t) ? 3 : 0) + Math.min(5, body.split(t).length - 1), 0);
      return { p, body, score };
    })
    .filter(x => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
  if (scored.length === 0) return { context: '', summary: '사장님 글 중 이 주제를 다룬 글 없음', count: 0 };
  const blocks = scored.map((x, i) => {
    const paras = x.body.split(/\n\s*\n/).map(s => s.trim()).filter(s => s.length >= 20 && tokens.some(t => s.includes(t))).slice(0, 6);
    return `[사장님 글 ${i + 1}] ${x.p.title} (${x.p.created_at?.slice(0, 10) || ''})\n${paras.join('\n\n').slice(0, 1500)}`;
  });
  return {
    context: `[사장님이 전에 쓴 글에서 이 주제에 대한 입장 — 여기 적힌 판단·기준·권장은 사장님 입장으로 써도 된다. 옛 글의 금지 항목(경력 연수·직접 시공·톡톡·상담 공짜)은 가져오지 않는다]\n${blocks.join('\n\n')}`,
    summary: `사장님 글 참고(입장): ${scored.map(x => x.p.title).join(' / ')}`,
    count: scored.length,
  };
}
