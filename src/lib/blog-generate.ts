/**
 * 블로그 글 생성 핵심 로직 (서버 전용)
 * - /api/chat (즉시 응답 경로) 과 /api/jobs (백그라운드 작업 경로) 가 함께 쓴다
 * - 흐름: 시스템 프롬프트 구성 → Claude 작성 → 정규식 위반·팩트·형식 검사 → 필요 시 1회 수정 → draft 구성 → DB 저장
 */
import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { todaySeoul } from '@/lib/local-date';
import path from 'path';
import { callClaude } from './claude-client';
import { resolveTarget, refsToPrompt, isFaqRequest, extractTopic, type ReferencePost } from './blog-research';
import type { BlogRequest } from '@/config/blog-options';
import { factCheck, type FactIssue } from './fact-check';
import { photoColorFromContext } from './photo-check';
import { getOwnerStyle, styleToPrompt } from './owner-style';
import { savePost, listPosts, getPost, updatePost, ownerVoiceReference } from './posts';
import { BLOG_SYSTEM_PROMPT, FAQ_SYSTEM_PROMPT } from '@/config/prompts';
import { buildFactSheet, factsToPrompt, factsNovelty, type FactSheet } from './facts';
import { extractTagsFromTitle, textToHtml } from './draft-format';

/** 블로그 작성 모델 (담당 직원 설정과 무관하게 고정) */
export const BLOG_WRITER_MODEL = 'claude-fable-5-2'; // 2026-11-20 사장님 "글 쓰는 모델이 페이블이 아니야?" — opus-4-6 에서 교체. 되돌리려면 'claude-opus-5-5'

export type Violation = { rule: string; detail: string };
export type Checks = { violations: Violation[]; facts: FactIssue[]; format: string[] };
export type Draft = { title: string; content: string; tags: string[]; category: string };
export type Target = { carModel: string | null; serviceType: string; product: string | null; region: string | null; keyword?: string | null; /** FAQ·공지 글이면 'faq' (2026-11-21) */ mode?: 'work' | 'faq'; topic?: string };

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
  /** 정보 릴스(인스타) 상태 */
  reels?: import('./video').ReelsState | null;
  /** 말하기 영상(인스타) 상태 — 영상 전용 작업 행에만 있음 */
  talk?: import('./video').TalkState | null;
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
/** 사장님 표기로 통일 (2026-11-12): 보닛 → 본넷, 휀더 → 휀다 */
export function normalizeTerms(text: string): string {
  return text.replace(/보닛|본닛|보넷|본네트/g, '본넷').replace(/휀더|펜더|팬더/g, '휀다');
}

/** 사장님이 쓰지 않는 부품 용어 (2026-11-12 "카울·휠아치 같은 말은 쓴 적 없다") */
const JARGON_RE = /카울|휠\s*아치|에어\s*브리더|에어\s*커튼|인테이크|벨트\s*라인|쇼울더|숄더\s*라인|스플리터|범퍼\s*립|하단\s*립/;

const COLOR_GROUPS: [RegExp, string][] = [
  [/블랙|검정|검은/, '블랙'], [/화이트|흰색|흰\s*차|하얀/, '화이트'], [/그레이|회색/, '그레이'], [/실버|은색/, '실버'],
  [/블루|파란|파랑|네이비/, '블루'], [/레드|빨간|빨강/, '레드'], [/그린|초록/, '그린'], [/옐로|노란|노랑/, '옐로'], [/브라운|갈색|베이지/, '브라운'],
];
const colorGroup = (s: string): string | null => { const g = COLOR_GROUPS.find(([re]) => re.test(s)); return g ? g[1] : null; };

export function checkHardViolations(body: string, userInput: string, serviceType: string, knownColor?: string | null): Violation[] {
  const v: Violation[] = [];

  // 0. 작업자 강조 (2026-11-12 사장님: "제가 직접 합니다" 식 노골적 소개 금지)
  const worker = body.match(/(제가|대표가)\s*직접\s*(합니다|시공|작업)|(작업|시공)은\s*제가\s*직접|1인\s*시공|하루\s*(?:에\s*)?한\s*대/);
  if (worker) v.push({ rule: 'worker', detail: `작업자 강조 표현 "${worker[0]}" (삭제)` });

  // 0-0-2. 매장 시설·장소 지어내기 (2026-11-19 사장님 "프로이즘에 지하주차장이 어딨어")
  const place = body.match(/지하\s*주차장|옥상|야외\s*주차장|도장\s*부스|리프트\s*위/);
  if (place) v.push({ rule: 'place', detail: `매장에 없는 장소 "${place[0]}" → 장소 묘사를 빼거나 "매장 안"으로` });

  // 0-0-1. 선언형 표현 (2026-11-18 사장님 "뭐든 너무 노골적으로 표현하지 않았으면"): 기준 사전을 옮겨 적은 티가 나는 문장
  const declare = body.match(/[^\n]{0,14}(?:원칙(?:으로|입니다|이라서|이기)|노하우|저희만|우리만|어디서도\s*못)[^\n]{0,8}/);
  if (declare) v.push({ rule: 'declare', detail: `선언형 표현 "${declare[0].trim()}" → 그 문장은 빼거나, 그 자리에서 실제로 한 일(장면)로 바꾸기` });
  // 글이 글 자신을 설명하는 문장·멋 부린 도입 (2026-11-20 사장님 "30 그리고 15 … 장난하냐")
  const meta = body.match(/[^\n]*(적어\s*보겠습니다|정리하겠습니다|이야기부터\s*시작하겠습니다|뒤에서\s*다시\s*(하|말씀드리)겠습니다|적는\s*이유가\s*있습니다|숫자로\s*줄이면|순서대로\s*적은\s*기록|차례대로\s*적|기록입니다)[^\n]*/);
  if (meta) v.push({ rule: 'meta', detail: `글 자체를 설명하는 문장 "${meta[0].trim().slice(0, 40)}" (삭제)` });

  // 0-0. 부품 용어
  const jargon = body.match(JARGON_RE);
  if (jargon) v.push({ rule: 'jargon', detail: `사장님이 쓰지 않는 부품 용어 "${jargon[0]}" (쉬운 말로 바꾸거나 삭제: 휠아치 → 휀다 안쪽, 카울 → 본넷 뒤쪽 등)` });

  // 0-2. 요청에 없는 고객 사정·보증 기간 (2026-11-12 X5 글: "신차로 들어오셨고요", "3~4년 타실 계획", "5년 보증" 전부 지어낸 것)
  if (!/신차|출고/.test(userInput)) {
    const m = body.match(/신차로|신차여서|신차라서|출고\s*직후|출고된\s*지|출고한\s*지|출고\s*후\s*바로|출고하고\s*바로|새\s*차(?:로|라서|여서)/);
    if (m) v.push({ rule: 'unprovided', detail: `요청에 없는 고객 사정 "${m[0]}" (신차 여부를 모르면 쓰지 않는다)` });
  }
  if (!/보증/.test(userInput)) {
    const m = body.match(/\d+\s*년\s*보증|보증\s*기간|보증이?\s*\d+\s*년/);
    if (m) v.push({ rule: 'unprovided', detail: `알려주지 않은 보증 기간 "${m[0]}" (삭제)` });
  }
  {
    const m = body.match(/\d+\s*~?\s*\d*\s*년\s*(?:정도\s*)?(?:타실|타시고|타신다|탈\s*계획|보유)/);
    if (m && !/년/.test(userInput)) v.push({ rule: 'unprovided', detail: `요청에 없는 고객 계획 "${m[0]}" (삭제)` });
  }

  // 0-1. 사진·요청으로 확인된 차량 색상과 다른 색 (필름·트림·휠 색 문장은 제외)
  const known = knownColor ? colorGroup(knownColor) : null;
  if (known) {
    // 2026-11-13: 컬러PPF·랩핑은 "블루 도장 위에 매트블랙"처럼 원색과 필름색이 한 줄에 같이 나오므로, 원색이 함께 적힌 줄은 잡지 않는다
    const knownRe = COLOR_GROUPS.find(([, name]) => name === known)?.[0];
    const bad = body.split('\n').find(l => !/2080|글로스|피아노|트림|몰딩|휠|필름|캘리퍼|실내|그릴|랩핑|크롬|투톤|올라가|올린|감싸|블랙박스|플레이트|소프트톱|시트|가죽|스퀴지|하드카드|테이프|보호천|극세사|장갑/.test(l) && !(knownRe && knownRe.test(l)) && colorGroup(l) && colorGroup(l) !== known);
    if (bad) v.push({ rule: 'color', detail: `차량 색상은 ${known}인데 다른 색으로 서술: "${bad.trim().slice(0, 30)}"` });
  }

  // 0-3. 요청에 없는 탈거 서술 (2026-11-13 4시리즈 PWF 글 "손잡이는 탈거한 뒤" 지어낸 것). 크롬죽이기의 손잡이 탈거는 시공 규칙이라 허용
  if (!/탈거|분해|떼어/.test(userInput)) {
    const m = body.match(/[^\n]{0,12}탈거[^\n]{0,8}/);
    // 크롬죽이기의 손잡이 탈거, PPF의 번호판 탈거는 시공 규칙이라 허용 (2026-11-18 사장님: 번호판은 탈거하고 작업)
    if (m && !(/크롬/.test(serviceType) && /손잡이/.test(m[0])) && !(/PPF/i.test(serviceType) && /번호판/.test(m[0]))) v.push({ rule: 'unprovided', detail: `요청에 없는 탈거 서술 "${m[0].trim()}" (탈거 여부를 모르면 쓰지 않는다. 그 문장은 끝단 마감 서술로 바꾸기)` });
  }

  // 0-4. 차량 구조 지어내기 (2026-11-14 5시리즈 글에 "프레임리스 도어" — 4시리즈 자료가 섞인 것). 요청에 없으면 쓰지 않는다
  if (!/프레임리스/.test(userInput)) {
    const m = body.match(/프레임리스[^\n]{0,10}/);
    if (m) v.push({ rule: 'unprovided', detail: `요청에 없는 차량 구조 "${m[0].trim()}" (이 차가 프레임리스인지 확인 안 됨 → 그 문장 삭제)` });
  }
  // 0-5. 썬팅 농도 숫자는 요청에 있는 것만 (2026-11-14 "전면을 40이나 50으로", "측후면을 5까지" 권유 수치 지어냄)
  if (/썬팅|신차패키지/.test(serviceType)) {
    const given = new Set(Array.from(userInput.matchAll(/(\d{1,2})\s*%/g)).map(m => m[1]));
    const used = Array.from(body.matchAll(/(\d{1,2})\s*(?:%|퍼센트|프로)|(\d{1,2})(?=\s*(?:이나\s*\d|으로\s*올리|로\s*올리|까지\s*내리|로\s*내리))/g)).map(m => m[1] || m[2]);
    const bad = Array.from(new Set(used.filter(n => !given.has(n))));
    if (bad.length) v.push({ rule: 'unprovided', detail: `요청에 없는 썬팅 농도 ${bad.map(n => `${n}%`).join(', ')} (다른 농도 권유·비교 문장 삭제. 이 차의 농도만 쓴다)` });
  }

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

  // 4. 경력 연수 (2026-11-11부터 누구에게도 금지)
  const careerRe = /(\d+|수십|오랜)\s*년\s*(?:간|동안|의)?\s*(경력|노하우|경험)/g;
  let cm: RegExpExecArray | null;
  while ((cm = careerRe.exec(body)) !== null) {
    const around = body.slice(Math.max(0, cm.index - 40), cm.index + cm[0].length + 20);
    if (around) { v.push({ rule: 'career', detail: `경력 연수 표현 "${cm[0]}" (누구에게도 쓰지 않음)` }); break; }
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
const MIN_BODY_CHARS = 2000;   // 2026-11-20 사장님 "공백 제외 2,000자 이상이면 그냥 둬"
const MIN_TITLE_CHARS = 18;    // 목표 20~25자

export function checkFormatIssues(title: string, body: string, keyword?: string | null): string[] {
  const issues: string[] = [];
  if (keyword) {
    if (!normKw(title).includes(normKw(keyword))) {
      issues.push(`제목에 지정 키워드 "${keyword}"가 없음 → 제목 앞부분에 "${keyword}"를 그대로 넣을 것(글자 순서·띄어쓰기 유지)`);
    }
    const bodyPlain = normKw(body.replace(/<[^>]+>/g, ''));
    const count = bodyPlain.split(normKw(keyword)).length - 1;
    if (count < 2) {
      issues.push(`본문에 지정 키워드 "${keyword}"가 ${count}회 → 문장 흐름을 해치지 않는 자리에 두세 번 자연스럽게(제목·해시태그 제외)`);
    }
  }
  const pureLen = body.replace(/\[사진\s*\d+\]/g, '').replace(/\s/g, '').length;
  if (pureLen < MIN_BODY_CHARS) {
    issues.push(`분량 부족: 공백 제외 ${pureLen}자 → 2,000자 이상. 설명으로 늘리지 말고 사실표·사장님 메모에 있는 장면(왜 왔는지·어디가 까다로웠는지·어떻게 했는지)을 더 풀 것. 재료가 없으면 글 끝에 [재료 필요] 한 줄`);
  }
  if (title.length < MIN_TITLE_CHARS) {
    issues.push(`제목 ${title.length}자로 짧음 → 20~25자로 ("[지역] [차종] [서비스]"에 핵심 포인트 한 가지 덧붙이기)`);
  }
  // (2026-11-25) 모바일 줄바꿈 글자 수 검사는 뺌 — 핵심 규칙 6개 외
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

export type PreviousPost = { title: string; intro: string; closing: string; /** 본문 줄(연락처·서명·사진·해시태그 제외) — 같은 문장 검사용 */ rawLines?: string[] };

/** 본문을 실제 문장 줄만으로 (HTML 태그·[사진 N]·해시태그·빈 줄 제거) */
function textLines(body: string): string[] {
  return body
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .split('\n').map(l => l.trim())
    .filter(l => l && !/^\[사진\s*\d+\]$/.test(l) && !l.startsWith('#'));
}

const CONTACT_RE = /010-7287|서초중앙로|blog\.naver|^감사합니다/;

/** 겹침 비교용: 도입 6줄 + 마무리 4줄(연락처 제외) + 본문 줄 */
function summarizeForRepeat(body: string): { intro: string; closing: string; rawLines: string[] } {
  const lines = textLines(body);
  const intro = lines.slice(0, 6).join(' / ');
  const closing = lines.filter(l => !CONTACT_RE.test(l)).slice(-4).join(' / ');
  return { intro, closing, rawLines: lines.filter(l => !FIXED_LINE_RE.test(l)) };
}

/** 글마다 똑같아도 되는 줄: 연락처·주소·서명·상호 */
const FIXED_LINE_RE = /010-7287|서초중앙로|서울특별시|서초구|blog\.naver|진준호(입니다|였습니다)|3M\s*프로이즘\s*강남서초점|프리퍼드 인스톨러 매장/;

/** 이번 글의 줄이 이전 글 2편 이상에 그대로 있으면(6줄 이상) 1회 수정 대상 — 사실은 두고 말만 바꾸게 */
export function checkLineRepeat(body: string, previous: PreviousPost[]): Violation[] {
  if (previous.length < 3) return [];
  const docs = previous.slice(0, 12).map(p => new Set((p.rawLines || []).map(normLine).filter(k => k.length >= 8)));
  if (docs.every(d => d.size === 0)) return [];
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const l of textLines(body)) {
    if (FIXED_LINE_RE.test(l)) continue;
    const k = normLine(l);
    if (k.length < 10 || seen.has(k)) continue;
    seen.add(k);
    let n = 0;
    for (const d of docs) if (d.has(k)) n++;
    if (n >= 2) hits.push(l);
  }
  if (hits.length < 6) return [];
  return [{ rule: 'body', detail: `이전 글과 똑같은 문장이 ${hits.length}줄 있음(예: ${hits.slice(0, 8).map(h => `"${h}"`).join(', ')}) → 이 문장들은 뜻은 두고 말을 바꾸거나 설명 순서를 바꿔 다시 쓰기(연락처·서명은 그대로)` }];
}

const normLine = (s: string) => s.replace(/[\s.,!?~…·'"“”‘’()\-]/g, '');

/** 이전 AI 글(초안·최종본)과 도입·마무리 문장이 그대로 겹치는지 검사 */
export function checkIntroRepeat(body: string, previous: PreviousPost[]): Violation[] {
  if (previous.length === 0) return [];
  const v: Violation[] = [];
  const lines = textLines(body);
  const prevIntro = new Set(previous.flatMap(p => p.intro.split(' / ')).map(normLine).filter(x => x.length >= 10));
  const prevClosing = new Set(previous.flatMap(p => p.closing.split(' / ')).map(normLine).filter(x => x.length >= 12));

  const opening = lines.slice(0, 4).filter(l => !FIXED_LINE_RE.test(l));
  // "완성된 모습부터"의 변형("바뀐 뒤의 모습을 먼저 보시고", "먼저 보여드리고 시작")까지 잡는다 (2026-11-13 4시리즈 PWF 글)
  const stock = opening.find(l => /완성된?\s*모습|완성\s*(사진|컷|모습)?\s*부터|먼저\s*보(시|여)|뒤의\s*모습|바뀐\s*모습/.test(l));
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

/**
 * 문단 안 키워드 몰아 쓰기 검사 (2026-11-16 김민우실장: 좁은 공간에 같은 키워드를 여러 번 반복하면 광고로 인식돼 질이 낮아진다는 뇌피셜 룰,
 * 기둥 글 한 문단에 "3M" 4~5회가 몰려 있었음). 문단(빈 줄 기준) 하나에 같은 말이 3회 이상이면 1회 수정 대상.
 * 서명 줄("3M 프리퍼드 인스톨러 매장, 3M 프로이즘 …진준호입니다")의 2회는 세지 않는다. 해시태그·사진 태그·연락처 줄 제외.
 * 글 전체로는 "3M"만 따로 본다(브랜드명이 서른 번 넘게 나오던 일). 지역명 3~5회 규칙과 충돌하지 않게 전체 횟수는 브랜드만.
 */
const DENSITY_TERMS = ['3M', '프로이즘', '프리퍼드 인스톨러', 'PPF', '컬러PPF', 'PWF', '랩핑', '크롬죽이기', '썬팅', '유리막코팅', '신차패키지', '신차검수',
  '강남', '서초', '역삼', '청담', '양재', '반포', '잠원', '논현', '방배', '삼성동', '대치', '송파', '분당', '판교', '하남'];
const PARA_MAX = 2;        // 문단당 같은 말 최대 2회(브랜드·지역·제목 키워드)
const SERVICE_TERMS = new Set(['PPF', '컬러PPF', 'PWF', '랩핑', '크롬죽이기', '썬팅', '유리막코팅', '신차패키지', '신차검수']);
const SERVICE_PARA_MAX = 3; // 시공 종류는 의뢰 목록 문단에서 3회까지 자연스러움(5시리즈 신차패키지 글)
const BRAND_TOTAL_MAX = 12; // 글 전체 "3M" 최대
const SIGNATURE_LINE_RE = /진준호(입니다|였습니다)/;

function countTerm(text: string, term: string): number {
  const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), term === '3M' ? 'gi' : 'g');
  return (text.match(re) || []).length;
}

export function checkKeywordDensity(body: string, keyword?: string | null): Violation[] {
  const plain = body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '');
  const paras = plain.split(/\n\s*\n/).map(p =>
    p.split('\n').map(l => l.trim()).filter(l => l && !/^\[사진\s*\d+\]$/.test(l) && !l.startsWith('#') && !CONTACT_RE.test(l))
  ).filter(p => p.length > 0);
  const terms = [...DENSITY_TERMS];
  if (keyword) for (const t of keyword.split(/\s+/).filter(t => t.length >= 2 && !terms.includes(t))) terms.push(t);
  // 용어별 가장 심한 문단만 보고한다
  const worst = new Map<string, { n: number; first: string; paras: number }>();
  for (const lines of paras) {
    const text = lines.join('\n');
    for (const term of terms) {
      const max = SERVICE_TERMS.has(term) ? SERVICE_PARA_MAX : PARA_MAX;
      let n = countTerm(text, term);
      if (term === '3M' || term === '프로이즘' || term === '프리퍼드 인스톨러') {
        // 서명 줄의 횟수는 빼 준다
        for (const l of lines) if (SIGNATURE_LINE_RE.test(l)) n -= countTerm(l, term);
      }
      // "컬러PPF"는 "PPF"에도 잡히므로, PPF 는 컬러PPF 를 뺀 나머지만
      if (term === 'PPF') n -= countTerm(text, '컬러PPF');
      if (n > max) {
        const w = worst.get(term);
        if (!w) worst.set(term, { n, first: lines[0].slice(0, 18), paras: 1 });
        else { w.paras += 1; if (n > w.n) { w.n = n; w.first = lines[0].slice(0, 18); } }
      }
    }
  }
  const hits = [...worst.entries()].map(([term, w]) => `"${term}" ${w.n}회(문단 "${w.first}…"${w.paras > 1 ? ` 외 ${w.paras - 1}곳` : ''})`);
  const out: Violation[] = [];
  if (hits.length > 0) {
    out.push({ rule: 'density', detail: `한 문단에 같은 말이 몰려 있음: ${hits.join(', ')} → 문단당 2회 이하로. 두 번째부터는 받아 쓰기(그 교육·본사·거기서 정한 기준·이 필름·그 작업 등)로 바꾸고 사실·순서는 그대로` });
  }
  const brandTotal = paras.reduce((a, lines) => a + countTerm(lines.filter(l => !SIGNATURE_LINE_RE.test(l)).join('\n'), '3M'), 0);
  if (brandTotal > BRAND_TOTAL_MAX) {
    out.push({ rule: 'density', detail: `글 전체에 "3M"이 ${brandTotal}회 → ${BRAND_TOTAL_MAX}회 이하로. 제품명(시리즈150·2080·크리스탈라인)만 남기고 나머지 "3M"은 빼거나 받아 쓰기로` });
  }
  return out;
}

/** 이전 글들이 쓴 형식 키(최신순) — 이번 글 형식 고르기용 */
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
    const date = todaySeoul();
    const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '').slice(0, 50);
    const rule = `[유사성 금지] 이 글과 유사한 도입부, 표현, 문장 구조, 비유를 다음 글에서 절대 반복하지 마세요.`;
    await writeFile(path.join(DRAFTS_DIR, `${date}_${safeTitle}.txt`), `${title}\n\n${body}\n\n---\n${rule}`, 'utf-8');
  } catch { /* 저장 실패해도 응답에는 영향 없음 */ }
}

export interface RunWriterOptions {
  /** 사진·요청으로 확인된 차량 색상 (있으면 본문의 다른 색 서술을 잡는다) */
  knownColor?: string | null;
  systemPrompt: string;
  model: string;
  history?: { role: string; content: string }[];
  /** Claude에 보내는 최종 사용자 메시지 (사진 컨텍스트 포함) */
  combinedMessage: string;
  target: Target;
  researchSummary?: string;
  /** 조사 원문(확인 안 된 항목을 접수 요약에 보여 주기 위해, 2026-11-19) */
  researchContext?: string;
  /** 초안을 DB에 저장할지 (블로그 요청일 때만) */
  save: boolean;
  /** 이번 글에 녹인 차별점 이름들 (접수 요약에 표시) */
  differentiatorNames?: string[];
  /** 이번 글에 넣은 부위별 시공 기준 (접수 요약에 표시) */
  standardNames?: string[];
}

/**
 * 작성 → 검사 → 1회 수정 → draft 구성 → 저장. /api/chat 과 백그라운드 작업이 공유하는 핵심.
 */
export async function runWriter(opts: RunWriterOptions): Promise<WriterResult> {
  const { systemPrompt, model, history = [], combinedMessage, target, researchSummary = '', save, knownColor = null, differentiatorNames = [], standardNames = [] } = opts;
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
  let violations = first ? [...checkHardViolations(first.body, combinedMessage, serviceType, knownColor)] : [];
  let factIssues: FactIssue[] = first ? factCheck({ body: first.body, serviceType, product: target.product ?? undefined }) : [];
  let formatIssues = first ? checkFormatIssues(first.title, first.body, target.keyword) : [];
  const pureLen = (b: string) => b.replace(/\[사진\s*\d+\]/g, '').replace(/\s/g, '').length;

  // 1회 수정. 팩트·위반이 남으면 한 번 더 (형식만 남았으면 안 함)
  for (let pass = 0; pass < 2 && first; pass++) {
    if (violations.length === 0 && factIssues.length === 0 && (pass > 0 || formatIssues.length === 0)) break;
    try {
      const cur = splitTitleBody(reply) || first;
      const issues = [...violations.map(v => v.detail), ...factIssues.map(f => `팩트 오류 — ${f.detail}`), ...formatIssues];
      const fixed = await fixIssues(systemPrompt, reply, issues, model);
      const f = splitTitleBody(fixed);
      if (f && pureLen(f.body) >= Math.min(1500, pureLen(cur.body))) {
        const fixedViolations = [...checkHardViolations(f.body, combinedMessage, serviceType, knownColor)];
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

  // 그래도 시리즈50·100 글에 발수코팅이 남아 있으면 그 문단을 통째로 뺀다 (2026-11-12 X5 시리즈50 글에 4문장 남았던 일)
  if (first && factIssues.some(f => f.rule === 'hydrophobic_50_100')) {
    const cur = splitTitleBody(reply);
    if (cur) {
      const stripped = cur.body.split(/\n\s*\n/).filter(p => !/발수/.test(p)).join('\n\n');
      if (pureLen(stripped) >= 1500) {
        reply = `${cur.title}\n${stripped}`;
        violations = [...checkHardViolations(stripped, combinedMessage, serviceType, knownColor)];
        factIssues = factCheck({ body: stripped, serviceType, product: target.product ?? undefined });
        formatIssues = checkFormatIssues(cur.title, stripped, target.keyword);
      }
    }
  }

  reply = normalizeTerms(reply);
  draftResult = tryBuildDraft(reply, combinedMessage);
  if (!draftResult) return { reply, draft: null, checks: null, draftId: null, target: null };

  const notes: string[] = ['블로그 글이 완성되었습니다.'];
  if (differentiatorNames.length) notes.push(`녹인 차별점: ${differentiatorNames.join(' · ')}`);
  if (standardNames.length) notes.push(`부위 기준 참고: ${standardNames.join(' · ')}`);
  if (violations.length > 0) notes.push(`확인 필요: ${violations.map(v => v.detail).join(' / ')}`);
  notes.push(factIssues.length > 0 ? `팩트체크 ${factIssues.length}건 확인 필요: ${factIssues.map(f => f.detail).join(' / ')}` : '팩트체크 통과 (제품·시공 규칙 위반 없음)');
  if (formatIssues.length > 0) notes.push(`형식: ${formatIssues.join(' / ')}`);
  if (researchSummary) notes.push(researchSummary);
  // 조사가 확인 못 한 구조를 사장님이 바로 보게 (2026-11-19). 글에는 안 쓰도록 위 [사전 조사 사용 규칙]이 막는다
  const unknownBlock = (opts.researchContext || '').split('[확인 안 된 항목]')[1];
  if (unknownBlock) {
    const items = unknownBlock.split('\n').map(l => l.replace(/^[-•·\s]+/, '').trim()).filter(l => l && !l.startsWith('[')).slice(0, 5);
    if (items.length) notes.push(`조사에서 확인 못 한 것(글에 안 씀, 맞으면 알려 주세요): ${items.join(' / ')}`);
  }

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

/** 삭제 전용 패스: 지적된 문장만 지운다 (2026-11-20 재설계 — 고쳐 쓰기·늘리기 패스 없음) */
async function deleteOffending(systemPrompt: string, original: string, issues: string[], model: string): Promise<string> {
  const msg = `아래 [지적]에 해당하는 문장(또는 그 문단)만 삭제하세요. 다른 문장은 글자 하나 바꾸지 말고, 새 문장을 넣지 마세요. 제목·해시태그는 그대로.
[지적]
${issues.map(i => `- ${i}`).join('\n')}

[원본]
${original}

설명 없이 제목부터 글 전체를 다시 출력하세요.`;
  return await callClaude(systemPrompt, [{ role: 'user', content: msg }], 8192, model);
}

/** 사실표만으로 쓰는 작성 프롬프트: 핵심 규칙 6개 + 사실표 + 제목 키워드 + 사장님 어휘 + 사장님 글(말투). 이전 글 도입 블록은 2026-11-25 뺌 */
export async function buildWriterPromptFromFacts(facts: FactSheet, serviceType: string, keyword?: string | null, refs: ReferencePost[] = [], mode: 'work' | 'faq' = 'work'): Promise<string> {
  const [ownerStyle, voiceRef] = await Promise.all([getOwnerStyle(), ownerVoiceReference(2)]);
  // 말투 참고 = 사장님이 붙인 링크(있으면) + 사장님이 직접 쓴 FAQ·공지 글 2편 (2026-11-20 "FAQ나 공지글 참고해")
  const toneReference = `${refsToPrompt(refs, 'writer')}${voiceRef}`;
  const styleContext = ownerStyle ? styleToPrompt(ownerStyle) : '';
  const keywordContext = keyword ? `\n\n[제목 키워드 — 필수] "${keyword}"를 제목 앞부분에 그대로 넣고(띄어쓰기·순서 유지) 본문에 3~5회, 해시태그에 한 번` : '';
  const previousContext = ''; // (2026-11-25) 이전 글 도입 블록 뺌 — 돌려쓰기 규칙 제거
  const base = mode === 'faq' ? FAQ_SYSTEM_PROMPT : BLOG_SYSTEM_PROMPT;
  return `${base}${factsToPrompt(facts).replace('[이 작업의 사실표', mode === 'faq' ? '[이 글의 사실표' : '[이 작업의 사실표')}${keywordContext}${styleContext}${toneReference}${previousContext}`;
}

/**
 * 사실표로 글 한 편 (2026-11-20 재설계): 한 번 쓰고, 사실 금지 위반만 삭제 패스 1회, 나머지는 표시만. 늘리기 없음.
 */
export async function writeFromFacts(input: { facts: FactSheet; message: string; request: BlogRequest | null; target: Target; knownColor?: string | null; save: boolean; refs?: ReferencePost[] }): Promise<WriterResult> {
  const { facts, target } = input;
  const systemPrompt = await buildWriterPromptFromFacts(facts, target.serviceType, target.keyword, input.refs || [], target.mode || 'work');
  const userMsg = `${input.message}\n\n위 요청과 시스템의 ${target.mode === 'faq' ? '[이 글의 사실표]' : '[이 작업의 사실표]'}만으로 글을 쓰세요.`;
  let reply = await callClaude(systemPrompt, [{ role: 'user', content: userMsg }], 8192, BLOG_WRITER_MODEL);
  let draftResult = tryBuildDraft(reply, input.message);
  if (!draftResult) return { reply, draft: null, checks: null, draftId: null, target: null };

  const serviceType = target.serviceType;
  const previous = input.save ? await getPreviousDrafts() : [];
  // 검사의 '요청' 기준은 요청문 + 확정 사실표 (사장님이 표에 보탠 농도·제품이 '요청에 없음'으로 잡히지 않게)
  const provided = `${input.message}\n${facts.lines.map(l => l.text).join('\n')}`;
  const check = (title: string, body: string) => ({
    violations: [...checkHardViolations(body, provided, serviceType, input.knownColor ?? null)],
    // 열차단·IR 수치 등은 사실표(조사 공식 정보·사장님 메모)에 있으면 지어낸 게 아니다
    facts: factCheck({ body, serviceType, product: target.product ?? undefined }).filter(f => !(/열\s*차단|적외선|IR|자외선|가시광선|비금속|세라믹/.test(f.detail) && /\d\s*%|비금속|세라믹|전파/.test(provided))),
    format: checkFormatIssues(title, body, target.keyword),
  });
  let tb = splitTitleBody(reply)!;
  let c = check(tb.title, tb.body);
  const pureLen = (b: string) => b.replace(/\s/g, '').length;

  // 사실 금지 위반·팩트 오류가 있으면 그 문장만 지우는 패스 1회 (도입·되풀이·키워드 밀도·형식은 표시만)
  const HARD = new Set(['heat', 'quote', 'career', 'worker', 'color', 'place', 'jargon', 'unprovided', 'declare', 'careful', 'cliche', 'meta']);
  const hardIssues = [...c.violations.filter(v => HARD.has(v.rule)).map(v => v.detail), ...c.facts.map(f => `팩트 오류 — ${f.detail}`)];
  if (hardIssues.length > 0) {
    try {
      const fixed = await deleteOffending(systemPrompt, reply, hardIssues, BLOG_WRITER_MODEL);
      const f = splitTitleBody(fixed);
      if (f && pureLen(f.body) >= pureLen(tb.body) * 0.7) {
        const c2 = check(f.title, f.body);
        const hardAfter = c2.violations.filter(v => HARD.has(v.rule)).length + c2.facts.length;
        if (hardAfter < c.violations.filter(v => HARD.has(v.rule)).length + c.facts.length) { reply = fixed; tb = f; c = c2; }
      }
    } catch { /* 삭제 실패 시 원본 유지 */ }
  }
  // 시리즈50·100 글의 발수코팅 문단은 코드로 삭제
  if (c.facts.some(f => f.rule === 'hydrophobic_50_100')) {
    const stripped = tb.body.split(/\n\s*\n/).filter(p => !/발수/.test(p)).join('\n\n');
    reply = `${tb.title}\n${stripped}`; tb = { title: tb.title, body: stripped }; c = check(tb.title, tb.body);
  }

  reply = normalizeTerms(reply);
  draftResult = tryBuildDraft(reply, input.message);
  if (!draftResult) return { reply, draft: null, checks: null, draftId: null, target: null };
  tb = splitTitleBody(reply) || tb;

  const novelty = factsNovelty(tb.body, facts, input.message);
  const len = pureLen(tb.body);
  const notes: string[] = ['블로그 글이 완성되었습니다.'];
  notes.push(`사실표 ${facts.lines.length}줄로 작성${facts.edited ? ' (사장님이 고친 표)' : ''}`);
  if (c.violations.length > 0) notes.push(`확인 필요: ${c.violations.map(v => v.detail).join(' / ')}`);
  notes.push(c.facts.length > 0 ? `팩트체크 ${c.facts.length}건 확인 필요: ${c.facts.map(f => f.detail).join(' / ')}` : '팩트체크 통과');
  if (novelty.length > 0) notes.push(`사실표에 없는 숫자·제품명이 글에 있음(확인): ${novelty.join(', ')}`);
  if (len < 2000) notes.push(`분량 ${len.toLocaleString()}자 — 자동으로 늘리지 않았습니다. 사실 ${Math.ceil((2000 - len) / 250)}줄쯤 더 주시면 채웁니다`);
  if (c.format.length > 0) notes.push(`형식: ${c.format.filter(x => !/2[05]00|분량/.test(x)).join(' / ')}`.replace(/형식: $/, '').trim());

  let draftId: string | null = null;
  if (input.save) {
    const saved = await savePost({
      kind: 'draft', title: tb.title, body: tb.body,
      car_model: target.carModel, service_type: target.mode === 'faq' ? `FAQ·${target.serviceType}` : target.serviceType, product: target.product || null,
      region: target.region || null,
      feedback: `사실표 ${facts.lines.length}줄${facts.unsure.length ? ` · 확인 필요 ${facts.unsure.length}` : ''}`,
    });
    draftId = saved?.id ?? null;
    if (!draftId) await saveDraftFile(tb.title, tb.body);
  }
  return { reply: notes.filter(Boolean).join('\n'), draft: draftResult.draft, checks: { violations: c.violations, facts: c.facts, format: c.format }, draftId, target };
}

/**
 * 블로그 글 한 편 생성 — 백그라운드 작업의 "작성" 단계.
 * 2026-11-20 재설계: 사실표(facts)가 있으면 그것만으로 쓴다. 없으면(즉시 경로) 여기서 사실표를 만들고 확인 없이 쓴다.
 */
export async function generateBlogPost(input: {
  message: string;
  request: BlogRequest | null;
  research: { context: string; summary: string; facts?: FactSheet | null; refs?: ReferencePost[] } | null;
  history?: { role: string; content: string }[];
  facts?: FactSheet | null;
}): Promise<WriterResult> {
  const t = resolveTarget(input.message, input.request);
  const keyword = input.request?.keyword?.trim() || extractKeyword(input.message);
  const faq = isFaqRequest(input.message, input.request);
  const target: Target = { carModel: t.carModel, serviceType: t.serviceType, product: t.product, region: input.request?.region || null, keyword, mode: faq ? 'faq' : 'work', topic: faq ? extractTopic(input.message, input.request) : undefined };
  const knownColor = input.request?.color?.trim() || photoColorFromContext(input.research?.context);
  const refs = input.research?.refs || [];
  const facts = input.facts || input.research?.facts || await buildFactSheet({ message: input.message, request: input.request, researchContext: input.research?.context || '', serviceType: target.serviceType, carModel: target.carModel, refs, mode: target.mode, topic: target.topic });
  const result = await writeFromFacts({ facts, message: input.message, request: input.request, target, knownColor, save: true, refs });
  if (input.research?.summary) result.reply = `${result.reply}\n${input.research.summary}`;
  return result;
}

/**
 * 열린 글 수정: 사장님 지시에 해당하는 부분만 고쳐 전체를 다시 출력 → 검사 → 저장
 * 2026-11-18 사장님 "초안에서 수정하면 하나 더 만들지 말고 초안을 덮어쓰자": 열린 글이 초안(draft)이면 그 행을 덮어쓰고
 * feedback 에 수정 지시를 쌓는다. 열린 글이 최종본(final)·사장님 글이면 예전처럼 새 초안(draft_id=원본)으로 만든다
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
  const text = normalizeTerms(lines.slice(bodyStart).join('\n').trim());
  const tb = splitTitleBody(text);
  if (!tb || tb.body.replace(/\s/g, '').length < 500) {
    throw new Error('수정 결과가 글 형식이 아닙니다. 지시를 조금 더 구체적으로 적어주세요.');
  }

  const serviceType = input.target.serviceType;
  const violations = [...checkHardViolations(tb.body, input.instruction, serviceType)];
  const factIssues = factCheck({ body: tb.body, serviceType, product: input.target.product ?? undefined });
  const formatIssues = checkFormatIssues(tb.title, tb.body);

  let draftId: string | null = null;
  const parent = input.parentDraftId ? await getPost(input.parentDraftId) : null;
  const note = `수정: ${input.instruction.slice(0, 200)}`;
  if (parent && parent.kind === 'draft') {
    // 같은 초안 덮어쓰기. 수정 이력은 feedback 에 줄로 쌓는다(최근 10줄)
    const history = [...(parent.feedback || '').split('\n').filter(Boolean), note].slice(-10).join('\n');
    const updated = await updatePost(parent.id, { title: tb.title, body: tb.body, feedback: history });
    draftId = updated?.id ?? parent.id;
  } else {
    const saved = await savePost({
      kind: 'draft', title: tb.title, body: tb.body,
      car_model: input.target.carModel, service_type: serviceType, product: input.target.product || null,
      region: input.target.region || null,
      draft_id: input.parentDraftId || null,
      feedback: note,
    });
    draftId = saved?.id ?? null;
  }

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
