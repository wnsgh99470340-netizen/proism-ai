/**
 * 블로그 초안 포맷 유틸 (서버·클라이언트 공용)
 * - 저장된 글(plain text)을 미리보기용 draft 객체로 되살릴 때도 사용
 */

/** 제목에서 태그를 자동 추출 */
export function extractTagsFromTitle(title: string): string[] {
  const tags: string[] = [];

  const carBrands = ['BMW', '벤츠', '메르세데스', '포르쉐', '아우디', '테슬라', '제네시스', '렉서스', '볼보', '람보르기니', '페라리', '맥라렌', '롤스로이스', '벤틀리', '마세라티', '재규어', '랜드로버', '링컨', '캐딜락', '현대', '기아', '쉐보레'];
  for (const brand of carBrands) {
    if (title.includes(brand)) {
      tags.push(brand);
      break;
    }
  }

  const services = [
    { keywords: ['PPF', 'ppf', '보호필름', '페인트보호'], tag: 'PPF' },
    { keywords: ['썬팅', '선팅', '틴팅'], tag: '썬팅' },
    { keywords: ['랩핑', '래핑', 'wrap', 'PWF'], tag: '랩핑' },
    { keywords: ['디테일링', '세차', '광택'], tag: '디테일링' },
  ];
  for (const service of services) {
    if (service.keywords.some(k => title.toLowerCase().includes(k.toLowerCase()))) {
      tags.push(service.tag);
    }
  }

  tags.push('3M', '프로이즘', '강남');
  return [...new Set(tags)];
}

/** 일반 텍스트 본문을 HTML로 변환 (빈 줄 → 문단, 줄바꿈 → <br>) */
export function textToHtml(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  return paragraphs
    .map(p => `<p>${p.trim().replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/** 저장된 글(제목+본문 텍스트) → 미리보기 draft 객체 */
export function buildDraftFromText(title: string, body: string) {
  return {
    title,
    content: textToHtml(body),
    tags: extractTagsFromTitle(title),
    category: '프로이즘 작업기',
  };
}

/** HTML 본문 → 일반 텍스트 (문단은 빈 줄, <br>은 줄바꿈, 엔티티 복원) */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
