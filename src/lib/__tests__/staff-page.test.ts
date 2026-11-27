// 직원용 예약 페이지 (2026-11-27): 범위·취소 제외·민감 필드 없음
import { describe, it, expect } from 'vitest';
import { pickSpread } from '@/lib/drive';
import { PUBLIC_VEHICLE_COLS, publicVehicle, isDriveFolderLink, applyUsedIds } from '@/lib/vehicles';
import { staffVisibleRange, staffCars, toStaffCar, staffNote, staffWork, STAFF_CAR_KEYS, staffToken } from '@/lib/staff-page';

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
  it('응답 키는 고정된 목록뿐 (phone·amount·dealer·email 없음)', () => {
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

describe('직원 페이지 — 작업 내역 줄', () => {
  const wo = JSON.stringify({
    ppf: ['전체 PPF'], ppf_product: '시리즈50', other_work: '윈드쉴드', car_number: '12가3456',
    tinting: { '크리스탈라인': { selected: ['전면'], density: '35%' } },
    amount: '5500000', warranty: { phone: '010-1234-5678', price: '550만원' }, field_note: '휀다 끝단 확인',
  });
  it('작업 내역서 JSON 이면 작업 줄 + 차량번호, 현장 메모는 note', () => {
    const c = toStaffCar(row({ memo: wo }));
    expect(c.work.length).toBeGreaterThan(0);
    expect(c.work.join('\n')).toContain('PPF');
    expect(c.work.join('\n')).toContain('윈드쉴드');
    expect(c.plate).toBe('12가3456');
    expect(c.note).toBe('휀다 끝단 확인');
  });
  it('작업 줄에 금액·전화가 없다', () => {
    for (const line of staffWork(wo)) {
      expect(line).not.toMatch(/만|원/);
      expect(line).not.toMatch(/\d{7,}/);
      expect(line).not.toMatch(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/);
    }
    expect(JSON.stringify(toStaffCar(row({ memo: wo })))).not.toMatch(/5500000|550만|010-1234/);
  });
  it('작업 내역서가 없으면 work 는 빈 배열 (글자 메모를 작업 줄로 옮기지 않음)', () => {
    expect(staffWork('홍길동 오전 입고 550만')).toEqual([]);
    expect(staffWork(null)).toEqual([]);
    expect(toStaffCar(row({ memo: '오전 입고' })).plate).toBeNull();
  });
});

describe('직원 페이지 — 작업 리스트 시트', () => {
  it('작업 내역서가 있으면 sheet, 전화·금액·사진·보증서 키 없음', () => {
    const memo = JSON.stringify({ ppf: ['전체PPF'], ppf_etc: '50시리즈', car_number: '12가3456', amount: 5500000, photos: ['https://x/y.jpg'], warranty: { phone: '010-1234-5678', price: '550만원' }, notes: '잔금 30만원 고객 010-9999-8888', tinting: { vertex: { selected: ['900(비반사)'], density: '전면30 측후면 15' } } });
    const c = toStaffCar(row({ memo, customer: { name: '홍길동', phone: '010-7777-6666', car_brand: 'BMW', car_model: 'X5', source: '블로그' } }));
    expect(c.sheet).not.toBeNull();
    expect(c.sheet!.head).toEqual({ date: '2026. 11. 27.', car: 'BMW X5', plate: '12가3456', name: '홍길동', source: '블로그', phone: '010-7777-6666' });
    // 전화는 sheet.head.phone 에만 — 그 밖의 필드에는 없음
    const rest = { ...c, sheet: { ...c.sheet!, head: { ...c.sheet!.head, phone: null } } };
    const raw = JSON.stringify(rest);
    for (const bad of ['amount', 'price', 'photos', 'warranty', '5500000', '550만', '30만', '7777']) expect(raw).not.toContain(bad);
    expect(raw).not.toMatch(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/);
    expect(raw).toContain('50시리즈'); expect(raw).toContain('전면30 측후면 15');
  });
  it('작업 내역서가 없으면 sheet 는 null', () => {
    expect(toStaffCar(row({ memo: '오전 입고' })).sheet).toBeNull();
  });
});

describe('직원 페이지 — 내부용 사진', () => {
  it('photos_internal 은 sheet 에도 응답 어디에도 없다', () => {
    const memo = JSON.stringify({ ppf: ['전체PPF'], car_number: '12가3456', photos: ['https://x/out.jpg'], photos_internal: ['https://x/damage.jpg'] });
    const raw = JSON.stringify(toStaffCar(row({ memo })));
    expect(raw).not.toContain('photos_internal'); expect(raw).not.toContain('damage.jpg'); expect(raw).not.toContain('out.jpg');
  });
});

describe('차량 사진·드라이브 폴더(내부용)는 공개 응답에 없다 (2026-11-27)', () => {
  it('공개 페이지가 읽는 vehicles 열에 photos 가 없고, 변환도 사진을 뗀다', () => {
    expect(PUBLIC_VEHICLE_COLS).not.toMatch(/photos|drive_folder|drive_used_ids|\*/);
    const v = publicVehicle({ id: 'v1', customer_id: 'c1', brand: 'BMW', model: 'X5', plate: '12가3456', photos: ['https://x/damage.jpg'], drive_folder: 'https://drive.google.com/drive/folders/abcdefghijkl', drive_used_ids: ['usedfile123456'], memo: '내부', is_primary: true });
    expect(v).toEqual({ brand: 'BMW', model: 'X5', plate: '12가3456' });
    expect(JSON.stringify(v)).not.toContain('damage');
    expect(JSON.stringify(v)).not.toContain('drive');
    expect(JSON.stringify(v)).not.toContain('usedfile');
    // 직원 페이지 변환도 차량 사진을 옮기지 않는다
    const c = toStaffCar(row({ vehicle: { brand: 'BMW', model: 'X5', photos: ['https://x/damage.jpg'], drive_folder: 'https://drive.google.com/drive/folders/abcdefghijkl' } as never }));
    expect(JSON.stringify(c)).not.toContain('damage');
    expect(JSON.stringify(c)).not.toContain('drive.google');
  });
});

describe('차량 드라이브 폴더 링크 (2026-11-27)', () => {
  it('드라이브 폴더 링크만 받는다', () => {
    expect(isDriveFolderLink('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn?usp=sharing')).toBe(true);
    expect(isDriveFolderLink('https://drive.google.com/open?id=1AbCdEfGhIjKlMn')).toBe(true);
    expect(isDriveFolderLink('https://example.com/drive/folders/1AbCdEfGhIjKlMn')).toBe(false);
    expect(isDriveFolderLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view')).toBe(false);
  });
});

describe('드라이브 사진 고르게 뽑기 (2026-11-27)', () => {
  it('첫·마지막 포함 등간격, n 이하면 전부', () => {
    const xs = Array.from({ length: 50 }, (_, i) => i);
    const p = pickSpread(xs, 8);
    expect(p.length).toBe(8); expect(p[0]).toBe(0); expect(p[7]).toBe(49);
    expect(new Set(p).size).toBe(8);
    expect(pickSpread([1, 2, 3], 8)).toEqual([1, 2, 3]);
  });
});

describe("드라이브 '후기에 사용함' 표시 (2026-11-27)", () => {
  it('넣기는 중복 없이 뒤에, 빼기는 그 id 만', () => {
    expect(applyUsedIds(['a', 'b'], ['b', 'c', 'c'], true)).toEqual(['a', 'b', 'c']);
    expect(applyUsedIds(['a', 'b', 'c'], ['b'], false)).toEqual(['a', 'c']);
    expect(applyUsedIds(null, ['x'], true)).toEqual(['x']);
  });
});
