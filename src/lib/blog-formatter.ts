export function markdownToNaverHtml(content: string, images: string[]): string {
  let html = content;

  // 이미지 플레이스홀더 치환
  html = html.replace(/\[IMAGE:(\d+)\]/g, (_, idx) => {
    const i = parseInt(idx) - 1;
    if (images[i]) {
      return `<div style="text-align:center;margin:20px 0;"><img src="${images[i]}" style="max-width:100%;border-radius:8px;" /></div>`;
    }
    return '';
  });

  // 줄바꿈 → <br>
  html = html.replace(/\n\n/g, '</p><p style="margin:16px 0;line-height:1.8;">');
  html = html.replace(/\n/g, '<br/>');

  // 볼드
  html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

  // 구분선
  html = html.replace(/---/g, '<hr style="border:none;border-top:1px solid #e0e0e0;margin:30px 0;"/>');

  // 전체 래핑
  html = `<div style="font-family:'Pretendard',sans-serif;max-width:720px;margin:0 auto;padding:20px;line-height:1.8;color:#333;font-size:16px;">
<p style="margin:16px 0;line-height:1.8;">${html}</p>
</div>`;

  return html;
}

export function extractDraft(text: string): {
  title: string;
  content: string;
  tags: string[];
  category: string;
} | null {
  const match = text.match(/---BLOG_DRAFT---\s*([\s\S]*?)\s*---END_DRAFT---/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}
