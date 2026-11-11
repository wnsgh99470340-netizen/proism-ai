/**
 * 블로그 글 생성 핵심 로직 (서버 전용)
 * - /api/chat (즉시 응답 경로) 과 /api/jobs (백그라운드 작업 경로) 가 함께 쓴다
 * - 흐름: 시스템 프롬프트 구성 → Claude 작성 → 정규식 위반·팩트·형식 검사 → 필요 시 1회 수정 → draft 구성 → DB 저장
 */
import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import path from 'path';
import { callClaude } from './claude-client';
import { resolveTarget } from './blog-research';
import type { BlogRequest } from '@/config/blog-options';
import { factCheck, type FactIssue } from './fact-check';
import { buildToneReference, savePost, listPosts } from './posts';
import { BLOG_SYSTEM_PROMPT } from '@/config/prompts';
import { extractTagsFromTitle, textToHtml } from './draft-format';

/** 블로그 작성 모델 (담당 직원 설정과 무관하게 고정) */
export const BLOG_WRITER_MODEL = 'claude-opus-4-6';

export type Violation = { rule: string; detail: string };
export type Checks = { violations: Violation[]; facts: FactIssue[]; format: string[] };
export type Draft = { title: string; content: string; tags: string[]; category: string };
export type Target = { carModel: string | null; serviceType: string; product: string | null; region: string | null; keyword?: string | null };

/** 채팅 요청에서 "제목 키워드: 양재 랩핑" / "키워드: ..." 를 뽑는다 (폼 값이 없을 때) */
export function extractKeyword(message: string): string | null {
  const m = message.match(/(?:제목\s*)?키워드\s*[:：]\s*([^\n.。]+)/);
  if (!m) return null;
  const k = m[1].trim().replace(/["'“”‘’]/g, '');
  return k.length >= 2 && k.length <= 30 ? k : null;
}

/** 채팅 요청에서 구글 드라이브 공유 링크를 뽑는다 */
export function extractDriveUrl(message: string): string | null {
  const m = message.match(/https?:\/\/drive\.google\.com\/[^\s)\]>"']+/);
  return m ? m[0] : null;
}

const normKw = (s: string) => s.replace(/\s+/g, '').toLowerCase();

export interface WriterResult {
  reply: string;
  draft: Draft | null;
  checks: Checks | null;
  draftId: string | null;
  target: Target | null;
  /** 영상 자동 제작 상태 (글 완성 뒤 jobs.ts 가 채우고, 깃허브 액션이 갱신) */
  video?: import('./video').VideoState | null;
}

/**
 * Claude 응답이 블로그 글인지 판별하고, 맞다면 draft 객체를 구성
 * 판별 기준: 응답이 충분히 길고(500자+), 블로그 형식의 텍스트인 경우
 */
export function tryBuildDraft(reply: string, userMessage: string): { draft: Draft; cleanReply: string } | null {
  const lines = reply.split('\n');
  const firstNonEmptyIdx = lines.findIndex(l => l.trim().length > 0);
  if (firstNonEmptyIdx === -1) return null;

  const title = lines[firstNonEmptyIdx].trim();
  const body = lines.slice(firstNonEmptyIdx + 1).join('\n').trim();

  const bodyLengthNoSpaces = body.replace(/\s/g, '').length;
  if (bodyLengthNoSpaces < 500) return null;

  const blogKeywords = ['블로그', '글', '작성', '써줘', '써 줘', '시공기', '포스팅', '작업기', '리뷰'];
  const isBlogRequest = blogKeywords.some(k => userMessage.includes(k));
  const hasPhotoTags = /\[사진\s*\d+\]/.test(body);
  if (!isBlogRequest && !hasPhotoTags) return null;

  return {
    draft: { title, content: textToHtml(body), tags: extractTagsFromTitle(title), category: '프로이즘 작업기' },
    cleanReply: '블로그 글이 완성되었습니다. 미리보기를 확인해주세요.',
  };
}

/**
 * 결정론적 위반 검사 — 5종만. Claude 채점 없음.
 * 점수를 매기지 않고 "반드시 빼야 하는 표현"만 잡는다.
 */
export function checkHardViolations(body: string, userInput: string, serviceType: string): Violation[] {
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

export function splitTitleBody(text: string): { title: string; body: string } | null {
  const lines = text.split('\n');
  const idx = lines.findIndex(l => l.trim().length > 0);
  if (idx === -1) return null;
  return { title: lines[idx].trim(), body: lines.slice(idx + 1).join('\n').trim() };
}

/** 숫자 기준 검사 — 분량·제목 길이. 점수가 아니라 미달 여부만 본다 */
const MIN_BODY_CHARS = 2300;   // 목표 2500자, 약간의 여유
const MIN_TITLE_CHARS = 18;    // 목표 20~25자

export function checkFormatIssues(title: string, body: string, keyword?: string | null): string[] {
  const issues: string[] = [];
  if (keyword) {
    if (!normKw(title).includes(normKw(keyword))) {
      issues.push(`제목에 지정 키워드 "${keyword}"가 없음 → 제목 앞부분에 "${keyword}"를 그대로 넣을 것(글자 순서·띄어쓰기 유지)`);
    }
    const bodyPlain = normKw(body.replace(/<[^>]+>/g, ''));
    const count = bodyPlain.split(normKw(keyword)).length - 1;
    if (count < 3) {
      issues.push(`본문에 지정 키워드 "${keyword}"가 ${count}회 → 문장 흐름을 해치지 않는 자리에 3~5회 들어가게(제목·해시태그 제외)`);
    }
  }
  const pureLen = body.replace(/\[사진\s*\d+\]/g, '').replace(/\s/g, '').length;
  if (pureLen < MIN_BODY_CHARS) {
    issues.push(`분량 부족: 공백 제외 ${pureLen}자 → 2,500자 이상으로 보강. 시공 과정·마감·관리 안내를 더 구체적으로 풀고, 차량 소개는 늘리지 말 것`);
  }
  const photos = (body.match(/\[사진\s*\d+\]/g) || []).length;
  if (photos < 10) issues.push(`[사진 N] 태그 ${photos}개 → 10개 이상으로`);
  if (title.length < MIN_TITLE_CHARS) {
    issues.push(`제목 ${title.length}자로 짧음 → 20~25자로 ("[지역] [차종] [서비스]"에 핵심 포인트 한 가지 덧붙이기)`);
  }
  // 모바일 줄바꿈: 줄이 길면(평균 24자 초과 또는 30자 넘는 줄이 20% 이상) 줄만 다시 끊게 한다
  const lines = textLines(body).filter(l => !CONTACT_RE.test(l));
  if (lines.length > 0) {
    const avg = lines.reduce((a, l) => a + l.length, 0) / lines.length;
    const longShare = lines.filter(l => l.length > 30).length / lines.length;
    if (avg > 24 || longShare > 0.2) {
      issues.push(`줄이 깁니다(한 줄 평균 ${Math.round(avg)}자) → 모바일 기준으로 한 줄 10~18자 안팎에서 끊어 줄바꿈하고 한 문장을 2~3줄로 나눌 것. 문장 내용·순서는 그대로 두고 줄만 다시 끊기. 마침표 생략`);
    }
  }
  return issues;
}

/** 위반 표현·형식 미달만 고치는 1회 수정. 점수·끼워넣기 없이 지시한다. */
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

/** 이전에 저장된 글의 제목 + 도입부 첫 2줄 (최근 20개). DB 우선, 로컬 파일 폴백 */
export type PreviousPost = { title: string; intro: string; closing: string };

/** 본문을 실제 문장 줄만으로 (HTML 태그·[사진 N]·해시태그·빈 줄 제거) */
function textLines(body: string): string[] {
  return body
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .split('\n').map(l => l.trim())
    .filter(l => l && !/^\[사진\s*\d+\]$/.test(l) && !l.startsWith('#'));
}

const CONTACT_RE = /010-7287|서초중앙로|blog\.naver|^감사합니다/;

/** 겹침 비교용: 도입 6줄 + 마무리 4줄(연락처 제외) */
function summarizeForRepeat(body: string): { intro: string; closing: string } {
  const lines = textLines(body);
  const intro = lines.slice(0, 6).join(' / ');
  const closing = lines.filter(l => !CONTACT_RE.test(l)).slice(-4).join(' / ');
  return { intro, closing };
}

const normLine = (s: string) => s.replace(/[\s.,!?~…·'"“”‘’()\-]/g, '');

/** 이전 AI 글(초안·최종본)과 도입·마무리 문장이 그대로 겹치는지 검사 */
export function checkIntroRepeat(body: string, previous: PreviousPost[]): Violation[] {
  if (previous.length === 0) return [];
  const v: Violation[] = [];
  const lines = textLines(body);
  const prevIntro = new Set(previous.flatMap(p => p.intro.split(' / ')).map(normLine).filter(x => x.length >= 10));
  const prevClosing = new Set(previous.flatMap(p => p.closing.split(' / ')).map(normLine).filter(x => x.length >= 12));

  const opening = lines.slice(0, 4);
  const stock = opening.find(l => /완성된?\s*모습|완성\s*사진부터|완성\s*컷부터/.test(l));
  const hit = stock || opening.find(l => normLine(l).length >= 10 && prevIntro.has(normLine(l)));
  if (hit) {
    v.push({ rule: 'intro', detail: `도입 "${hit}"이(가) 이전 글과 같음 → 도입 첫 3~4줄을 다른 방식(고객이 처음 고민하던 것·이 차의 구조 한 가지·흔한 오해·이 제품을 고른 이유·상담 때 자주 받는 질문 중 하나)으로 새로 쓰고, 자기소개는 도입 뒤로 옮기기` });
  }
  const tail = lines.filter(l => !CONTACT_RE.test(l)).slice(-4);
  const hitC = tail.find(l => normLine(l).length >= 12 && prevClosing.has(normLine(l)));
  if (hitC) {
    v.push({ rule: 'intro', detail: `마무리 "${hitC}"이(가) 이전 글과 같음 → 마무리 문장을 다르게 다시 쓰기(연락처·주소는 유지)` });
  }
  return v;
}

/** 이전 AI 글(초안·최종본) 목록 — 겹침 방지용. 사장님 글은 문체 참고이므로 제외 */
export async function getPreviousDrafts(): Promise<PreviousPost[]> {
  try {
    const [drafts, finals] = await Promise.all([listPosts('draft', 14), listPosts('final', 6)]);
    const rows = [...drafts, ...finals].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    if (rows.length > 0) {
      return rows.map(r => ({ title: r.title, ...summarizeForRepeat(r.body) }));
    }
  } catch { /* 파일 폴백 */ }
  try {
    await mkdir(DRAFTS_DIR, { recursive: true });
    const files = await readdir(DRAFTS_DIR);
    const txtFiles = files.filter(f => f.endsWith('.txt')).sort().reverse().slice(0, 20);
    return await Promise.all(
      txtFiles.map(async (f) => {
        try {
          const content = await readFile(path.join(DRAFTS_DIR, f), 'utf-8');
          const [title, ...rest] = content.split('\n').filter(l => l.trim());
          return { title: title || '', ...summarizeForRepeat(rest.join('\n').split('\n---')[0]) };
        } catch {
          const nameWithoutExt = f.replace(/\.txt$/, '');
          const idx = nameWithoutExt.indexOf('_');
          return { title: idx >= 0 ? nameWithoutExt.slice(idx + 1) : nameWithoutExt, intro: '', closing: '' };
        }
      })
    );
  } catch {
    return [];
  }
}

/** 완성된 draft를 파일로 저장 (DB 저장 실패 시 폴백 — Vercel에서는 유지되지 않음) */
async function saveDraftFile(title: string, body: string): Promise<void> {
  try {
    await mkdir(DRAFTS_DIR, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '').slice(0, 50);
    const rule = `[유사성 금지] 이 글과 유사한 도입부, 표현, 문장 구조, 비유를 다음 글에서 절대 반복하지 마세요.`;
    await writeFile(path.join(DRAFTS_DIR, `${date}_${safeTitle}.txt`), `${title}\n\n${body}\n\n---\n${rule}`, 'utf-8');
  } catch { /* 저장 실패해도 응답에는 영향 없음 */ }
}

/** 블로그 작성용 시스템 프롬프트: 규칙 + 사장님 문체 + 사전 조사 + 이전 글 목록 */
export async function buildBlogSystemPrompt(researchContext: string, serviceType?: string, keyword?: string | null): Promise<string> {
  const toneReference = await buildToneReference(serviceType);
  const keywordContext = keyword
    ? `\n\n[이번 글 제목 키워드 — 필수]\n"${keyword}"를 제목 앞부분에 그대로 넣고(띄어쓰기·순서 유지), 본문에도 3~5회 자연스럽게 넣는다. 억지로 반복하지 말고 문장 안에 녹인다. 해시태그에도 한 번 넣는다.`
    : '';
  const vehicleContext = researchContext ? '\n\n' + researchContext : '';
  const previousDrafts = await getPreviousDrafts();
  let previousContext = '';
  if (previousDrafts.length > 0) {
    const list = previousDrafts.map((d, i) => `${i + 1}. ${d.title}${d.intro ? `\n   도입: ${d.intro}` : ''}${d.closing ? `\n   마무리: ${d.closing}` : ''}`).join('\n');
    previousContext = `\n\n[이전에 작성한 글 — 겹침 금지]\n아래 글들의 도입 순서·첫 문장·마무리 문장을 그대로 쓰지 마세요. 특히 "완성된 모습부터 보여드립니다 → 자기소개 → 자격 → 신차 출고 직후" 순서가 이미 여러 번 쓰였으니 이번 글은 다른 방식으로 엽니다. 마무리도 아래와 다른 문장으로 끝냅니다.\n${list}`;
  }
  return `${BLOG_SYSTEM_PROMPT}${keywordContext}${toneReference}${vehicleContext}${previousContext}`;
}

export interface RunWriterOptions {
  systemPrompt: string;
  model: string;
  history?: { role: string; content: string }[];
  /** Claude에 보내는 최종 사용자 메시지 (사진 컨텍스트 포함) */
  combinedMessage: string;
  target: Target;
  researchSummary?: string;
  /** 초안을 DB에 저장할지 (블로그 요청일 때만) */
  save: boolean;
}

/**
 * 작성 → 검사 → 1회 수정 → draft 구성 → 저장. /api/chat 과 백그라운드 작업이 공유하는 핵심.
 */
export async function runWriter(opts: RunWriterOptions): Promise<WriterResult> {
  const { systemPrompt, model, history = [], combinedMessage, target, researchSummary = '', save } = opts;
  const messages = [
    ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user' as const, content: combinedMessage },
  ];

  let reply = await callClaude(systemPrompt, messages, 8192, model);
  let draftResult = tryBuildDraft(reply, combinedMessage);
  if (!draftResult) return { reply, draft: null, checks: null, draftId: null, target: null };

  const serviceType = target.serviceType;
  const first = splitTitleBody(reply);
  const previous = save ? await getPreviousDrafts() : [];
  let violations = first ? [...checkHardViolations(first.body, combinedMessage, serviceType), ...checkIntroRepeat(first.body, previous)] : [];
  let factIssues: FactIssue[] = first ? factCheck({ body: first.body, serviceType, product: target.product ?? undefined }) : [];
  let formatIssues = first ? checkFormatIssues(first.title, first.body, target.keyword) : [];
  const pureLen = (b: string) => b.replace(/\[사진\s*\d+\]/g, '').replace(/\s/g, '').length;

  if (first && (violations.length > 0 || factIssues.length > 0 || formatIssues.length > 0)) {
    try {
      const issues = [...violations.map(v => v.detail), ...factIssues.map(f => `팩트 오류 — ${f.detail}`), ...formatIssues];
      const fixed = await fixIssues(systemPrompt, reply, issues, model);
      const f = splitTitleBody(fixed);
      if (f && pureLen(f.body) >= Math.min(1500, pureLen(first.body))) {
        const fixedViolations = [...checkHardViolations(f.body, combinedMessage, serviceType), ...checkIntroRepeat(f.body, previous)];
        const fixedFacts = factCheck({ body: f.body, serviceType, product: target.product ?? undefined });
        const fixedFormat = checkFormatIssues(f.title, f.body, target.keyword);
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

  draftResult = tryBuildDraft(reply, combinedMessage);
  if (!draftResult) return { reply, draft: null, checks: null, draftId: null, target: null };

  const notes: string[] = ['블로그 글이 완성되었습니다.'];
  if (violations.length > 0) notes.push(`확인 필요: ${violations.map(v => v.detail).join(' / ')}`);
  notes.push(factIssues.length > 0 ? `팩트체크 ${factIssues.length}건 확인 필요: ${factIssues.map(f => f.detail).join(' / ')}` : '팩트체크 통과 (제품·시공 규칙 위반 없음)');
  if (formatIssues.length > 0) notes.push(`형식: ${formatIssues.join(' / ')}`);
  if (researchSummary) notes.push(researchSummary);

  let draftId: string | null = null;
  if (save) {
    const tb = splitTitleBody(reply);
    if (tb) {
      const saved = await savePost({
        kind: 'draft', title: tb.title, body: tb.body,
        car_model: target.carModel, service_type: target.serviceType, product: target.product || null,
        region: target.region || null,
      });
      draftId = saved?.id ?? null;
      if (!saved) await saveDraftFile(tb.title, tb.body);
    }
  }

  return {
    reply: notes.join('\n'),
    draft: draftResult.draft,
    checks: { violations, facts: factIssues, format: formatIssues },
    draftId,
    target,
  };
}

/**
 * 블로그 글 한 편 생성 (사전 조사 결과를 받아 작성까지). 백그라운드 작업의 "작성" 단계.
 */
export async function generateBlogPost(input: {
  message: string;
  request: BlogRequest | null;
  research: { context: string; summary: string } | null;
  history?: { role: string; content: string }[];
}): Promise<WriterResult> {
  const t = resolveTarget(input.message, input.request);
  const keyword = input.request?.keyword?.trim() || extractKeyword(input.message);
  const target: Target = { carModel: t.carModel, serviceType: t.serviceType, product: t.product, region: input.request?.region || null, keyword };
  const systemPrompt = await buildBlogSystemPrompt(input.research?.context || '', target.serviceType, keyword);
  return runWriter({
    systemPrompt,
    model: BLOG_WRITER_MODEL,
    history: input.history,
    combinedMessage: input.message,
    target,
    researchSummary: input.research?.summary || '',
    save: true,
  });
}

/**
 * 열린 글 수정: 사장님 지시에 해당하는 부분만 고쳐 전체를 다시 출력 → 검사 → 새 초안 버전으로 저장
 * (원래 초안은 그대로 두고 draft_id 로 연결)
 */
export async function reviseBlogPost(input: {
  title: string;
  /** 본문 (HTML 또는 일반 텍스트) */
  content: string;
  instruction: string;
  target: Target;
  parentDraftId?: string | null;
}): Promise<WriterResult & { changeNote: string }> {
  const plain = input.content.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').trim();
  const systemPrompt = `${BLOG_SYSTEM_PROMPT}

[지금 할 일: 기존 글 수정]
아래 [원본 글]을 사장님의 [수정 지시]대로만 고칩니다. 지시와 무관한 문장·구조·사진 태그·제목은 그대로 둡니다. 새 사실·제품·자격·차별점을 추가하지 않습니다. 분량을 줄이라는 지시가 아니면 분량을 줄이지 않습니다.
출력 형식: 첫 줄에 "변경: " 뒤에 무엇을 어떻게 고쳤는지 한 줄 요약 → 빈 줄 → 제목 → 본문 전체. 다른 설명 금지.`;
  const userMsg = `[수정 지시]
${input.instruction}

[원본 글]
${input.title}

${plain}`;

  const raw = await callClaude(systemPrompt, [{ role: 'user', content: userMsg }], 8192, BLOG_WRITER_MODEL);

  // 첫 줄 "변경: ..." 분리
  const lines = raw.split('\n');
  let changeNote = '';
  let bodyStart = 0;
  const firstIdx = lines.findIndex(l => l.trim().length > 0);
  if (firstIdx >= 0 && /^변경\s*:/.test(lines[firstIdx].trim())) {
    changeNote = lines[firstIdx].trim().replace(/^변경\s*:\s*/, '');
    bodyStart = firstIdx + 1;
  }
  const text = lines.slice(bodyStart).join('\n').trim();
  const tb = splitTitleBody(text);
  if (!tb || tb.body.replace(/\s/g, '').length < 500) {
    throw new Error('수정 결과가 글 형식이 아닙니다. 지시를 조금 더 구체적으로 적어주세요.');
  }

  const serviceType = input.target.serviceType;
  const violations = checkHardViolations(tb.body, input.instruction, serviceType);
  const factIssues = factCheck({ body: tb.body, serviceType, product: input.target.product ?? undefined });
  const formatIssues = checkFormatIssues(tb.title, tb.body);

  let draftId: string | null = null;
  const saved = await savePost({
    kind: 'draft', title: tb.title, body: tb.body,
    car_model: input.target.carModel, service_type: serviceType, product: input.target.product || null,
    region: input.target.region || null,
    draft_id: input.parentDraftId || null,
    feedback: `수정: ${input.instruction.slice(0, 200)}`,
  });
  draftId = saved?.id ?? null;

  const notes: string[] = [changeNote ? `✏️ ${changeNote}` : '✏️ 요청하신 대로 고쳤습니다.'];
  if (violations.length > 0) notes.push(`확인 필요: ${violations.map(v => v.detail).join(' / ')}`);
  notes.push(factIssues.length > 0 ? `팩트체크 ${factIssues.length}건 확인 필요: ${factIssues.map(f => f.detail).join(' / ')}` : '팩트체크 통과');
  if (formatIssues.length > 0) notes.push(`형식: ${formatIssues.join(' / ')}`);

  return {
    reply: notes.join('\n'),
    draft: { title: tb.title, content: textToHtml(tb.body), tags: extractTagsFromTitle(tb.title), category: '프로이즘 작업기' },
    checks: { violations, facts: factIssues, format: formatIssues },
    draftId,
    target: input.target,
    changeNote,
  };
}
