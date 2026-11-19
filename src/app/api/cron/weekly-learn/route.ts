import { NextRequest, after } from 'next/server';
import { isAuthCookieValid } from '@/lib/auth-cookie';
import { importOwnerBlog } from '@/lib/blog-import';
import { buildOwnerStyle } from '@/lib/owner-style';
import { sendPushToAll } from '@/lib/push';

export const maxDuration = 300;

/**
 * POST /api/cron/weekly-learn { force?: boolean } — 내 블로그 글 자동 학습 (2026-11-19)
 * 월요일 07시 /api/cron/daily 가 x-job-secret 으로 부른다(로그인 쿠키로 직접 눌러도 됨). 즉시 202, 실제 일은 after() 에서:
 *   (1) blog.naver.com/roice_ 전체 목록에서 아직 없는 글을 blog_posts kind=owner 로 가져옴 (한 번에 40편)
 *   (2) 새 글이 있으면(또는 force) 사장님 글 기준(style/owner-style.json) 다시 만듦
 *   (3) 푸시 한 줄. 새 글이 없으면 조용히 끝난다
 * 미리보기 "내 블로그 전체 글 불러오기 → 사장님 글 기준 만들기" 버튼을 사람이 안 눌러도 돌게 한 것
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const secretOk = Boolean(secret) && request.headers.get('x-job-secret') === secret;
  const cookieOk = await isAuthCookieValid(request.cookies.get('crm_auth')?.value);
  if (!secretOk && !cookieOk) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let force = false;
  try { force = Boolean((await request.json())?.force); } catch { /* 본문 없음 */ }

  after(async () => {
    try {
      const r = await importOwnerBlog(40);
      const n = r.imported.length;
      let rebuilt = false;
      if (n > 0 || force) {
        const s = await buildOwnerStyle();
        rebuilt = true;
        console.log(`[weekly-learn] 새 글 ${n}편, 기준 갱신 (글 ${s.postCount}편 기준)`);
      } else {
        console.log('[weekly-learn] 새 글 없음, 기준 그대로');
      }
      if (n > 0 || force) {
        const titles = r.imported.slice(0, 2).map((i) => i.title).join(' / ');
        await sendPushToAll({
          title: '📚 내 블로그 글 배우기',
          body: n > 0 ? `새 글 ${n}편 가져와 글 기준을 다시 만들었습니다${titles ? `: ${titles}` : ''}${r.remaining ? ` · 다음 주에 ${r.remaining}편 더` : ''}` : '글 기준을 다시 만들었습니다',
          url: '/crm?tab=blog', tag: 'weekly-learn',
        }).catch(() => null);
      }
      if (r.failed.length) console.warn('[weekly-learn] 본문 못 읽은 글:', r.failed.map((f) => f.title).join(', '));
      void rebuilt;
    } catch (e) {
      console.error('[weekly-learn] 실패:', e);
    }
  });

  return Response.json({ accepted: true, force }, { status: 202 });
}
