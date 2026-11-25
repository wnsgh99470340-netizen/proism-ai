// 통화 요약 → 상담 기록 (2026-11-25): 분류·문구·재연락 제안·이름 나누기·중복
import { describe, it, expect } from 'vitest';
import { guessKind, guessService, callContent, suggestFollowUp, splitSavedName, isDuplicateCall, unregisteredMemoHead, type ExtractedCall } from '@/lib/call-summary';

const call = (o: Partial<ExtractedCall>): ExtractedCall => ({ savedName: '', phone: null, date: '2026-11-23', time: '17:04', direction: '수신', duration: '1분 7초', title: '', bullets: [], todo: null, ...o });

describe('통화 요약 (call-summary)', () => {
  it('저장된 이름 나누기: 손님+차종 / 딜러 소속+이름 / 번호만', () => {
    expect(splitSavedName('이명호 현대 그랜저 (3)')).toEqual({ name: '이명호', car: '현대 그랜저', org: null });
    expect(splitSavedName('벤츠 송파 윤성혁')).toEqual({ name: '윤성혁', car: null, org: '벤츠 송파' });
    expect(splitSavedName('BMW 강남 김남건 대리')).toEqual({ name: '김남건', car: null, org: 'BMW 강남' });
    expect(splitSavedName('010-7773-3486')).toEqual({ name: '', car: null, org: null });
    expect(splitSavedName('1급공업사 지승흠대표님 또는 ...')).toEqual({ name: '지승흠', car: null, org: '1급공업사' });
    expect(splitSavedName('벤츠 방배전시장 박원빈차장')).toEqual({ name: '박원빈', car: null, org: '벤츠 방배전시장' });
  });
  it('종류 짐작: 문의 / 예약 / 사후 / 딜러 / 기타', () => {
    expect(guessKind(call({ title: '차량 수리 비율 및 일정 논의', bullets: ['운전석 15프로 조수석 30프로 비율 의견'] }), false)).toBe('문의');
    expect(guessKind(call({ title: '입고 시간 확인', bullets: ['내일 10시 도착 예정'] }), false)).toBe('예약');
    expect(guessKind(call({ title: '뒷유리 기포 시공 일정 문의' }), false)).toBe('사후');
    expect(guessKind(call({ savedName: '벤츠 송파 윤성혁', title: '쓰리엠 필름 등급과 시공 문의' }), true)).toBe('딜러');
    expect(guessKind(call({ savedName: '010-7773-3486', title: '방문 기사의 도착 예정 시간 확인', bullets: ['퀵 서비스 기사 방문 대기'] }), false)).toBe('기타');
    expect(guessKind(call({ savedName: '류하솜 테슬라 모델3 또는…', title: '차량 썬팅 작업 인력 비용 및 일정 관련 상담' }), false)).toBe('기타'); // 내부 통화
  });
  it('시공 종류 짐작', () => {
    expect(guessService('운전석 15프로 조수석 30프로 농도')).toBe('썬팅');
    expect(guessService('쓰리엠 필름 등급 50 100 150 200 발수')).toBe('PPF');
    expect(guessService('서류 퀵비 및 배송 접수')).toBeNull();
  });
  it('상담 기록 문구와 미등록 메모 첫 줄', () => {
    const c = callContent(call({ title: '썬팅 농도·일정 논의', bullets: ['운전석 15% 조수석 30%', '내일은 어려움'], todo: { text: '다음주 확인', date: '2026-11-30' } }), '문의');
    expect(c.split('\n')[0]).toBe('[통화 요약] 17:04 수신 1분 7초 · 썬팅 농도·일정 논의');
    expect(c).toContain('- 운전석 15% 조수석 30%');
    expect(c).toContain('- 할 일: 다음주 확인 (2026-11-30)');
    expect(unregisteredMemoHead('홍길동', '010-1111-2222', 'X5')).toBe('홍길동 010-1111-2222 · X5');
    expect(unregisteredMemoHead('홍길동', null, null)).toBe('홍길동');
  });
  it('재연락 제안: 문의·딜러만, 할 일 날짜 우선, 열린 재연락·앞 예약 있으면 없음', () => {
    const today = '2026-11-23';
    expect(suggestFollowUp(call({ todo: { text: '확인', date: '2026-11-30' } }), '문의', today, false, false)).toBe('2026-11-30');
    expect(suggestFollowUp(call({}), '문의', today, false, false)).toBe('2026-11-26');
    expect(suggestFollowUp(call({}), '문의', today, true, false)).toBeNull();
    expect(suggestFollowUp(call({}), '문의', today, false, true)).toBeNull();
    expect(suggestFollowUp(call({}), '예약', today, false, false)).toBeNull();
    expect(suggestFollowUp(call({}), '기타', today, false, false)).toBeNull();
  });
  it('같은 시각 통화는 중복', () => {
    expect(isDuplicateCall(['[통화 요약] 17:04 수신 1분 7초 · 썬팅\n- a'], call({ time: '17:04' }))).toBe(true);
    expect(isDuplicateCall(['[견적 문자 발송] 홍길동 010'], call({ time: '17:04' }))).toBe(false);
  });
});
