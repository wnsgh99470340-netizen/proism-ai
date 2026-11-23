// 연락처 저장용 vCard (2026-11-23)
import { describe, it, expect } from 'vitest';
import { buildVCard, buildVCards } from '@/lib/vcard';

describe('vCard', () => {
  it('이름 뒤에 차종, 회사 칸 프로이즘 고객, 전화는 숫자만', () => {
    const v = buildVCard({ name: '김수희', phone: '010-5165-8780', tag: '기아 EV3', note: '유입경로 기타' })!;
    expect(v).toContain('FN:김수희 기아 EV3');
    expect(v).toContain('N:김수희;;;;');
    expect(v).toContain('ORG:프로이즘 고객');
    expect(v).toContain('TEL;TYPE=CELL:01051658780');
    expect(v).toContain('NOTE:유입경로 기타');
    expect(v.startsWith('BEGIN:VCARD\r\nVERSION:3.0')).toBe(true);
    expect(v.endsWith('END:VCARD\r\n')).toBe(true);
  });
  it('쉼표·세미콜론·줄바꿈은 이스케이프, 전화 없으면 빠진다', () => {
    expect(buildVCard({ name: '홍길동', phone: '010-1111-2222', tag: 'BMW X5, M', note: 'a;b\nc' })).toContain('FN:홍길동 BMW X5\\, M');
    expect(buildVCard({ name: '홍길동', phone: '010-1111-2222', note: 'a;b\nc' })).toContain('NOTE:a\;b\\nc');
    expect(buildVCard({ name: '전화없음', phone: null })).toBeNull();
    const all = buildVCards([{ name: 'a', phone: '010-1111-2222' }, { name: 'b', phone: '' }, { name: 'c', phone: '010-3333-4444', org: '딜러' }]);
    expect(all.count).toBe(2);
    expect(all.text.match(/BEGIN:VCARD/g)).toHaveLength(2);
    expect(all.text).toContain('ORG:딜러');
  });
});
