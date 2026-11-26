/**
 * 사장님 블로그 모양으로 본문 다듬기 (2026-11-26 발행본 대조: 사장님이 세 글 연속 손으로 전부 다시 끊었음)
 *  - formatMobileLines: 문장 글을 한 줄 10~18자, 마침표 없이 끊는다. 이미 짧게 끊긴 글은 건드리지 않는다
 *  - ensureEnding: 전화 줄·해시태그·서명 줄을 빼고, 끝을 "궁금할 땐 네이버 톡톡하세요! / 3M프로이즘 강남서초점 / 주소" 로 맞춘다
 * 순수 함수. 시험 src/lib/__tests__/mobile-lines.test.ts
 */
export const MAX_LINE = 18;
export const TALK_LINE = '궁금할 땐 네이버 톡톡하세요!';
export const SHOP_LINE = '3M프로이즘 강남서초점';
export const ADDRESS_LINE = '서울특별시 서초구 서초중앙로8길 82 1동 1층 1호';

const KEEP_RE = /^#|^\[|서초중앙로|톡톡하세요|^3M\s?프로이즘 강남서초점$/;

/** 문장 하나를 10~18자 줄로. 띄어쓰기 자리에서만 끊고, 끝 마침표는 뗀다 */
export function wrapSentence(sentence: string, max = MAX_LINE): string[] {
  const s = sentence.trim().replace(/[.。]+$/, '').trim();
  if (!s) return [];
  if (s.length <= max) return [s];
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= max || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  // 끝에 서너 글자짜리 토막이 남으면 앞 줄에 붙인다 (22자까지 허용)
  if (lines.length >= 2) {
    const last = lines[lines.length - 1];
    if (last.length <= 4 && (lines[lines.length - 2].length + 1 + last.length) <= max + 4) {
      lines[lines.length - 2] = `${lines[lines.length - 2]} ${last}`;
      lines.pop();
    }
  }
  return lines;
}

/** 글이 문장형(한 줄이 길고 마침표로 끝남)인지 — 이미 끊긴 글은 다시 끊지 않는다 */
export function looksLikeProse(body: string): boolean {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const avg = lines.reduce((a, l) => a + l.length, 0) / lines.length;
  const withPeriod = lines.filter((l) => /[.。]\s*$/.test(l)).length;
  return avg > 24 || withPeriod > lines.length * 0.4;
}

export function formatMobileLines(body: string, max = MAX_LINE): string {
  if (!looksLikeProse(body)) return body.replace(/[.。]\s*$/gm, '');
  const paras = body.replace(/\r/g, '').split(/\n\s*\n/);
  const out: string[] = [];
  for (const para of paras) {
    const lines: string[] = [];
    for (const raw of para.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (KEEP_RE.test(line)) { lines.push(line); continue; }
      // 문장 단위로 나눈 뒤 각 문장을 줄로
      const sentences = line.split(/(?<=[.!?。])\s+/).map((x) => x.trim()).filter(Boolean);
      for (const sent of sentences) lines.push(...wrapSentence(sent, max));
    }
    if (lines.length) out.push(lines.join('\n'));
  }
  return out.join('\n\n');
}

/** 끝맺음을 사장님 방식으로: 전화·해시태그·서명 줄 제거, 톡톡 → 상호 → 주소 */
export function ensureEnding(body: string): string {
  const lines = body.replace(/\r/g, '').split('\n');
  // 어디에 있든 빼는 줄: 해시태그·전화·서명·주소
  const kept = lines.filter((l) => {
    const t = l.trim();
    if (/^#\S/.test(t)) return false;
    if (/010-?7287-?7140/.test(t)) return false;
    if (/^3M\s*프리퍼드\s*인스톨러$/.test(t)) return false;
    if (/^3M\s*프로이즘\s*강남서초점\s*대표\s*진준호$/.test(t)) return false;
    if (/서초중앙로/.test(t)) return false;
    return true;
  });
  // "[재료 필요] …" 같은 안내 줄은 본문에서 떼어 맨 끝(주소 뒤)으로 — 모델이 끝맺음 뒤에 붙이면 끝이 두 번 생겼음 (2026-11-26 첫 시험 글)
  const notes = kept.filter((l) => /^\[[^\]]{1,12}\]/.test(l.trim()));
  const main = kept.filter((l) => !/^\[[^\]]{1,12}\]/.test(l.trim()));
  // 끝에 몰려 있는 톡톡·상호·빈 줄은 걷어내고(인사 네 줄의 것은 끝이 아니라 남음) 다시 붙인다
  const tail = /^(?:궁금할 땐 네이버 톡톡하세요!?|3M\s*프로이즘\s*강남서초점\s*\/?|)$/;
  while (main.length && tail.test(main[main.length - 1].trim())) main.pop();
  const text = main.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return `${text}\n\n${TALK_LINE}\n${SHOP_LINE}\n${ADDRESS_LINE}${notes.length ? `\n\n${notes.map((n) => n.trim()).join('\n')}` : ''}`;
}

/** 생성·수정 결과에 한 번에 적용 */
export function toOwnerShape(body: string): string {
  return ensureEnding(formatMobileLines(body));
}
