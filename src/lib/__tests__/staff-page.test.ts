// 직원용 예약 페이지 (2026-11-27): 범위·취소 제외·민감 필드 없음
import { describe, it, expect } from 'vitest';
import { staffVisibleRange, staffCars, toStaffCar, staffNote, STAFF_CAR_KEYS, staffToken } from '@/lib/staff-page';

const today = '2026-11-27';
const row = (o: Record<string, unknown>) => ({ id: 'a1', appointment_date: today, end_date: null, service_type: 'PPF', status: '예약확정', memo: null, customer: { name: '홍길동', car_brand: 'BMW', car_model: 'X5' }, ...o });

describe('직원 페이지 — 범위', () => {
  it('오늘 -14일 ~ +60일', () => {
    expect(staffVisibleRange(today)).toEqual({ from: '2026-11-13', to: '2027-01-26' });
  });
  it('범위 밖은 빠지고, 시작이 범위 전이어도 끝이 범위 안이면 남는다', () => {
    const cars = staffCars([
      row({ id: 'old', appointment_date: '2026-10-01', end_date: '2026-10-03' }),
      row({ id: 'far', appointment_date: '2027-02-10' }),
      row({ id: 'long', appointment_date: '2026-11-10', end_date: '2026-11-14' }),
      row({ id: 'in', appointment_date: '2026-12-01' }),
    ], today);
    expect(cars.map((c) => c.id)).toEqual(['long', 'in']);
  });
});

describe('직원 페이지 — 취소 제외', () => {
  it('취소된 예약은 안 보인다', () => {
    expect(staffCars([row({ id: 'x', status: '취소' }), row({ id: 'y' })], today).map((c) => c.id)).toEqual(['y']);
  });
});

describe('직원 페이지 — 민감 필드 없음', () => {
  it('응답 키는 고정된 8개뿐 (phone·amount·dealer·email 없음)', () => {
    const c = toStaffCar(row({ amount: 5500000, phone: '010-1234-5678', customer: { name: '홍길동', phone: '010-1234-5678', email: 'a@b.c', car_brand: 'BMW', car_model: 'X5', dealer_id: 'd1' } as never }));
    expect(Object.keys(c).sort()).toEqual([...STAFF_CAR_KEYS].sort());
    const s = JSON.stringify(c);
    for (const bad of ['phone', 'amount', 'dealer', 'email', '010-1234-5678', '5500000']) expect(s).not.toContain(bad);
    expect(c.car).toBe('BMW X5');
  });
  it('메모: JSON 이면 field_note·notes 만, 글자면 앞 120자 + 전화번호 가림', () => {
    expect(staffNote(JSON.stringify({ field_note: '휀다 들뜸 확인', notes: '본넷 먼지', amount: 300, warranty: { phone: '010-1111-2222' } }))).toBe('휀다 들뜸 확인\n본넷 먼지');
    expect(staffNote(JSON.stringify({ amount: 300 }))).toBeNull();
    expect(staffNote('홍길동 010-1234-5678 · X5 · 오전 입고')).not.toContain('010');
    expect((staffNote('가'.repeat(300)) || '').length).toBe(120);
    const money = staffNote('PPF 전체 550만 / 잔금 1,200,000원 / 루프 30만원 추가') || '';
    for (const bad of ['550', '1,200,000', '30만']) expect(money).not.toContain(bad);
  });
  it('차량 표 값이 있으면 그 차, 없으면 고객 칸 차종', () => {
    expect(toStaffCar(row({ vehicle: { brand: '포르쉐', model: '911' } })).car).toBe('포르쉐 911');
    expect(toStaffCar(row({ vehicle: null })).car).toBe('BMW X5');
  });
  it('토큰은 비밀번호에서 만든 24자, 비밀번호가 바뀌면 바뀐다', () => {
    const prev = process.env.CRM_PASSWORD;
    process.env.CRM_PASSWORD = 'a'; const t1 = staffToken();
    process.env.CRM_PASSWORD = 'b'; const t2 = staffToken();
    process.env.CRM_PASSWORD = prev;
    expect(t1).toMatch(/^[0-9a-f]{24}$/); expect(t1).not.toBe(t2);
  });
});
