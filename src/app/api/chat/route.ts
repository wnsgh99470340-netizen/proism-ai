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

/**
 * 블로그 글 인라인 QA 채점 (97점 품질 루프용)
 * QA API와 동일한 채점 기준을 사용하되, 경량 JSON만 반환
 */
const INLINE_QA_PROMPT = `당신은 3M 프로이즘 블로그 글의 QA 채점관입니다. 아래 글을 채점하고 JSON으로만 응답하세요.

**최우선 원칙**: 이 블로그의 톤은 "매장에서 고객한테 편하게 설명하는 톤"입니다. 광고 전단지·회사 소개서 톤이면 감점하세요. 자신감/차별점은 "자연스럽게 녹였을 때" 가산점이지, "명시적으로 나열했을 때"가 아닙니다.

## 위반 감점 (각 항목)
- heat_violation (-10): PPF/컬러PPF/PWF 시공기에서 "열 성형" "히팅건" "열을 가해" "포스트 히팅" "오버랩" 표현 (랩핑/크롬죽이기/썬팅은 허용)
- customer_quote (-10): 고객 말을 따옴표로 직접 인용 (큰따옴표·작은따옴표 모두)
- panel_listing (-15): 패널 4개 이상을 연속 나열 ("후드는~ 펜더는~ 도어는~ 범퍼는~" 식). 그날 까다로운 부위 2~3곳만 깊이 서술해야 함
- differentiation_listing (-15): **차별점/강점을 번호나 리스트로 나열** ("첫째~ 둘째~ 셋째~", "차별점1:~ 차별점2:~" 식). 자신감은 시공 이야기 흐름에 녹여야 함
- ad_tone (-10): 광고 전단지·회사 소개서 톤. "저희 프로이즘은 ~합니다. 또한 ~합니다. 그리고 ~합니다" 식 자랑 나열, 본문 중간에 회사 소개 섹션 삽입
- fabrication (-15): AI가 추측해 꾸며낸 기술적 디테일 (프로이즘 원본에 없는 묘사)
- representative_career (-10): 진준호 대표에게 경력 연수 언급 ("N년 경력" "오랜 경력"). 30년 경력은 썬팅 담당 이팀장님의 것이지 대표의 것이 아님
- team_leader_scope (-10): PPF/랩핑/PWF/크롬죽이기 시공기에서 "팀장님"을 작업자로 묘사 (이팀장님은 썬팅만)
- excessive_pride (-10): "압도적" "독보적" "전국 최고" "업계 1위" 같은 선언을 글당 2회 이상 사용, 또는 한 문단에 자신감 표현 3개 이상 몰아 쓰기

## 품질 점수 (0~10)
- char_count: 공백제외 2500자+→10, 2000~2499→7, 1700~1999→5, 미만→0
- photo_tags: [사진 N] 태그 10개+→10, 7~9개→7, 4~6개→5, 미만→0
- store_tone: 매장에서 고객에게 편하게 설명하는 느낌인지. 딱딱·교과서·광고체면 감점
- personal_voice: 대표의 개인 감상, 차량 느낌, 솔직한 한마디
- depth: 까다로운 부위 2~3곳을 "왜 까다로웠는지 → 어떻게 접근 → 결과" 흐름으로 깊이 서술
- natural_pride: 자신감이 선언이 아니라 작업 과정·자격 언급을 통해 **자연스럽게 녹아들었는지** (나열·반복은 감점)
- seo_title: 제목에 지역+차종+서비스 3개 모두 포함→10, 2개→7, 1개→3, 없음→0
- closing: 연락처(010-7287-7140) + 매장주소 포함 여부. "자부심" "프리퍼드 인스톨러"를 마무리에서 억지로 강조하지 않았는지 (자연스러우면 가산, 억지면 감점)

## 품질 점수 (0~5)
- hashtags: 5~7개
- paragraph_format: 문단 3줄 이하 + 빈 줄 구분

## 응답 형식 (JSON만, 다른 텍스트 금지)
{"total":85,"violations":[{"rule":"panel_listing","detail":"후드/펜더/도어/범퍼 순차 나열","penalty":-15}],"improvements":["까다로운 부위 2~3곳만 깊이 서술하는 방식으로 재구성 필요"]}`;

async function inlineQAScore(title: string, body: string): Promise<{ total: number; violations: { rule: string; detail: string; penalty: number }[]; improvements: string[] }> {
  const pureText = body.replace(/\[사진\s*\d+\]/g, '').replace(/\s/g, '');
  const photoCount = (body.match(/\[사진\s*\d+\]/g) || []).length;

  const userMsg = `제목: ${title}\n본문:\n${body}\n\n서버측정: 글자수=${pureText.length}자, 사진태그=${photoCount}개`;
  try {
    const reply = await callClaude(INLINE_QA_PROMPT, [{ role: 'user', content: userMsg }], 2048, 'claude-sonnet-4-20250514');
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fallback */ }
  return { total: 0, violations: [], improvements: ['QA 채점 실패'] };
}

/**
 * QA 피드백을 바탕으로 글 수정 요청
 */
async function refineBlogPost(
  systemPrompt: string,
  originalReply: string,
  qaResult: { total: number; violations: { rule: string; detail: string; penalty: number }[]; improvements: string[] },
): Promise<string> {
  const violationText = qaResult.violations.length > 0
    ? qaResult.violations.map(v => `- [${v.rule}] ${v.detail} (${v.penalty}점)`).join('\n')
    : '(위반 없음)';
  const improvementText = qaResult.improvements.join('\n- ');

  const refineMsg = `아래 블로그 글이 QA에서 ${qaResult.total}점을 받았습니다. 아래 피드백을 참고해 자연스럽게 다시 써주세요.

[감점 사유]
${violationText}

[참고 개선점]
- ${improvementText}

[원본 글]
${originalReply}

**수정 원칙 (최우선)**:
- 시스템 프롬프트의 톤·구조 원칙이 절대 기준입니다. 매장에서 고객한테 편하게 설명하는 톤이 전부입니다.
- 감점 사유를 "끼워넣기"로 해결하지 마세요. 차별점을 억지로 나열하거나, 자부심 문구를 박아넣거나, 자격증을 여러 번 반복하면 더 나빠집니다.
- 감점 사유는 "무엇을 빼야 하는지"의 신호로 먼저 읽으세요. 예: 패널 나열 감점이면 → 2~3곳만 깊이 남기고 나머지 삭제. 차별점 나열 감점이면 → 리스트를 풀어 시공 이야기에 녹이기.
- 광고 전단지 톤이 되느니 차라리 담백하게 쓰세요. 점수를 올리려고 선언·자랑을 추가하는 건 금지입니다.

수정된 글만 출력하세요. 설명이나 코멘트 없이 제목부터 시작.`;

  return await callClaude(systemPrompt, [{ role: 'user', content: refineMsg }], 8192);
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

    let reply = await callClaude(systemPrompt, messages, 8192, activeEmployee.model);

    // 서버에서 직접 draft 구성 (JSON 파싱 불필요)
    let draftResult = tryBuildDraft(reply, combinedMessage);

    // ─── 97점 품질 자동 루프 (블로그 글일 때만) ───
    if (draftResult) {
      const lines = reply.split('\n');
      const firstNonEmptyIdx = lines.findIndex(l => l.trim().length > 0);
      let bestReply = reply;
      let bestScore = 0;
      let lastQA: { total: number; violations: { rule: string; detail: string; penalty: number }[]; improvements: string[] } = { total: 0, violations: [], improvements: [] };

      const title = lines[firstNonEmptyIdx].trim();
      const body = lines.slice(firstNonEmptyIdx + 1).join('\n').trim();

      // 1차 QA 채점
      lastQA = await inlineQAScore(title, body);
      bestScore = lastQA.total;
      bestReply = reply;

      // 하드 위반(열 표현/고객 인용/패널 나열/차별점 나열/광고톤/대표 경력/팀장 스코프)이 있으면
      // 최대 1회만 수정. 반복 루프가 오히려 "규칙 기계적 박아넣기"로 글을 망치기 때문에
      // 점수가 아니라 "치명적 위반 해소"에 초점을 맞춤.
      const HARD_VIOLATION_RULES = new Set([
        'heat_violation',
        'customer_quote',
        'panel_listing',
        'differentiation_listing',
        'ad_tone',
        'fabrication',
        'representative_career',
        'team_leader_scope',
        'excessive_pride',
      ]);
      const hasHardViolation = (qa: typeof lastQA) =>
        qa.violations.some(v => HARD_VIOLATION_RULES.has(v.rule));

      if (hasHardViolation(lastQA) || lastQA.total < 85) {
        const refined = await refineBlogPost(systemPrompt, bestReply, lastQA);
        const refinedLines = refined.split('\n');
        const rIdx = refinedLines.findIndex(l => l.trim().length > 0);
        if (rIdx !== -1) {
          const rTitle = refinedLines[rIdx].trim();
          const rBody = refinedLines.slice(rIdx + 1).join('\n').trim();
          const rQA = await inlineQAScore(rTitle, rBody);

          // refine 결과가 하드 위반 없고 점수도 떨어지지 않았을 때만 채택
          if (!hasHardViolation(rQA) && rQA.total >= bestScore - 3) {
            bestScore = rQA.total;
            bestReply = refined;
            lastQA = rQA;
          }
        }
      }

      reply = bestReply;
      draftResult = tryBuildDraft(reply, combinedMessage);

      // 최종 점수 정보를 cleanReply에 포함
      const scoreInfo = !hasHardViolation(lastQA)
        ? `블로그 글이 완성되었습니다. (QA ${bestScore}점)`
        : `블로그 글이 완성되었습니다. (QA ${bestScore}점)\n남은 이슈: ${lastQA.improvements.slice(0, 3).join(', ')}`;

      if (draftResult) {
        draftResult.cleanReply = scoreInfo;
      }

      // 저장
      const finalLines = reply.split('\n');
      const fIdx = finalLines.findIndex(l => l.trim().length > 0);
      if (fIdx >= 0) {
        await saveDraft(finalLines[fIdx].trim(), finalLines.slice(fIdx + 1).join('\n').trim());
      }
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
