// 회원 등록 표시 (2026-11-26)
import { describe, it, expect } from 'vitest';
import { isMemberFlag, memberSinceFlag, withMemberFlag, stripMemberFlag } from '@/lib/membership-flag';

describe('회원 표시 토큰 (membership-flag)', () => {
  it('붙이고 읽고 떼기', () => {
    const memo = withMemberFlag('소개: 홍길동 [ref:abc]\n[블랙리스트 2026-11-22: 사유]', '2026-11-26');
    expect(isMemberFlag(memo)).toBe(true);
    expect(memberSinceFlag(memo)).toBe('2026-11-26');
    expect(memo.endsWith('[회원 2026-11-26]')).toBe(true);
    expect(stripMemberFlag(memo)).toBe('소개: 홍길동 [ref:abc]\n[블랙리스트 2026-11-22: 사유]');
    expect(isMemberFlag(null)).toBe(false);
    expect(withMemberFlag(memo, '2026-12-01')).toMatch(/\[회원 2026-12-01\]$/); // 두 번 붙지 않음
    expect((withMemberFlag(memo, '2026-12-01').match(/\[회원/g) || []).length).toBe(1);
  });
});
