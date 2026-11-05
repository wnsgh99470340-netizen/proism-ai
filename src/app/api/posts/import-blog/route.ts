import { NextRequest } from 'next/server';
import { importOwnerBlog, fetchOwnerRss } from '@/lib/blog-import';

export const maxDuration = 120;

/** GET /api/posts/import-blog — RSS 목록만 미리보기 */
export async function GET() {
  try {
    const items = await fetchOwnerRss();
    return Response.json({ count: items.length, items: items.map((i) => ({ title: i.title, url: i.url, pubDate: i.pubDate })) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '알 수 없는 오류' }, { status: 500 });
  }
}

/** POST /api/posts/import-blog { limit? } — 새 글을 사장님 글 DB(owner)로 가져오기 */
export async function POST(request: NextRequest) {
  try {
    let limit = 20;
    try { const b = await request.json(); if (b?.limit) limit = Math.min(Math.max(Number(b.limit), 1), 50); } catch { /* 본문 없음 */ }
    const result = await importOwnerBlog(limit);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '알 수 없는 오류' }, { status: 500 });
  }
}
