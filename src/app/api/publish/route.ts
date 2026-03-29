import { NextRequest } from 'next/server';
import { markdownToNaverHtml } from '@/lib/blog-formatter';

export async function POST(request: NextRequest) {
  try {
    const { title, content, tags, images = [] } = await request.json();

    if (!title || !content) {
      return Response.json({ error: '제목과 본문을 입력해주세요.' }, { status: 400 });
    }

    const html = markdownToNaverHtml(content, images);

    const fullHtml = `<div style="font-family:'Pretendard',sans-serif;">
<h2 style="font-size:22px;font-weight:700;margin-bottom:20px;color:#1a1a1a;">${title}</h2>
${html}
${tags && tags.length > 0 ? `<p style="margin-top:30px;color:#888;font-size:13px;">${tags.map((t: string) => `#${t}`).join(' ')}</p>` : ''}
</div>`;

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
