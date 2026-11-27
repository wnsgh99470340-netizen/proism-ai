// 드라이브 작업 사진 폴더 ↔ 차량 자동 연결 (2026-11-27)
import { describe, it, expect } from 'vitest';
import { parseFolderName, matchFolder, driveSyncFactLines, filterAskedFolders, type SyncCustomer, type SyncVehicle, type SyncRecord } from '@/lib/drive-sync';

describe('폴더 이름 읽기 (parseFolderName)', () => {
  it('YYMMDD 차종 작업', () => {
    const p = parseFolderName('260409 7시리즈 전체 ppf', 2026);
    expect(p.date).toBe('2026-04-09'); expect(p.carTokens).toContain('7시리즈'); expect(p.nameToken).toBeUndefined(); expect(p.internal).toBe(false);
  });
  it('MMDD 는 올해', () => {
    const p = parseFolderName('1002 gv70 신차패키지', 2026);
    expect(p.date).toBe('2026-10-02'); expect(p.carTokens).toEqual(['gv70']);
  });
  it('김실장·류대표 폴더는 내부', () => {
    expect(parseFolderName('260325 김실장님 테슬라 모델3 썬팅', 2026).internal).toBe(true);
    expect(parseFolderName('261101 류대표 포르쉐 카이엔', 2026).internal).toBe(true);
  });
  it('성함이 있으면 nameToken, 차종 토큰에는 안 섞임', () => {
    const p = parseFolderName('261210 BMW X5 김철민 전체 PPF', 2026);
    expect(p.nameToken).toBe('김철민'); expect(p.carTokens).toEqual(['x5']); expect(p.date).toBe('2026-12-10');
  });
  it('작업·차종 한글 낱말은 성함으로 안 봄', () => {
    expect(parseFolderName('261120 포르쉐 마칸 전체 랩핑', 2026).nameToken).toBeUndefined();
    expect(parseFolderName('261120 기아 ev3 신차 유리막 도어', 2026).nameToken).toBeUndefined();
  });
  it('날짜 없는 폴더·잘못된 날짜', () => {
    expect(parseFolderName('테슬라 모델y 썬팅', 2026).date).toBeNull();
    expect(parseFolderName('261345 x5 ppf', 2026).date).toBeNull();
  });
});

const customers: SyncCustomer[] = [
  { id: 'c1', name: '김수희', car_brand: '기아', car_model: 'EV3' },
  { id: 'c2', name: '홍길동', car_brand: 'BMW', car_model: 'X5' },
  { id: 'c3', name: '김철민', car_brand: 'BMW', car_model: 'X5' },
  { id: 'd1', name: '딜러 팀장', car_brand: 'BMW', car_model: 'X5', kind: '딜러' },
];
const vehicles: SyncVehicle[] = [
  { id: 'v1', customer_id: 'c1', brand: '기아', model: 'EV3', is_primary: true },
  { id: 'v2', customer_id: 'c2', brand: 'BMW', model: 'X5', is_primary: true },
  { id: 'v3', customer_id: 'c3', brand: 'BMW', model: 'X5', is_primary: true },
  { id: 'vd', customer_id: 'd1', brand: 'BMW', model: 'X5', is_primary: true },
];
const records: SyncRecord[] = [
  { kind: '시공', customer_id: 'c1', vehicle_id: 'v1', start: '2026-11-13', end: '2026-11-13', type: '신차패키지' },
  { kind: '예약', customer_id: 'c2', vehicle_id: 'v2', start: '2026-12-09', end: '2026-12-12', type: 'PPF' },
  { kind: '예약', customer_id: 'c3', vehicle_id: 'v3', start: '2026-12-10', end: '2026-12-13', type: 'PPF' },
  { kind: '예약', customer_id: 'd1', vehicle_id: 'vd', start: '2026-12-10', end: '2026-12-10', type: 'PPF' },
];
const data = { customers, vehicles, records };

describe('폴더 ↔ 차량 맞추기 (matchFolder)', () => {
  it('날짜 ±4일 + 차종 하나면 확실', () => {
    const r = matchFolder({ name: '261110 ev3 신차패키지', year: 2026 }, data);
    expect(r.status).toBe('확실'); expect(r.candidates[0].vehicle_id).toBe('v1');
  });
  it('날짜가 멀면 없음', () => {
    expect(matchFolder({ name: '261020 ev3 신차패키지', year: 2026 }, data).status).toBe('없음');
  });
  it('같은 차종 둘이면 후보(딜러는 빠짐)', () => {
    const r = matchFolder({ name: '261210 x5 전체 ppf', year: 2026 }, data);
    expect(r.status).toBe('후보'); expect(r.candidates.map((c) => c.customer_id).sort()).toEqual(['c2', 'c3']);
  });
  it('성함이 있으면 그 이름만 확실, 다르면 탈락', () => {
    const r = matchFolder({ name: '261210 BMW X5 김철민 전체 PPF', year: 2026 }, data);
    expect(r.status).toBe('확실'); expect(r.candidates[0].customer_id).toBe('c3');
    expect(matchFolder({ name: '261210 BMW X5 박영수 전체 PPF', year: 2026 }, data).status).toBe('없음');
  });
  it('내부 폴더는 없음', () => {
    expect(matchFolder({ name: '261110 김실장님 ev3', year: 2026 }, data).status).toBe('없음');
  });
});

describe('아침 브리핑 줄 (driveSyncFactLines)', () => {
  it('연결·못 맞춤이 없으면 아무 말 없음, 있으면 두 줄', () => {
    expect(driveSyncFactLines({ linked: [], ambiguous: [], unmatched: [], hasFolder: [], skipped: 3, months: [11, 10] })).toEqual([]);
    const l = driveSyncFactLines({ linked: [{ folder: '261110 ev3', folderId: 'x', customer: '김수희', car: '기아 EV3' }], ambiguous: [], unmatched: [{ folder: '261120 카이엔', folderId: 'y' }], hasFolder: [], skipped: 0, months: [11] });
    expect(l.join('\n')).toContain('자동 연결 1개'); expect(l.join('\n')).toContain('못 맞춘 폴더 1개'); expect(l.join('\n')).toContain('261120 카이엔');
  });
});

describe('각 폴더는 한 번만 묻기 (filterAskedFolders)', () => {
  it('물어본 폴더는 빼고, 처음 묻는 것만 newlyAsked', () => {
    const rep = { linked: [], hasFolder: [], skipped: 0, months: [11], ambiguous: [{ folder: 'a', folderId: 'A', candidates: ['x'] }], unmatched: [{ folder: 'b', folderId: 'B' }, { folder: 'c', folderId: 'C' }] };
    const { report, newlyAsked } = filterAskedFolders(rep, { B: '2026-11-27' });
    expect(report.unmatched.map((u) => u.folderId)).toEqual(['C']);
    expect(newlyAsked).toEqual(['A', 'C']);
    expect(driveSyncFactLines(filterAskedFolders(rep, { A: 'd', B: 'd', C: 'd' }).report)).toEqual([]);
  });
});
