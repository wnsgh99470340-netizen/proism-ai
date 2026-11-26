// 받은 알림 기록 (2026-11-26)
import { describe, it, expect } from 'vitest';
import { groupPushLog, seoulDate, seoulTime } from '@/lib/push-log';

describe('받은 알림 묶기 (push-log)', () => {
  it('서울 날짜로 묶고 시각은 HH:MM', () => {
    const g = groupPushLog([
      { at: '2026-11-25T22:00:00.000Z', title: '☀️ 브리핑', body: 'a' },   // 11/26 07:00 KST
      { at: '2026-11-25T14:59:00.000Z', title: '📝 사실표', body: 'b' },   // 11/25 23:59 KST
      { at: '2026-11-25T01:00:00.000Z', title: '📚', body: 'c' },          // 11/25 10:00
    ]);
    expect(g.map((x) => [x.date, x.items.length])).toEqual([['2026-11-26', 1], ['2026-11-25', 2]]);
    expect(seoulDate('2026-11-25T22:00:00.000Z')).toBe('2026-11-26');
    expect(seoulTime('2026-11-25T22:00:00.000Z')).toBe('07:00');
  });
});
