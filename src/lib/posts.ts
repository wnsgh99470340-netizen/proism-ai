import { supabase } from './supabase';

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
  const samples = owners.length > 0 ? pickRandom(owners, 3) : finals.slice(0, 3);
  const sampleText = samples
    .map((p, i) => `[참고 글 ${i + 1}] ${p.title}\n${excerpt(p.body.replace(/\[사진\s*\d+\]/g, '').trim(), 3000)}`)
    .join('\n\n');

  const feedbacks = Array.from(new Set(
    finals.map(f => (f.feedback || '').trim()).filter((f) => f && !f.startsWith('source:'))
  )).slice(0, 15);
  const feedbackText = feedbacks.length > 0
    ? `\n\n[사장님이 이전 초안에 남긴 교정 피드백 — 반드시 반영]\n${feedbacks.map(f => `- ${f}`).join('\n')}`
    : '';

  return `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[사장님 문체 참고 — DB에 저장된 실제 글 ${samples.length}편]
문장을 베끼지 말고 말투·호흡·단어 선택·문단 길이만 따라 하세요. 아래 글의 차량·제품·사실을 이번 글에 가져오면 안 됩니다.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${sampleText}${feedbackText}`;
}
