/**
 * 사장님 네이버 블로그(roice_) → 사장님 글 DB(blog_posts, kind=owner) 가져오기
 * - 목록: RSS (최근 50편). 네이버 모바일 API는 403이라 RSS 사용
 * - 본문: 우리 서버가 m.blog.naver.com 페이지를 모바일 UA로 직접 읽음 (fetchNaverPostText)
 * - 중복: 같은 제목의 owner 글이 이미 있으면 건너뜀
 * - created_at 은 블로그 발행일로 저장해 "최근 글" 순서가 실제 발행 순서와 같게 한다
 */
import { supabase } from './supabase';
import { fetchNaverPostText, extractServiceType, extractCarModel } from './blog-research';

export const OWNER_BLOG_ID = 'roice_';
const RSS_URL = `https://rss.blog.naver.com/${OWNER_BLOG_ID}.xml`;
const MIN_BODY_CHARS = 500;     // 이보다 짧으면 본문 읽기 실패로 보고 건너뜀
const BODY_MAX_CHARS = 8000;
const FETCH_CONCURRENCY = 3;

export interface RssItem { title: string; url: string; logNo: string; pubDate: string; description: string }

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .trim();
}

/** 본문 정리: 컨테이너 태그 찌꺼기·제로폭 공백 제거, 줄별 trim, 빈 줄 정리 */
export function cleanBody(raw: string): string {
  return raw
    .replace(/^[^\n]*se-main-container[^\n]*?>\s*/i, '')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join('\n')
    .trim();
}

export async function fetchOwnerRss(): Promise<RssItem[]> {
  const res = await fetch(RSS_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' },
  });
  if (!res.ok) throw new Error(`RSS 읽기 실패 (${res.status})`);
  const xml = await res.text();
  const items: RssItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = (tag: string) => decode((block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`)) || [, ''])[1]);
    const link = pick('link');
    const logNo = (link.match(/\/(\d+)(?:\?|$)/) || [, ''])[1];
    if (!logNo) continue;
    items.push({
      title: pick('title'),
      url: `https://m.blog.naver.com/${OWNER_BLOG_ID}/${logNo}`,
      logNo,
      pubDate: pick('pubDate'),
      description: pick('description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
  }
  return items;
}

export interface ImportResult {
  imported: { title: string; chars: number }[];
  skippedExisting: number;
  /** 이번에 다 못 가져와 다음 클릭에서 이어서 가져올 글 수 */
  remaining: number;
  failed: { title: string; reason: string }[];
  total: number;
}

export async function importOwnerBlog(limit = 20): Promise<ImportResult> {
  const items = await fetchOwnerRss();
  const { data: existing, error } = await supabase.from('blog_posts').select('title').eq('kind', 'owner');
  if (error) throw new Error(`DB 조회 실패: ${error.message}`);
  const have = new Set((existing || []).map((r) => (r.title as string).trim()));

  const fresh = items.filter((it) => !have.has(it.title.trim()));
  const todo = fresh.slice(0, limit);
  const result: ImportResult = { imported: [], skippedExisting: items.length - fresh.length, remaining: fresh.length - todo.length, failed: [], total: items.length };

  // 본문은 3개씩 병렬로 읽는다
  for (let i = 0; i < todo.length; i += FETCH_CONCURRENCY) {
    const batch = todo.slice(i, i + FETCH_CONCURRENCY);
    await Promise.all(batch.map(async (it) => {
      const body = cleanBody(await fetchNaverPostText(it.url, BODY_MAX_CHARS));
      if (body.replace(/\s/g, '').length < MIN_BODY_CHARS) {
        result.failed.push({ title: it.title, reason: '본문을 읽지 못함' });
        return;
      }
      const pub = new Date(it.pubDate);
      const { error: insErr } = await supabase.from('blog_posts').insert({
        kind: 'owner',
        title: it.title,
        body,
        car_model: extractCarModel(it.title),
        service_type: extractServiceType(it.title),
        region: null,
        product: null,
        feedback: `source:${it.url}`,
        created_at: isNaN(pub.getTime()) ? new Date().toISOString() : pub.toISOString(),
      });
      if (insErr) result.failed.push({ title: it.title, reason: insErr.message });
      else result.imported.push({ title: it.title, chars: body.length });
    }));
  }
  return result;
}
