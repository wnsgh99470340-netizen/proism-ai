import { NextRequest } from 'next/server';
import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { callClaude, analyzeImageWithClaude } from '@/lib/claude-client';
import { isBlogWriteRequest, resolveTarget, researchForBlogPost } from '@/lib/blog-research';
import type { BlogRequest } from '@/config/blog-options';
import { factCheck, type FactIssue } from '@/lib/fact-check';
import { buildToneReference, savePost, listPosts } from '@/lib/posts';
import { getActiveEmployee } from '@/config/team';
import { BLOG_SYSTEM_PROMPT } from '@/config/prompts';

// 글 작성 전 웹 검색 리서치 + 작성 + QA + 수정까지 여러 번 Claude를 호출하므로 넉넉히 잡음
export const maxDuration = 300;

// 블로그 작성 모델 (담당 직원 설정과 무관하게 고정)
const BLOG_WRITER_MODEL = 'claude-opus-4-6';

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
 * 결정론적 위반 검사 — 5종만. Claude 채점 없음.
 * 점수를 매기지 않고 "반드시 빼야 하는 표현"만 잡는다.
 */
type Violation = { rule: string; detail: string };

function checkHardViolations(body: string, userInput: string, serviceType: string): Violation[] {
  const v: Violation[] = [];

  // 1. PPF·컬러PPF·PWF 글의 열·오버랩 표현
  if (/PPF|PWF/.test(serviceType)) {
    const m = body.match(/열\s*성형|히팅\s*건|열을\s*가[해하]|열로\s*(?:늘|당|잡|펴)|포스트\s*히팅|오버랩/);
    if (m) v.push({ rule: 'heat', detail: `PPF·PWF 글에 열·오버랩 표현 "${m[0]}"` });
  }

  // 2. 따옴표로 고객 발화 인용
  const quote = body.match(/["“]([^"”\n]{2,80}?)(다|요|네요|어요|구나|군요|세요|잖아요)["”]/)
    || body.match(/[''`]([^''`\n]{2,80}?)(다|요|네요|어요|구나|군요|세요|잖아요)['']/);
  if (quote) v.push({ rule: 'quote', detail: `따옴표 인용 "${quote[0].slice(0, 40)}"` });

  // 3. 사용자가 안 알려준 까다로운 부위 + 사이드미러
  const userMentions = /까다|신경|공들|애먹|애를\s*먹|고생/.test(userInput);
  if (!userMentions) {
    const m = body.match(/까다로[웠운울]|신경\s*[쓰써썼]|공들[였인]|애[를]?\s*먹[었은]|고생[했한]/);
    if (m) v.push({ rule: 'careful', detail: `사용자가 알려주지 않은 "${m[0]}" 표현` });
  }
  if (/사이드미러[^\n]{0,40}(까다|신경\s*[쓰써썼]|공들|애먹|고생)|(까다로[웠운]|신경\s*[쓴쓰써썼]|공들[였인])[^\n]{0,40}사이드미러/.test(body)) {
    v.push({ rule: 'careful', detail: '사이드미러를 까다로운 부위로 묘사' });
  }

  // 4. 대표 경력 연수 (팀장님 문맥은 허용)
  const careerRe = /(\d+|수십|오랜)\s*년\s*(?:간|동안|의)?\s*(경력|노하우|경험)/g;
  let cm: RegExpExecArray | null;
  while ((cm = careerRe.exec(body)) !== null) {
    const around = body.slice(Math.max(0, cm.index - 40), cm.index + cm[0].length + 20);
    if (!/팀장/.test(around)) { v.push({ rule: 'career', detail: `경력 연수 표현 "${cm[0]}" (대표에게 금지)` }); break; }
  }

  // 5. 클리셰 마무리 + "~하는 남자" 수식어 줄
  const cliche = body.match(/긴\s*글\s*읽어주셔서\s*감사|오늘도\s*한\s*대의\s*작품|이런\s*순간이\s*이\s*일을\s*하는\s*이유|자부합니다[.\s]*$/m);
  if (cliche) v.push({ rule: 'cliche', detail: `클리셰 마무리 "${cliche[0].slice(0, 30)}"` });
  const modifier = body.match(/(?:잘\s*하는|자신\s*있는|책임지는|진심인|제대로\s*아는)\s*(?:남자|사람|장인|전문가)/);
  if (modifier) v.push({ rule: 'cliche', detail: `수식어 줄 "${modifier[0]}"` });

  return v;
}

function splitTitleBody(text: string): { title: string; body: string } | null {
  const lines = text.split('\n');
  const idx = lines.findIndex(l => l.trim().length > 0);
  if (idx === -1) return null;
  return { title: lines[idx].trim(), body: lines.slice(idx + 1).join('\n').trim() };
}

/** 숫자 기준 검사 — 분량·제목 길이. 점수가 아니라 미달 여부만 본다 */
const MIN_BODY_CHARS = 2300;   // 목표 2500자, 약간의 여유
const MIN_TITLE_CHARS = 18;    // 목표 20~25자

function checkFormatIssues(title: string, body: string): string[] {
  const issues: string[] = [];
  const pureLen = body.replace(/\[사진\s*\d+\]/g, '').replace(/\s/g, '').length;
  if (pureLen < MIN_BODY_CHARS) {
    issues.push(`분량 부족: 공백 제외 ${pureLen}자 → 2,500자 이상으로 보강. 시공 과정·마감·관리 안내를 더 구체적으로 풀고, 차량 소개는 늘리지 말 것`);
  }
  const photos = (body.match(/\[사진\s*\d+\]/g) || []).length;
  if (photos < 10) issues.push(`[사진 N] 태그 ${photos}개 → 10개 이상으로`);
  if (title.length < MIN_TITLE_CHARS) {
    issues.push(`제목 ${title.length}자로 짧음 → 20~25자로 ("[지역] [차종] [서비스]"에 핵심 포인트 한 가지 덧붙이기)`);
  }
  return issues;
}

/**
 * 위반 표현·형식 미달만 고치는 1회 수정. 점수·끼워넣기 없이 지시한다.
 */
async function fixIssues(systemPrompt: string, original: string, issues: string[], model: string): Promise<string> {
  const list = issues.map(s => `- ${s}`).join('\n');
  const msg = `아래 글에서 다음 항목만 고치세요. 위반 표현은 삭제하거나 규칙에 맞게 바꾸고, 분량 보강이 있으면 시공 디테일로만 채우세요. 나머지 문장·구조는 그대로 유지하고, 새 자랑·자격·차별점을 추가하지 마세요.

[고칠 것]
${list}

[원본]
${original}

설명 없이 제목부터 글 전체를 다시 출력하세요.`;
  return await callClaude(systemPrompt, [{ role: 'user', content: msg }], 8192, model);
}

const DRAFTS_DIR = path.join(process.cwd(), 'public', 'drafts');

/**
 * 이전에 저장된 글의 제목 + 도입부 첫 2줄을 반환 (최근 20개)
 */
async function getPreviousDrafts(): Promise<{ title: string; intro: string }[]> {
  // 1) DB 에 저장된 글 (초안·최종본·사장님 글) 최근 20개
  try {
    const rows = await listPosts(undefined, 20);
    if (rows.length > 0) {
      return rows.map(r => {
        const lines = r.body.split('\n').map(l => l.trim()).filter(Boolean);
        return { title: r.title, intro: lines.slice(0, 2).join(' / ') };
      });
    }
  } catch { /* 파일 폴백 */ }
  // 2) 로컬 파일 폴백 (개발 환경)
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
    const { message, history = [], images = [], research = null, request: blogRequest = null } = await request.json() as {
      message: string;
      history: { role: string; content: string }[];
      images: ImageRef[];
      research?: { context: string; summary: string } | null;
      request?: BlogRequest | null;
    };
    const target = resolveTarget(message || '', blogRequest);

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

    // 블로그 글 작성 요청이면 웹 검색으로 차량 구조 + 같은 차종 시공 사례 사전 조사
    let vehicleContext = '';
    let researchSummary = '';
    if (research && research.context) {
      // 클라이언트가 /api/research 로 미리 조사한 결과 (함수 실행시간 분산)
      vehicleContext = '\n\n' + research.context;
      researchSummary = research.summary || '';
    } else if (blogRequest || isBlogWriteRequest(message || '')) {
      const carModel = target.carModel;
      if (carModel) {
        const serviceType = target.serviceType;
        const done = await researchForBlogPost(message || '', carModel, serviceType);
        vehicleContext = '\n\n' + done.context;
        researchSummary = done.summary;
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

    const isBlog = Boolean(blogRequest) || isBlogWriteRequest(message || '');
    const toneReference = isBlog ? await buildToneReference() : '';
    const systemPrompt = isBlog
      ? `${BLOG_SYSTEM_PROMPT}${toneReference}${vehicleContext}${previousContext}`
      : `${activeEmployee.systemPrompt}\n\n현재 담당: ${activeEmployee.emoji} ${activeEmployee.name}\n역할: ${activeEmployee.role}`;
    const writerModel = isBlog ? BLOG_WRITER_MODEL : activeEmployee.model;

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

    let reply = await callClaude(systemPrompt, messages, 8192, writerModel);

    // 서버에서 직접 draft 구성 (JSON 파싱 불필요)
    let draftResult = tryBuildDraft(reply, combinedMessage);

    // ─── 위반 검사 (regex 5종) + 필요 시 1회 수정. Claude 채점 없음 ───
    let remaining: Violation[] = [];
    let checks: { violations: Violation[]; facts: FactIssue[]; format: string[] } | null = null;
    let draftId: string | null = null;
    if (draftResult) {
      const serviceType = target.serviceType;
      const first = splitTitleBody(reply);
      let violations = first ? checkHardViolations(first.body, combinedMessage, serviceType) : [];
      let factIssues: FactIssue[] = first ? factCheck({ body: first.body, serviceType, product: target.product }) : [];
      let formatIssues = first ? checkFormatIssues(first.title, first.body) : [];
      const pureLen = (b: string) => b.replace(/\[사진\s*\d+\]/g, '').replace(/\s/g, '').length;

      if (first && (violations.length > 0 || factIssues.length > 0 || formatIssues.length > 0)) {
        try {
          const issues = [...violations.map(v => v.detail), ...factIssues.map(f => `팩트 오류 — ${f.detail}`), ...formatIssues];
          const fixed = await fixIssues(systemPrompt, reply, issues, writerModel);
          const f = splitTitleBody(fixed);
          if (f && pureLen(f.body) >= Math.min(1500, pureLen(first.body))) {
            const fixedViolations = checkHardViolations(f.body, combinedMessage, serviceType);
            const fixedFacts = factCheck({ body: f.body, serviceType, product: target.product });
            const fixedFormat = checkFormatIssues(f.title, f.body);
            // 위반·팩트 오류가 늘지 않고 형식 미달이 줄었거나 같으면 채택
            if (fixedViolations.length <= violations.length && fixedFacts.length <= factIssues.length && fixedFormat.length <= formatIssues.length) {
              reply = fixed;
              violations = fixedViolations;
              factIssues = fixedFacts;
              formatIssues = fixedFormat;
            }
          }
        } catch { /* 수정 실패 시 원본 유지 */ }
      }

      remaining = violations;
      const remainingFacts = factIssues;
      const remainingFormat = formatIssues;
      draftResult = tryBuildDraft(reply, combinedMessage);

      if (draftResult) {
        const notes: string[] = ['블로그 글이 완성되었습니다.'];
        if (remaining.length > 0) notes.push(`확인 필요: ${remaining.map(v => v.detail).join(' / ')}`);
        notes.push(remainingFacts.length > 0 ? `팩트체크 ${remainingFacts.length}건 확인 필요: ${remainingFacts.map(f => f.detail).join(' / ')}` : '팩트체크 통과 (제품·시공 규칙 위반 없음)');
        if (remainingFormat.length > 0) notes.push(`형식: ${remainingFormat.join(' / ')}`);
        if (researchSummary) notes.push(researchSummary);
        draftResult.cleanReply = notes.join('\n');
      }
      checks = { violations: remaining, facts: remainingFacts, format: remainingFormat };

      // 저장: DB(blog_posts, kind=draft) + 로컬 파일 폴백
      const finalLines = reply.split('\n');
      const fIdx = finalLines.findIndex(l => l.trim().length > 0);
      if (fIdx >= 0) {
        const t = finalLines[fIdx].trim();
        const b = finalLines.slice(fIdx + 1).join('\n').trim();
        const saved = await savePost({
          kind: 'draft', title: t, body: b,
          car_model: target.carModel, service_type: target.serviceType, product: target.product || null,
          region: blogRequest?.region || null,
        });
        draftId = saved?.id ?? null;
        if (!saved) await saveDraft(t, b);
      }
    }

    return Response.json({
      reply: draftResult ? draftResult.cleanReply : reply,
      draft: draftResult ? draftResult.draft : null,
      checks,
      draftId,
      target: draftResult ? { carModel: target.carModel, serviceType: target.serviceType, product: target.product, region: blogRequest?.region || null } : null,
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
