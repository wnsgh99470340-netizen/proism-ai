import { NextRequest } from 'next/server';
import { markdownToNaverHtml } from '@/lib/blog-formatter';
import { createBlogPage } from '@/lib/notion';

export async function POST(request: NextRequest) {
  try {
    const { title, content, tags, images = [], carModel, service } = await request.json();

    if (!title || !content) {
      return Response.json({ error: '제목과 본문을 입력해주세요.' }, { status: 400 });
    }

    const html = markdownToNaverHtml(content, images);

    const fullHtml = `<div style="font-family:'Pretendard',sans-serif;">
<h2 style="font-size:22px;font-weight:700;margin-bottom:20px;color:#1a1a1a;">${title}</h2>
${html}
${tags && tags.length > 0 ? `<p style="margin-top:30px;color:#888;font-size:13px;">${tags.map((t: string) => `#${t}`).join(' ')}</p>` : ''}
</div>`;

    // Notion 블로그 발행 이력 저장 (실패해도 발행 결과는 반환)
    try {
      await createBlogPage({
        title,
        carModel: carModel || null,
        service: service || null,
        published: false,
        preview: content.slice(0, 300),
      });
    } catch (notionErr) {
      console.warn('[Publish] Notion 블로그 저장 실패 (무시):', notionErr);
    }

    return Response.json({
      success: true,
      html: fullHtml,
      title,
      tags,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '발행 실패';
    return Response.json({ error: msg }, { status: 500 });
  }
}
