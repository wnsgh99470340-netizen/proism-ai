// 작업 내역서 PPF 제품 선택 칸 (2026-11-25 사장님 "제품은 적는 방식 말고 선택하는 방식으로")
import { describe, it, expect } from 'vitest';
import { workItems, ppfProductOf, PPF_PRODUCT_OPTIONS } from '@/lib/work-order';

describe('PPF 제품 선택 (work-order)', () => {
  it('선택 칸이 있으면 그걸로, 기타는 메모로 범위 뒤에 붙는다', () => {
    const items = workItems({ ppf: ['전체PPF'], ppf_product: '시리즈50', ppf_etc: '본넷 두 명이 함께' });
    expect(items[0].product).toBe('3M PPF 시리즈50 · 185μm · 셀프힐링 · 고광택');
    expect(items[0].text).toContain('본넷 두 명이 함께');
  });
  it('옛 기록: 선택 칸 없고 기타에 제품명이 있으면 예전처럼 제품으로 읽는다', () => {
    const items = workItems({ ppf: ['프론트패키지'], ppf_etc: 'PRO200 무광' });
    expect(items[0].product).toContain('PRO200 무광');
    expect(items[0].text).not.toContain('PRO200');
  });
  it('선택지 다섯 개가 전부 스펙 줄로 바뀐다', () => {
    for (const p of PPF_PRODUCT_OPTIONS) expect(ppfProductOf({ ppf_product: p })).toMatch(/^3M PPF /);
    expect(ppfProductOf({ ppf_product: 'PRO200 유광' })).toContain('유광');
    expect(ppfProductOf({})).toBeNull();
  });
});
