import { NextRequest } from 'next/server';
import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { callClaude, analyzeImageWithClaude } from '@/lib/claude-client';
import { getActiveEmployee } from '@/config/team';
import { BLOG_SYSTEM_PROMPT } from '@/config/prompts';

interface ImageRef {
  url: string;
  filename: string;
}

/**
 * 대표 사진 3장을 골라 인덱스를 반환 (첫 번째, 중간, 마지막)
 */
function pickRepresentativeIndices(total: number): number[] {
  if (total <= 3) return Array.from({ length: total }, (_, i) => i);
  const mid = Math.floor(total / 2);
  return [0, mid, total - 1];
}

/**
 * 디스크에서 이미지를 읽어 Vision API용 base64로 변환 (600px, JPEG q40)
 */
async function readImageForVision(filename: string): Promise<string> {
  const filePath = path.join(process.cwd(), 'public', 'uploads', filename);
  const buffer = await readFile(filePath);
  const visionBuffer = await sharp(buffer)
    .resize(600)
    .jpeg({ quality: 40 })
    .toBuffer();
  return visionBuffer.toString('base64');
}

/**
 * 제목에서 태그를 자동 추출
 */
function extractTagsFromTitle(title: string): string[] {
  const tags: string[] = [];

  // 차종 추출
  const carBrands = ['BMW', '벤츠', '메르세데스', '포르쉐', '아우디', '테슬라', '제네시스', '렉서스', '볼보', '람보르기니', '페라리', '맥라렌', '롤스로이스', '벤틀리', '마세라티', '재규어', '랜드로버', '링컨', '캐딜락', '현대', '기아', '쉐보레'];
  for (const brand of carBrands) {
    if (title.includes(brand)) {
      tags.push(brand);
      break;
    }
  }

  // 시공 종류 추출
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

  // 기본 태그
  tags.push('3M', '프로이즘', '강남');

  return [...new Set(tags)];
}

/**
 * 일반 텍스트 본문을 HTML로 변환
 * - 빈 줄로 구분된 문단을 <p> 태그로 감싸기
 * - [사진 N] 태그를 이미지 placeholder로 변환
 */
function textToHtml(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  return paragraphs
    .map(p => {
      const trimmed = p.trim().replace(/\n/g, '<br>');
      return `<p>${trimmed}</p>`;
    })
    .join('\n');
}

/**
 * Claude 응답이 블로그 글인지 판별하고, 맞다면 draft 객체를 구성
 * 판별 기준: 응답이 충분히 길고(500자+), 블로그 형식의 텍스트인 경우
 */
function tryBuildDraft(
  reply: string,
  userMessage: string,
): { draft: Record<string, unknown>; cleanReply: string } | null {
  const lines = reply.split('\n');

  // 첫 번째 비어있지 않은 줄을 제목으로
  const firstNonEmptyIdx = lines.findIndex(l => l.trim().length > 0);
  if (firstNonEmptyIdx === -1) return null;

  const title = lines[firstNonEmptyIdx].trim();
  const bodyLines = lines.slice(firstNonEmptyIdx + 1);
  const body = bodyLines.join('\n').trim();

  // 블로그 글 판별: 본문이 충분히 길어야 함 (공백 제외 500자 이상)
  const bodyLengthNoSpaces = body.replace(/\s/g, '').length;
  if (bodyLengthNoSpaces < 500) return null;

  // 블로그 글 작성 요청인지 확인 (사용자 메시지나 컨텍스트 기반)
  const blogKeywords = ['블로그', '글', '작성', '써줘', '써 줘', '시공기', '포스팅', '작업기', '리뷰'];
  const isBlogRequest = blogKeywords.some(k => userMessage.includes(k));
  // [사진 N] 태그가 있으면 블로그 글로 간주
  const hasPhotoTags = /\[사진\s*\d+\]/.test(body);

  if (!isBlogRequest && !hasPhotoTags) return null;

  const content = textToHtml(body);
  const tags = extractTagsFromTitle(title);

  return {
    draft: {
      title,
      content,
      tags,
      category: '프로이즘 작업기',
    },
    cleanReply: '블로그 글이 완성되었습니다. 미리보기를 확인해주세요.',
  };
}

/**
 * 블로그 글 작성 요청인지 판별
 */
function isBlogWriteRequest(message: string): boolean {
  const keywords = ['블로그', '글 써', '글 작성', '써줘', '써 줘', '시공기', '포스팅', '작업기', '초안', '원고'];
  return keywords.some(k => message.includes(k));
}

/**
 * 사용자 메시지에서 차종을 추출
 */
function extractCarModel(message: string): string | null {
  // 브랜드 + 모델명 패턴 매칭
  const patterns = [
    /(?:BMW|벤츠|아우디|포르쉐|테슬라|제네시스|렉서스|볼보|현대|기아|랜드로버|링컨|캐딜락|마세라티|재규어|롤스로이스|벤틀리|람보르기니|페라리|맥라렌|미니|토요타|혼다)\s*[A-Za-z0-9가-힣\- ]+/,
    /(?:카이엔|파나메라|타이칸|마칸|카이맨|박스터|911)/,
    /(?:모델[YX3SyxsS]|사이버트럭)/,
    /(?:GV[0-9]+|G[0-9]+[ei]?|GLE|GLC|GLS|GLB|CLE|CLA|AMG|EQS|EQE|S클래스|E클래스|C클래스|A클래스)/,
    /(?:그랜저|쏘나타|아반떼|투싼|싼타페|팰리세이드|아이오닉[0-9]*|쏘렌토|카니발|스포티지|EV[0-9]+|레이|니로)/,
    /(?:카마로|콜벳|머스탱|디펜더|레인지로버|디스커버리)/,
  ];
  for (const p of patterns) {
    const match = message.match(p);
    if (match) return match[0].trim();
  }
  return null;
}

/**
 * 차량 외관 구조를 웹 검색으로 파악
 */
async function researchVehicleStructure(carModel: string): Promise<string> {
  const query = `${carModel} 외관 구조 범퍼 사이드미러 번호판 위치 도어 프레임`;
  const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_SEARCH_API_KEY}&cx=${process.env.GOOGLE_SEARCH_CX}&q=${encodeURIComponent(query)}&num=5`;

  let searchResults = '';
  try {
    if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX) {
      const res = await fetch(searchUrl);
      if (res.ok) {
        const data = await res.json();
        const items = (data.items || []).slice(0, 5);
        searchResults = items.map((item: { title: string; snippet: string }) =>
          `- ${item.title}: ${item.snippet}`
        ).join('\n');
      }
    }
  } catch {
    // 검색 실패 시 무시
  }

  // 검색 실패 시 Claude에게 기존 지식으로 파악 요청
  const fallbackNote = searchResults
    ? `웹 검색 결과:\n${searchResults}`
    : '(웹 검색 불가 — 기존 지식으로 파악)';

  return `[차량 구조 사전 조사 — ${carModel}]
${fallbackNote}

위 정보를 바탕으로 아래 10가지를 파악하고 글 작성에 반영하세요:
1. 번호판 위치 (트렁크/범퍼)
2. 앞범퍼 구조 (에어인테이크, 그릴, 안개등)
3. 뒷범퍼 구조 (디퓨저, 배기구, 하단 형태)
4. 사이드미러 형태
5. 하이그로시/크롬 트림 위치
6. 필러 구조 (B/C필러)
7. 휀더 연결 구조
8. 루프라인 특성
9. 도어 타입 (프레임/프레임리스)
10. 해당 차종만의 특이 구조

확인 안 되는 부위는 일반적 표현 사용. 추측하여 구체적으로 쓰지 말 것.
사장님이 알려준 정보가 있으면 최우선 반영.`;
}

const DRAFTS_DIR = path.join(process.cwd(), 'public', 'drafts');

/**
 * 이전에 저장된 글의 제목 + 도입부 첫 2줄을 반환 (최근 20개)
 */
async function getPreviousDrafts(): Promise<{ title: string; intro: string }[]> {
  try {
    await mkdir(DRAFTS_DIR, { recursive: true });
    const files = await readdir(DRAFTS_DIR);
    const txtFiles = files.filter(f => f.endsWith('.txt')).sort().reverse().slice(0, 20);

    const results = await Promise.all(
      txtFiles.map(async (f) => {
        try {
          const content = await readFile(path.join(DRAFTS_DIR, f), 'utf-8');
          const lines = content.split('\n').filter(l => l.trim());
          const title = lines[0] || '';
          // 제목 다음 비어있지 않은 줄 2개를 도입부로
          const introLines = lines.slice(1, 3).map(l => l.trim());
          return { title, intro: introLines.join(' / ') };
        } catch {
          const nameWithoutExt = f.replace(/\.txt$/, '');
          const idx = nameWithoutExt.indexOf('_');
          return { title: idx >= 0 ? nameWithoutExt.slice(idx + 1) : nameWithoutExt, intro: '' };
        }
      })
    );

    return results;
  } catch {
    return [];
  }
}

/**
 * 완성된 draft를 파일로 저장
 */
async function saveDraft(title: string, body: string): Promise<void> {
  try {
    await mkdir(DRAFTS_DIR, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '').slice(0, 50);
    const filename = `${date}_${safeTitle}.txt`;
    const rule = `[유사성 금지] 이 글과 유사한 도입부, 표현, 문장 구조, 비유를 다음 글에서 절대 반복하지 마세요.`;
    const content = `${title}\n\n${body}\n\n---\n${rule}`;
    await writeFile(path.join(DRAFTS_DIR, filename), content, 'utf-8');
  } catch {
    // 저장 실패해도 응답에는 영향 없음
  }
}

export async function POST(request: NextRequest) {
  try {
    const { message, history = [], images = [] } = await request.json() as {
      message: string;
      history: { role: string; content: string }[];
      images: ImageRef[];
    };

    if (!message && images.length === 0) {
      return Response.json({ error: '메시지를 입력해주세요.' }, { status: 400 });
    }

    const activeEmployee = getActiveEmployee(message || '');

    // 이미지가 있으면 대표 3장만 Vision 분석, 나머지는 URL만 전달
    let imageContext = '';
    if (images.length > 0) {
      const representativeIndices = pickRepresentativeIndices(images.length);

      // 대표 사진 Vision 분석 (병렬)
      const analyses = await Promise.all(
        representativeIndices.map(async (idx) => {
          try {
            const base64 = await readImageForVision(images[idx].filename);
            const analysis = await analyzeImageWithClaude(
              base64,
              'image/jpeg',
              `이 자동차 PPF/썬팅/랩핑 시공 사진을 분석해줘. 차종, 시공 단계(전처리/세척/시공중/마감/완성), 사진 내용을 간단히 설명해줘. 2~3줄로 짧게.`
            );
            return { idx, analysis };
          } catch {
            return { idx, analysis: '(분석 실패)' };
          }
        })
      );

      // 전체 이미지 목록 + 분석 결과를 텍스트로 구성
      const analysisMap = new Map(analyses.map(a => [a.idx, a.analysis]));
      const imageLines = images.map((img, i) => {
        const analysis = analysisMap.get(i);
        const label = `[사진 ${i + 1}/${images.length}] ${img.url}`;
        return analysis ? `${label}\n  분석: ${analysis}` : label;
      });

      imageContext = `첨부된 사진 ${images.length}장:\n${imageLines.join('\n')}\n\n` +
        `위 사진들을 블로그 글 본문에 순서대로 적절히 배치해주세요. ` +
        `분석된 사진의 내용을 참고하여 전체 사진의 흐름을 파악하고, ` +
        `각 사진 위치에 [사진 N] 태그를 넣어주세요.`;
    }

    // 텍스트 메시지 구성
    const textParts: string[] = [];
    if (imageContext) {
      textParts.push(imageContext);
    }
    if (message) {
      textParts.push(message);
    }
    const combinedMessage = textParts.join('\n\n');

    // 블로그 글 작성 요청이면 차량 구조 사전 조사
    let vehicleContext = '';
    if (isBlogWriteRequest(message || '')) {
      const carModel = extractCarModel(message || '');
      if (carModel) {
        vehicleContext = '\n\n' + await researchVehicleStructure(carModel);
      }
    }

    // 이전 글 제목+도입부를 시스템 프롬프트에 포함
    const previousDrafts = await getPreviousDrafts();
    let previousContext = '';
    if (previousDrafts.length > 0) {
      const list = previousDrafts.map((d, i) => {
        const intro = d.intro ? ` — 도입부: ${d.intro}` : '';
        return `${i + 1}. ${d.title}${intro}`;
      }).join('\n');
      previousContext = `\n\n[이전에 작성한 글 목록]\n아래는 이전에 작성한 글의 제목과 도입부입니다. 이 글들과 유사한 도입부, 표현, 구조를 절대 반복하지 마세요.\n${list}`;
    }

    const systemPrompt = `${BLOG_SYSTEM_PROMPT}${vehicleContext}${previousContext}\n\n현재 담당: ${activeEmployee.emoji} ${activeEmployee.name}\n역할: ${activeEmployee.role}\n\n${activeEmployee.systemPrompt}`;

    // 히스토리 + 현재 메시지
    const messages = [
      ...history.map((h: { role: string; content: string }) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      {
        role: 'user' as const,
        content: combinedMessage,
      },
    ];

    const reply = await callClaude(systemPrompt, messages, 8192, activeEmployee.model);

    // 서버에서 직접 draft 구성 (JSON 파싱 불필요)
    const draftResult = tryBuildDraft(reply, combinedMessage);

    // draft가 완성되면 자동 저장
    if (draftResult) {
      const lines = reply.split('\n');
      const firstNonEmptyIdx = lines.findIndex(l => l.trim().length > 0);
      const title = lines[firstNonEmptyIdx].trim();
      const body = lines.slice(firstNonEmptyIdx + 1).join('\n').trim();
      await saveDraft(title, body);
    }

    return Response.json({
      reply: draftResult ? draftResult.cleanReply : reply,
      draft: draftResult ? draftResult.draft : null,
      activeEmployee: {
        id: activeEmployee.id,
        name: activeEmployee.name,
        emoji: activeEmployee.emoji,
        color: activeEmployee.color,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    return Response.json({ error: msg }, { status: 500 });
  }
}
