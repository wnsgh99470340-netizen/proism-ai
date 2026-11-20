/**
 * 이 작업의 사실표 (2026-11-20 재설계, docs/시공기-파이프라인-재설계-2026-11-20.md)
 * - 조사·사진·요청·사장님 글·매장 기본 사실에서 "이 차·이 의뢰에 대해 참인 것"만 10~15줄로 뽑는다
 * - 글 쓰는 모델에게는 이 표만 들어간다 (조사 원문·사진 장면·차별점 목록은 더 이상 글에 직접 들어가지 않는다)
 * - 사장님이 줄을 지우거나 보태 확정한 뒤에 글을 쓴다 (blog_jobs.status = confirming)
 */
import { callClaude } from './claude-client';
import { BUSINESS_CONTEXT } from '@/config/prompts';
import { pickDifferentiators } from '@/config/differentiators';
import type { BlogRequest } from '@/config/blog-options';
import { refsToPrompt, type ReferencePost } from './blog-research';

export type FactSource = '요청' | '사장님 메모' | '사진' | '참고 글' | '조사' | '매장 기본';
export const FACT_SOURCES: FactSource[] = ['요청', '사장님 메모', '사진', '참고 글', '조사', '매장 기본'];

export interface FactLine { text: string; source: FactSource }
export interface FactSheet {
  lines: FactLine[];
  /** 사진·조사에 보이지만 요청 범위에 없거나 확인이 안 된 것 — 글에 쓰지 않는다, 사장님이 보고 올릴 수 있다 */
  unsure: string[];
  built_at: string;
  confirmed_at?: string | null;
  /** 사장님이 확정하면서 고친 횟수(줄 추가·삭제) */
  edited?: boolean;
}

/** 사실표를 만드는 모델 — 글 쓰는 모델과 같은 것 */
export const FACTS_MODEL = 'claude-fable-5-2';

const SYSTEM = `당신은 자동차 시공점 블로그 글을 쓰기 전에 "이 작업의 사실표"를 만드는 편집자입니다. 글을 쓰지 않습니다.
사실표는 이 차·이 의뢰에 대해 참인 것만 담습니다. 참인지 모르는 것은 사실표가 아니라 "확인 필요"에 둡니다.
출력은 JSON 하나뿐입니다.`;

function buildPrompt(input: { message: string; request: BlogRequest | null; researchContext: string; serviceType: string; carModel: string | null; refs?: ReferencePost[] }): string {
  const memo = input.request?.notes?.trim() || '';
  const didInspection = /검수/.test(input.message) && !/검수(는|도)?\s*(안|하지 않|제외|빼)/.test(input.message);
  const diffs = pickDifferentiators(input.serviceType).filter(d => d.key !== 'inspection' || didInspection);
  const productFacts = BUSINESS_CONTEXT.split('# 제품·시공 팩트')[1] || '';
  return `[요청 원문 — 최우선. 여기 적힌 범위·제품·농도·색이 기준]
${input.message}
${input.request ? `\n[폼 입력] 차종 ${input.request.brand} ${input.request.model} / 시공 ${input.request.serviceLabel} / 범위 ${input.request.range} / 제품 ${[input.request.product, input.request.extra].filter(Boolean).join(' ')} / 색 ${input.request.color || '-'}` : ''}
${memo ? `\n[사장님 현장 메모 — 이 차에서 실제 있었던 일. 그대로 사실표에 넣는다]\n${memo}` : '\n[사장님 현장 메모] 없음'}

[차종 구조 조사·사진 확인 — 재료일 뿐 사실이 아니다]
${input.researchContext || '(없음)'}${refsToPrompt(input.refs || [], 'facts')}

[제품·시공 팩트 — 제품 설명은 이 안에서만]
${productFacts}

[맡겨야 하는 이유 후보 — 이 글에 맞는 것 2~3개를 '매장 기본' 줄로]
${diffs.map(d => `- ${d.label}: ${d.fact}`).join('\n')}
- 관리: 메인터넌스 6개월(필름 위 전용 코팅제 도포·끝단 점검). QC 2주는 PPF·컬러PPF에만

## 규칙
1. 10~15줄. 한 줄에 사실 하나, 30자 안팎, 글 문장이 아니라 메모처럼. 각 줄에 출처 하나: 요청 / 사장님 메모 / 사진 / 참고 글 / 조사 / 매장 기본
2. 순서: 차종·색·차체 → 의뢰 범위와 제품·농도 → 이 차에서 실제 한 작업 단계(사진·메모에서) → 이 차종 구조 중 이 작업과 관련된 것(조사, 1~3줄) → 제품 설명(팩트 표·참고 글에 있는 것만) → 관리 안내 → 맡겨야 하는 이유 2~3줄
3. 사진: 요청 범위 안의 작업 단계만 사실로 쓴다(예: "앞유리 상단에서 물을 아래로 밀어냄"). 도구·테이프·천의 색이나 상표, 사람 모습은 쓰지 않는다. 요청 범위에 없는 작업이 보이면(실내 PPF, 루프·스포일러 필름, 선루프 썬팅, 신차검수, 탈거 등) 사실표가 아니라 "확인 필요"에 "사진에 ~ 장면이 있음, 요청에는 없음"으로
4. 조사: "확인 안 됨"으로 적힌 구조는 넣지 않는다. 구조 중 이 작업 부위에 걸리는 것만
5. 참고 글: 같은 제품·같은 시공의 제품 설명·관리 안내·판단은 가져와도 된다(출처 '참고 글'). 그 글의 차에서 한 작업을 이 차에서 한 것으로 옮기지 않는다
6. 모르는 것은 쓰지 않는다: 제품 스펙(수치·소재·겹수)은 팩트 표나 참고 글에 있을 때만, 차체 형상(각이 가파르다 등)은 조사에서 확인됐을 때만, 고객 사정·작업 시간·"까다로웠다"는 요청·메모에 있을 때만
7. 요청에 "~는 안 함/없음/제외"라고 적힌 것은 사실표에도 확인 필요에도 넣지 않는다
8. '매장 기본' 줄은 [맡겨야 하는 이유 후보]와 [제품·시공 팩트]의 문구 그대로만 쓴다. 거기 없는 표현(예: "3M 공식 시공점", "인증 매장", 보증 기간 숫자)은 만들지 않는다

## 출력 (JSON 하나)
{"lines":[{"text":"...","source":"요청"}, ...], "unsure":["..."]}`;
}

function parse(raw: string): { lines: FactLine[]; unsure: string[] } {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`사실표 JSON 없음 (응답 ${raw.length}자: ${raw.slice(0, 160).replace(/\s+/g, ' ')} … ${raw.slice(-120).replace(/\s+/g, ' ')})`);
  const j = JSON.parse(m[0]) as { lines?: unknown; unsure?: unknown };
  const seen = new Set<string>();
  const lines: FactLine[] = [];
  for (const x of Array.isArray(j.lines) ? j.lines : []) {
    const o = x as { text?: unknown; source?: unknown };
    const text = String(o.text || '').trim();
    const source = (FACT_SOURCES as string[]).includes(String(o.source)) ? (String(o.source) as FactSource) : '조사';
    if (!text || seen.has(text)) continue;
    seen.add(text);
    lines.push({ text, source });
    if (lines.length >= 18) break;
  }
  const unsure = (Array.isArray(j.unsure) ? j.unsure : []).map(x => String(x).trim()).filter(Boolean).slice(0, 8);
  if (lines.length < 3) throw new Error('사실표가 너무 짧음');
  return { lines, unsure };
}

export async function buildFactSheet(input: { message: string; request: BlogRequest | null; researchContext: string; serviceType: string; carModel: string | null; refs?: ReferencePost[] }): Promise<FactSheet> {
  const raw = await callClaude(SYSTEM, [{ role: 'user', content: buildPrompt(input) }], 6000, FACTS_MODEL);
  const { lines, unsure } = parse(raw);
  return { lines, unsure, built_at: new Date().toISOString(), confirmed_at: null };
}

/** 사장님이 고친 줄 목록으로 확정. 출처 없는 줄(사장님이 새로 적은 것)은 '사장님 메모' */
export type FactLineInput = string | { text: string; source?: string };
export function confirmFactSheet(prev: FactSheet | null, lines: FactLineInput[]): FactSheet {
  const norm: FactLine[] = lines
    .map(l => (typeof l === 'string' ? { text: l.trim(), source: '사장님 메모' as FactSource } : { text: String(l.text || '').trim(), source: (FACT_SOURCES as string[]).includes(String(l.source)) ? (l.source as FactSource) : ('사장님 메모' as FactSource) }))
    .filter(l => l.text);
  const before = (prev?.lines || []).map(l => l.text).join('\n');
  return { lines: norm, unsure: prev?.unsure || [], built_at: prev?.built_at || new Date().toISOString(), confirmed_at: new Date().toISOString(), edited: before !== norm.map(l => l.text).join('\n') };
}

/** 글 쓰는 프롬프트에 붙이는 블록 */
export function factsToPrompt(f: FactSheet): string {
  return `\n\n[이 작업의 사실표 — 글의 사실은 이 표가 전부다. 표에 없는 사실은 한 줄도 쓰지 않는다. 표의 각 줄은 적어도 한 번 다룬다. 출처가 '매장 기본'인 줄은 선언이 아니라 작업 설명 안에서]\n${f.lines.map((l, i) => `${i + 1}. ${l.text} (${l.source})`).join('\n')}`;
}

/** 화면·푸시용 */
export function factsToText(f: FactSheet): string {
  return f.lines.map((l, i) => `${i + 1}. ${l.text}`).join('\n') + (f.unsure.length ? `\n\n확인 필요(글에 안 씀):\n${f.unsure.map(u => `- ${u}`).join('\n')}` : '');
}

/** 본문에 사실표 밖 숫자·제품명이 있는지 (검수 표시용, 고치지 않는다) */
export function factsNovelty(body: string, f: FactSheet, requestText: string): string[] {
  const known = `${f.lines.map(l => l.text).join('\n')}\n${requestText}\n${BUSINESS_CONTEXT}`.replace(/\s+/g, '');
  const out: string[] = [];
  const tokens = new Set<string>();
  for (const m of body.matchAll(/\d+(?:\.\d+)?\s*(?:%|μm|mm|겹|인치|년|개월|일간|시간|박\s*\d+일)/g)) tokens.add(m[0].replace(/\s+/g, ''));
  for (const m of body.matchAll(/시리즈\s*\d+|PRO\s*200|크리스탈라인|버텍스\s*\d*|레인보우|IS\s*\d+|2080|PWF|산타나|로데|글라스틴트|루마|3M\s*[A-Z]+\s*\d+/gi)) tokens.add(m[0].replace(/\s+/g, ''));
  for (const t of tokens) {
    if (!known.includes(t) && !known.toLowerCase().includes(t.toLowerCase())) out.push(t);
  }
  return out.slice(0, 8);
}
