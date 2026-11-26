// 사장님 블로그 모양 (2026-11-26)
import { describe, it, expect } from 'vitest';
import { wrapSentence, formatMobileLines, ensureEnding, looksLikeProse, TALK_LINE, SHOP_LINE, ADDRESS_LINE } from '@/lib/mobile-lines';

describe('모바일 줄바꿈 (mobile-lines)', () => {
  it('문장을 18자 안으로 띄어쓰기에서 끊고 마침표를 뗀다', () => {
    const lines = wrapSentence('썬팅은 필름마다 열차단이 다르고 가격도 다르다는 걸 고객님들이 이미 다 알고 오십니다.');
    expect(lines.every((l) => l.length <= 18)).toBe(true);
    expect(lines.join(' ')).toBe('썬팅은 필름마다 열차단이 다르고 가격도 다르다는 걸 고객님들이 이미 다 알고 오십니다');
    expect(wrapSentence('짧은 줄.')).toEqual(['짧은 줄']);
  });
  it('문장형 글만 다시 끊고, 이미 끊긴 글은 마침표만 뗀다', () => {
    const prose = '안녕하세요. 3M 프로이즘 강남서초점 대표 진준호입니다.\n\nPPF는 한 번 붙이면 기본 5년 이상 붙인 상태로 타시는 물건입니다. 그래서 좋은 필름은 떼는 날에도 도장을 건드리지 않는 필름입니다.';
    expect(looksLikeProse(prose)).toBe(true);
    const out = formatMobileLines(prose);
    expect(out.split('\n').every((l) => l.length <= 18)).toBe(true);
    expect(out).not.toMatch(/\.\s*$/m);
    expect(out.split('\n\n').length).toBe(2);
    const short = '안녕하세요\n3M 프로이즘 강남서초점\n대표 진준호입니다.';
    expect(looksLikeProse(short)).toBe(false);
    expect(formatMobileLines(short)).toBe('안녕하세요\n3M 프로이즘 강남서초점\n대표 진준호입니다');
  });
  it('끝맺음: 전화·해시태그·서명 줄을 빼고 톡톡 → 상호 → 주소', () => {
    const body = '본문 한 줄\n\n문의는 010-7287-7140으로 주시면 됩니다.\n\n3M 프리퍼드 인스톨러\n3M 프로이즘 강남서초점 대표 진준호\n\n#서초PPF #3MPPF\n\n3M 프로이즘 강남서초점 / 서울 서초구 서초중앙로8길 82 1동 1층 1호';
    const out = ensureEnding(body);
    expect(out).toBe(`본문 한 줄\n\n${TALK_LINE}\n${SHOP_LINE}\n${ADDRESS_LINE}`);
    // 이미 맞는 끝은 그대로(두 번 안 붙음)
    expect(ensureEnding(out)).toBe(out);
  });
});
