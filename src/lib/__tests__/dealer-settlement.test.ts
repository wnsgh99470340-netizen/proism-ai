// 딜러 정산(미수) 표시 (2026-11-25)
import { describe, it, expect } from 'vitest';
import { parseSettlement, isSettled, withSettlement, summarizeSettlement, settleState, SETTLEMENT_START } from '@/lib/dealer-settlement';

describe('딜러 정산 (dealer-settlement)', () => {
  it('표시가 없으면 미수, 정산 날을 적으면 정산', () => {
    expect(parseSettlement(null)).toBeNull();
    expect(isSettled('{"maintenance_years":"5"}')).toBe(false);
    const m = withSettlement('{"maintenance_years":"5"}', { paid_at: '2026-11-25', amount: 500000 });
    expect(isSettled(m)).toBe(true);
    expect(JSON.parse(m).maintenance_years).toBe('5'); // 다른 값은 그대로
    expect(parseSettlement(m)).toEqual({ paid_at: '2026-11-25', amount: 500000 });
  });
  it('되돌리면 표시가 빠지고, 옛 글자 메모는 보존된다', () => {
    const m = withSettlement('타임트리 일정 가져옴', { paid_at: '2026-11-25' });
    expect(JSON.parse(m).legacy_memo).toBe('타임트리 일정 가져옴');
    const back = withSettlement(m, null);
    expect(isSettled(back)).toBe(false);
    expect(JSON.parse(back).legacy_memo).toBe('타임트리 일정 가져옴');
  });
  it('미수 합계는 금액 있는 미정산 건만, 금액 없는 건은 따로 센다', () => {
    const sum = summarizeSettlement([
      { id: '1', service_date: '2026-11-01', service_type: 'PPF', amount: 5500000, memo: null },
      { id: '2', service_date: '2026-11-05', service_type: '랩핑', amount: 3000000, memo: withSettlement(null, { paid_at: '2026-11-20' }) },
      { id: '3', service_date: '2026-12-10', service_type: '썬팅', amount: null, memo: null },
      { id: '4', service_date: '2026-11-12', service_type: 'PPF', amount: 1000000, memo: withSettlement(null, { paid_at: '2026-11-22', amount: 900000 }) },
      { id: '5', service_date: '2026-12-01', service_type: 'PPF', amount: 2000000, memo: null },
    ]);
    // 1번은 시작일(2026-11-25) 이전이라 미수로 안 셈(legacy), 5번만 미수. 4번은 옛 기록이지만 정산을 직접 적었으니 정산으로
    expect(sum).toEqual({ unpaidCount: 1, unpaidTotal: 2000000, paidCount: 2, paidTotal: 3900000, unknownCount: 1, legacyCount: 1 });
  });
  it('시작일 이전 기록은 표시가 없으면 체크 대상이 아니고, 이후 기록은 미수', () => {
    expect(SETTLEMENT_START).toBe('2026-11-25');
    expect(settleState({ service_date: '2026-11-24', amount: 500000, memo: null })).toBe('legacy');
    expect(settleState({ service_date: '2026-11-25', amount: 500000, memo: null })).toBe('unpaid');
    expect(settleState({ service_date: '2026-11-25', amount: null, memo: null })).toBe('unknown');
    expect(settleState({ service_date: '2026-11-24', amount: 500000, memo: withSettlement(null, { paid_at: '2026-11-25' }) })).toBe('paid');
  });
});
