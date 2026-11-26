import { describe, it, expect } from 'vitest';
import { liftPromiseApplies, reviewLinkFor, REVIEW_LINKS, LIFT_PROMISE_LINE } from '@/config/sms-templates';

describe('들뜸 1년 약속·후기 링크 (2026-11-26)', () => {
  it('PPF·컬러PPF·신차패키지에만 붙고 실내 PPF·랩핑·썬팅에는 안 붙는다', () => {
    expect(liftPromiseApplies('PPF')).toBe(true);
    expect(liftPromiseApplies('컬러PPF')).toBe(true);
    expect(liftPromiseApplies('신차패키지')).toBe(true);
    expect(liftPromiseApplies('PWF')).toBe(true);
    expect(liftPromiseApplies('실내PPF')).toBe(false);
    expect(liftPromiseApplies('랩핑')).toBe(false);
    expect(liftPromiseApplies('썬팅')).toBe(false);
    expect(liftPromiseApplies(null)).toBe(false);
    expect(LIFT_PROMISE_LINE).toContain('1년');
  });
  it('후기 링크는 차 브랜드로 고른다', () => {
    expect(reviewLinkFor('BMW X5')).toBe(REVIEW_LINKS.bmw);
    expect(reviewLinkFor('아우디 A5')).toBe(REVIEW_LINKS.audi);
    expect(reviewLinkFor('벤츠 E300')).toBe(REVIEW_LINKS.proism);
    expect(reviewLinkFor(null)).toBe(REVIEW_LINKS.proism);
  });
});
