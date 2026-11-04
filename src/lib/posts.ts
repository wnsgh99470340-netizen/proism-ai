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
export async function buildToneReference(): Promise<string> {
  const [owners, finals] = await Promise.all([listPosts('owner', 10), listPosts('final', 20)]);
  if (owners.length === 0 && finals.length === 0) return '';

  // 참고 글: owner 우선, 부족하면 final 로 채워 최대 3편
  const samples = [...owners, ...finals].slice(0, 3);
  const sampleText = samples
    .map((p, i) => `[참고 글 ${i + 1}] ${p.title}\n${excerpt(p.body.replace(/\[사진\s*\d+\]/g, '').trim(), 700)}`)
    .join('\n\n');

  const feedbacks = Array.from(new Set(
    finals.map(f => (f.feedback || '').trim()).filter(Boolean)
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
