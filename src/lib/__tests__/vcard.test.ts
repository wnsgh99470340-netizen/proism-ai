// 연락처 저장용 vCard (2026-11-23)
import { describe, it, expect } from 'vitest';
import { buildVCard, buildVCards, unsavedContacts, markContactsSaved, isContactSaved } from '@/lib/vcard';

describe('vCard', () => {
  it('이름 뒤에 차종, 회사 칸 프로이즘 고객, 전화는 숫자만', () => {
    const v = buildVCard({ name: '김수희', phone: '010-5165-8780', tag: '기아 EV3', note: '유입경로 기타' })!;
    expect(v).toContain('FN:김수희 기아 EV3');
    expect(v).toContain('N:김수희 기아 EV3;;;;'); // 삼성 연락처는 N 을 보여 준다
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
    const d = buildVCard({ name: '이규정 주임', phone: '010-9194-2660', prefix: 'BMW 잠실', org: 'BMW 잠실', title: '딜러' })!;
    expect(d).toContain('N:BMW 잠실 이규정 주임;;;;');
    expect(d).toContain('FN:BMW 잠실 이규정 주임');
    expect(d).toContain('ORG:BMW 잠실');
    expect(d).toContain('TITLE:딜러');
  });
  it('중복 저장 방지: 넘긴 사람은 다음에 빠지고, 번호가 바뀌면 다시 들어간다', () => {
    const list = [
      { id: 'a', name: '김수희', phone: '010-5165-8780' },
      { id: 'b', name: '홍길동', phone: '010-1111-2222' },
      { id: 'c', name: '전화없음', phone: '' },
    ];
    expect(unsavedContacts(list, {}).map((c) => c.id)).toEqual(['a', 'b']);
    const saved = markContactsSaved([list[0]], {});
    expect(saved).toEqual({ a: '01051658780' });
    expect(unsavedContacts(list, saved).map((c) => c.id)).toEqual(['b']);
    expect(unsavedContacts([{ id: 'a', name: '김수희', phone: '010-9999-0000' }], saved).map((c) => c.id)).toEqual(['a']);
    expect(isContactSaved('a', '010-5165-8780', saved)).toBe(true);
    expect(isContactSaved('b', '010-1111-2222', saved)).toBe(false);
    expect(buildVCard({ id: 'a', name: '김수희', phone: '010-5165-8780' })).toContain('UID:proism-a');
  });
});
