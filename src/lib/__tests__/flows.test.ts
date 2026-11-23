// 핵심 흐름 시험 (2026-11-23): 메모리 DB(src/test/fake-supabase.ts)로 "두 번 눌러도 한 번만", "반복이 이어지는가", "닫혀야 할 것이 닫히는가"를 본다. 실제 Supabase 에 붙지 않는다
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '@/test/fake-supabase';
import { todaySeoul, addDaysISO } from '@/lib/local-date';

const h = vi.hoisted(() => ({ fake: null as unknown as ReturnType<typeof import('@/test/fake-supabase').createFakeSupabase> }));
vi.mock('@/lib/supabase', () => ({ supabase: new Proxy({}, { get: (_t, p) => (h.fake as unknown as Record<string, unknown>)[p as string] }) }));
vi.mock('@/lib/referrals', () => ({ linkReferral: vi.fn(async () => null) }));

import { scheduleNextMaintenance, markFollowUpSkipped, closeQuoteFollowUpsFor, closeQuoteAs } from '@/lib/followups';
import { ensureArrivalNotice, resyncArrivalNotice, advanceAppointmentsForToday, linkOrphanRecordsByPhone } from '@/lib/appointments-flow';
import { createAutoFollowUps } from '@/lib/crm-shared';
import { logMemberSms } from '@/lib/member-links';
import { setBlacklist, cutCareForBlacklisted } from '@/lib/blacklist';
import { linkReferral } from '@/lib/referrals';

const today = todaySeoul();
const CUST = '66666666-6666-4666-8666-666666666666';
const SVC = '77777777-7777-4777-8777-777777777777';
const plus6m = (d: string) => { const x = new Date(d + 'T00:00:00+09:00'); x.setMonth(x.getMonth() + 6); return new Date(x.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10); };

beforeEach(() => { h.fake = createFakeSupabase({}); });

describe('메인터넌스 반복 (scheduleNextMaintenance)', () => {
  it('완료하면 같은 시공 기록에 6개월 뒤 다음 회차가 생긴다', async () => {
    h.fake = createFakeSupabase({ services: [{ id: SVC, service_type: 'PPF', service_date: '2026-05-10', memo: JSON.stringify({ maintenance_years: '5' }) }], follow_ups: [{ service_id: SVC, customer_id: CUST, follow_up_type: '메인터넌스', scheduled_date: '2026-11-10', is_completed: true }] });
    const next = await scheduleNextMaintenance({ service_id: SVC, customer_id: CUST, follow_up_type: '메인터넌스' }, today);
    expect(next).toBe(plus6m(today));
    const rows = h.fake.tables.follow_ups.filter((r) => r.follow_up_type === '메인터넌스');
    expect(rows).toHaveLength(2);
    expect(String(rows[1].memo)).toContain('2회차');
  });
  it('열린 메인터넌스가 이미 있으면 또 만들지 않는다', async () => {
    h.fake = createFakeSupabase({ services: [{ id: SVC, service_type: 'PPF', service_date: '2026-05-10', memo: null }], follow_ups: [{ service_id: SVC, customer_id: CUST, follow_up_type: '메인터넌스', scheduled_date: '2027-05-10', is_completed: false }] });
    expect(await scheduleNextMaintenance({ service_id: SVC, customer_id: CUST, follow_up_type: '메인터넌스' }, today)).toBeNull();
    expect(h.fake.tables.follow_ups).toHaveLength(1);
  });
  it('메인터넌스 기간(N년)을 넘기면 멈춘다', async () => {
    h.fake = createFakeSupabase({ services: [{ id: SVC, service_type: 'PPF', service_date: '2024-01-01', memo: JSON.stringify({ maintenance_years: '2' }) }], follow_ups: [] });
    expect(await scheduleNextMaintenance({ service_id: SVC, customer_id: CUST, follow_up_type: '메인터넌스' }, '2025-12-01')).toBeNull();
    expect(h.fake.tables.follow_ups).toHaveLength(0);
  });
  it('QC 나 리터치에는 다음 회차가 없다', async () => {
    expect(await scheduleNextMaintenance({ service_id: SVC, customer_id: CUST, follow_up_type: 'QC점검' }, today)).toBeNull();
  });
});

describe('미방문 정리 (markFollowUpSkipped)', () => {
  it('완료로 닫히되 memo 첫 줄에 미방문이 남고, 메인터넌스면 다음 회차는 그대로 잡힌다', async () => {
    h.fake = createFakeSupabase({ services: [{ id: SVC, service_type: 'PPF', service_date: '2026-05-10', memo: null }], follow_ups: [{ id: 'f1', service_id: SVC, customer_id: CUST, follow_up_type: '메인터넌스', scheduled_date: '2026-11-10', is_completed: false, memo: 'PPF 시공 완료 후 6개월 메인터넌스' }] });
    await markFollowUpSkipped({ id: 'f1', service_id: SVC, customer_id: CUST, follow_up_type: '메인터넌스', memo: 'PPF 시공 완료 후 6개월 메인터넌스' }, '전화 안 받음');
    const f1 = h.fake.tables.follow_ups.find((r) => r.id === 'f1')!;
    expect(f1.is_completed).toBe(true);
    expect(String(f1.memo)).toMatch(/^미방문 \d{4}-\d{2}-\d{2}: 전화 안 받음/);
    expect(h.fake.tables.follow_ups.filter((r) => r.follow_up_type === '메인터넌스' && !r.is_completed)).toHaveLength(1);
  });
});

describe('견적 재연락 닫기', () => {
  it('예약이 잡히면 고객 id 로도, 미등록이면 메모 첫 줄 전화로도 닫힌다', async () => {
    h.fake = createFakeSupabase({ follow_ups: [
      { customer_id: CUST, follow_up_type: '견적재연락', scheduled_date: today, is_completed: false, memo: '홍길동 010-1111-2222 · X5 PPF' },
      { customer_id: null, follow_up_type: '견적마무리', scheduled_date: today, is_completed: false, memo: '김철수 010-3333-4444 · 모델Y 썬팅\n문자 본문' },
      { customer_id: null, follow_up_type: '견적마무리', scheduled_date: today, is_completed: false, memo: '박영희 010-5555-6666 · A6' },
    ] });
    expect(await closeQuoteFollowUpsFor(CUST, null)).toBe(1);
    expect(await closeQuoteFollowUpsFor(null, '010-3333-4444')).toBe(1);
    const open = h.fake.tables.follow_ups.filter((r) => !r.is_completed);
    expect(open).toHaveLength(1);
    expect(String(open[0].memo)).toContain('박영희');
    expect(h.fake.tables.follow_ups.filter((r) => String(r.memo).includes('예약 잡혀 자동 정리'))).toHaveLength(2);
  });
  it('종결 사유를 고르면 같은 손님의 재연락·마무리 쌍이 함께 닫힌다', async () => {
    h.fake = createFakeSupabase({ follow_ups: [
      { id: 'q1', customer_id: null, follow_up_type: '견적재연락', scheduled_date: today, is_completed: false, memo: '김철수 010-3333-4444 · 모델Y\n문자' },
      { id: 'q2', customer_id: null, follow_up_type: '견적마무리', scheduled_date: today, is_completed: false, memo: '김철수 010-3333-4444 · 모델Y\n문자' },
      { id: 'q3', customer_id: null, follow_up_type: '견적마무리', scheduled_date: today, is_completed: false, memo: '박영희 010-5555-6666 · A6\n문자' },
    ] });
    expect(await closeQuoteAs({ id: 'q1', customer_id: null, memo: '김철수 010-3333-4444 · 모델Y\n문자' }, '다른 곳에서 함')).toBe(2);
    expect(h.fake.tables.follow_ups.filter((r) => r.is_completed).map((r) => r.id).sort()).toEqual(['q1', 'q2']);
    expect(String(h.fake.tables.follow_ups.find((r) => r.id === 'q2')!.memo)).toMatch(/^견적 종결 \d{4}-\d{2}-\d{2}: 다른 곳에서 함/);
  });
});

describe('입고 전날 안내 (ensureArrivalNotice)', () => {
  const in5 = addDaysISO(today, 5);
  it('예약 D-1 에 한 번만 생기고, 같은 예약을 두 번 넣어도 한 줄', async () => {
    expect(await ensureArrivalNotice({ customerId: CUST, name: '홍길동', phone: '010-1111-2222', date: in5, serviceType: 'PPF' })).toBe(true);
    expect(await ensureArrivalNotice({ customerId: CUST, name: '홍길동', phone: '010-1111-2222', date: in5, serviceType: 'PPF' })).toBe(false);
    const rows = h.fake.tables.follow_ups;
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduled_date).toBe(addDaysISO(in5, -1));
    expect(String(rows[0].memo)).toContain(`${in5} 입고`);
  });
  it('QC·메인터넌스 방문과 오늘·과거 예약에는 안 만든다', async () => {
    expect(await ensureArrivalNotice({ customerId: CUST, name: '홍길동', phone: null, date: in5, serviceType: 'QC점검' })).toBe(false);
    expect(await ensureArrivalNotice({ customerId: CUST, name: '홍길동', phone: null, date: today, serviceType: 'PPF' })).toBe(false);
    expect(h.fake.tables.follow_ups ?? []).toHaveLength(0);
  });
  it('날짜가 바뀌면 옛 안내는 지우고 새 날짜로, 취소면 지우기만', async () => {
    await ensureArrivalNotice({ customerId: CUST, name: '홍길동', phone: null, date: in5, serviceType: 'PPF' });
    const in8 = addDaysISO(today, 8);
    await resyncArrivalNotice({ customerId: CUST, name: '홍길동', phone: null, oldDate: in5, newDate: in8, serviceType: 'PPF' });
    expect(h.fake.tables.follow_ups).toHaveLength(1);
    expect(h.fake.tables.follow_ups[0].scheduled_date).toBe(addDaysISO(in8, -1));
    await resyncArrivalNotice({ customerId: CUST, name: '홍길동', phone: null, oldDate: in8, newDate: null, serviceType: 'PPF' });
    expect(h.fake.tables.follow_ups).toHaveLength(0);
  });
});

describe('딜러가 넣어 준 차의 입고 안내는 딜러에게 (2026-11-23)', () => {
  const DEALER = '88888888-8888-4888-8888-888888888888';
  it('memo 첫 줄이 딜러 번호, 본문은 고객 이름·차종이 든 딜러 문구', async () => {
    h.fake = createFakeSupabase({
      customers: [
        { id: DEALER, name: '조중용', phone: '010-9999-8888', kind: '딜러', dealer_id: null },
        { id: CUST, name: '홍길동', phone: '010-1111-2222', car_brand: 'BMW', car_model: 'X5', kind: '일반', dealer_id: DEALER },
      ],
    });
    const in5 = addDaysISO(today, 5);
    expect(await ensureArrivalNotice({ customerId: CUST, name: '홍길동', phone: '010-1111-2222', date: in5, serviceType: 'PPF' })).toBe(true);
    const memo = String(h.fake.tables.follow_ups[0].memo);
    expect(memo.split('\n')[0]).toBe(`조중용(딜러) 010-9999-8888 · 홍길동 PPF ${in5} 입고`);
    expect(memo).toContain('조중용 님, 내일');
    expect(memo).toContain('홍길동 고객님 BMW X5 PPF 입고 예정');
    // 딜러가 없는 손님은 예전 그대로
    h.fake = createFakeSupabase({ customers: [{ id: CUST, name: '김영희', phone: '010-3333-4444', kind: '일반', dealer_id: null }] });
    await ensureArrivalNotice({ customerId: CUST, name: '김영희', phone: '010-3333-4444', date: in5, serviceType: '랩핑' });
    expect(String(h.fake.tables.follow_ups[0].memo).split('\n')[0]).toBe(`김영희 010-3333-4444 · 랩핑 ${in5} 입고`);
  });
});

describe('블랙리스트는 관리 다 끊기 (2026-11-23)', () => {
  it('등록하면 열린 사후관리가 전부 닫히고, 그 뒤 시공 완료·메인터넌스 반복·입고 안내가 새 관리를 만들지 않는다', async () => {
    const in5 = addDaysISO(today, 5);
    h.fake = createFakeSupabase({
      customers: [{ id: CUST, name: '임권', phone: '010-0000-0000', memo: '파나메라' }],
      services: [{ id: SVC, customer_id: CUST, service_type: 'PPF', service_date: '2026-06-01', memo: null }],
      follow_ups: [
        { customer_id: CUST, service_id: SVC, follow_up_type: 'QC점검', scheduled_date: in5, is_completed: false, memo: 'PPF QC' },
        { customer_id: CUST, service_id: SVC, follow_up_type: '메인터넌스', scheduled_date: in5, is_completed: false, memo: 'PPF 메인터넌스' },
        { customer_id: CUST, service_id: null, follow_up_type: '견적재연락', scheduled_date: in5, is_completed: false, memo: '임권 010' },
        { customer_id: CUST, service_id: SVC, follow_up_type: '후기요청', scheduled_date: '2026-06-04', is_completed: true, completed_date: '2026-06-05', memo: '후기 받음 2026-06-05' },
      ],
    });
    const r = await setBlacklist(CUST, '결제 미이행');
    expect(r).toEqual({ error: null, closed: 3 });
    const rows = h.fake.tables.follow_ups;
    expect(rows.filter((f) => !f.is_completed)).toHaveLength(0);
    expect(rows.filter((f) => /^블랙리스트로 정리 /m.test(String(f.memo)))).toHaveLength(3);
    expect(String(rows[3].memo)).toBe('후기 받음 2026-06-05'); // 이미 끝난 기록은 그대로
    expect(String(h.fake.tables.customers[0].memo)).toContain('[블랙리스트 ');
    // 새 관리가 생기지 않는다
    await createAutoFollowUps(SVC, CUST, 'PPF', today, true);
    expect(await scheduleNextMaintenance({ service_id: SVC, customer_id: CUST, follow_up_type: '메인터넌스' }, today)).toBeNull();
    expect(await ensureArrivalNotice({ customerId: CUST, name: '임권', phone: '010-0000-0000', date: in5, serviceType: 'PPF' })).toBe(false);
    expect(h.fake.tables.follow_ups).toHaveLength(4);
    expect(await cutCareForBlacklisted(CUST)).toBe(0);
  });
});

describe('시작일이 되면 시공중 (advanceAppointmentsForToday)', () => {
  it('오늘 범위의 예약확정만 시공중으로, QC 방문은 제외, 지난 입고 안내는 닫힘', async () => {
    h.fake = createFakeSupabase({
      appointments: [
        { id: 'a1', appointment_date: addDaysISO(today, -1), end_date: addDaysISO(today, 2), service_type: 'PPF', status: '예약확정' },
        { id: 'a2', appointment_date: addDaysISO(today, 3), end_date: null, service_type: 'PPF', status: '예약확정' },
        { id: 'a3', appointment_date: today, end_date: today, service_type: 'QC점검', status: '예약확정' },
      ],
      follow_ups: [{ id: 'n1', follow_up_type: '입고안내', scheduled_date: addDaysISO(today, -1), is_completed: false }],
    });
    expect(await advanceAppointmentsForToday(today)).toBe(1);
    const by = Object.fromEntries(h.fake.tables.appointments.map((a) => [a.id, a.status]));
    expect(by).toEqual({ a1: '시공중', a2: '예약확정', a3: '예약확정' });
    expect(h.fake.tables.follow_ups[0].is_completed).toBe(true);
  });
});

describe('고객 등록 때 미연결 기록 붙이기 (linkOrphanRecordsByPhone)', () => {
  it('같은 번호의 상담 기록·재연락이 붙고, 소개 토큰이 있으면 소개 연결 + 유입경로 소개/재방문', async () => {
    const REF = '99999999-9999-4999-8999-999999999999';
    h.fake = createFakeSupabase({
      customers: [{ id: CUST, name: '홍길동', phone: '010-1111-2222', source: null }],
      consultations: [{ customer_id: null, memo: `홍길동 010-1111-2222 · X5 · 소개: 김소개 [ref:${REF}]`, content: '[견적 문자 발송]' }, { customer_id: null, memo: '남 010-9999-0000 · A6', content: '' }],
      follow_ups: [{ customer_id: null, follow_up_type: '견적재연락', scheduled_date: today, is_completed: false, memo: '홍길동 010-1111-2222 · X5' }],
    });
    const r = await linkOrphanRecordsByPhone(CUST, '010-1111-2222');
    expect(r).toEqual({ consultations: 1, followUps: 1, referrerLinked: '김소개' });
    expect(h.fake.tables.consultations.filter((c) => c.customer_id === CUST)).toHaveLength(1);
    expect(h.fake.tables.follow_ups[0].customer_id).toBe(CUST);
    expect(linkReferral).toHaveBeenCalledWith(CUST, REF);
    expect(h.fake.tables.customers[0].source).toBe('소개/재방문');
  });
  it('번호가 짧으면 아무것도 안 한다', async () => {
    expect(await linkOrphanRecordsByPhone(CUST, '1234')).toEqual({ consultations: 0, followUps: 0, referrerLinked: null });
  });
});

describe('시공 완료 때 사후관리 (createAutoFollowUps)', () => {
  it('PPF 는 QC·메인터넌스·후기요청 세 건, 두 번 불러도 한 벌', async () => {
    await createAutoFollowUps(SVC, CUST, 'PPF', '2026-11-13');
    await createAutoFollowUps(SVC, CUST, 'PPF', '2026-11-13');
    const types = h.fake.tables.follow_ups.map((r) => r.follow_up_type).sort();
    expect(types).toEqual(['QC점검', '메인터넌스', '후기요청']);
    const qc = h.fake.tables.follow_ups.find((r) => r.follow_up_type === 'QC점검')!;
    expect(qc.scheduled_date).toBe('2026-11-27');
  });
  it('랩핑은 QC 없음, 신차패키지에 PPF 항목이 있으면 QC 있음', async () => {
    await createAutoFollowUps(SVC, CUST, '랩핑', '2026-11-13');
    expect(h.fake.tables.follow_ups.map((r) => r.follow_up_type).sort()).toEqual(['메인터넌스', '후기요청']);
    h.fake = createFakeSupabase({});
    await createAutoFollowUps(SVC, CUST, '신차패키지', '2026-11-13', true);
    expect(h.fake.tables.follow_ups.map((r) => r.follow_up_type)).toContain('QC점검');
  });
});

describe('회원 문자 기록 (logMemberSms)', () => {
  it('같은 고객·같은 날·같은 종류는 한 번만', async () => {
    expect(await logMemberSms(CUST, '[회원 문자] 회원 등록·보증서 발급 링크\nhttps://x/a')).toBe(true);
    expect(await logMemberSms(CUST, '[회원 문자] 회원 등록·보증서 발급 링크\nhttps://x/a')).toBe(false);
    expect(await logMemberSms(CUST, '[회원 문자] 소개 감사 + 포인트 적립')).toBe(true);
    expect(h.fake.tables.consultations).toHaveLength(2);
  });
});
