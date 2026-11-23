// 딜러 ↔ 실제 고객 (2026-11-23): 입고 안내 받는 사람 읽기, 딜러용 문구
import { describe, it, expect } from 'vitest';
import { arrivalRecipient, isDealer, isRetiredDealer, retiredDate } from '@/lib/dealers';
import { dealerArrivalSms, dealerDoneSms, arrivalSms } from '@/config/sms-templates';

describe('딜러 구분 (dealers)', () => {
  it('입고 안내 memo 첫 줄에서 받는 사람: 딜러에게 가는 것과 고객에게 가는 것', () => {
    expect(arrivalRecipient('조중용 부장(딜러) 010-9999-8888 · 홍길동 PPF 2026-11-28 입고\n문자 본문')).toEqual({ name: '조중용', phone: '010-9999-8888', toDealer: true, customerName: '홍길동' });
    expect(arrivalRecipient('홍길동 010-1111-2222 · PPF 2026-11-28 입고\n본문')).toEqual({ name: '홍길동', phone: '010-1111-2222', toDealer: false, customerName: '홍길동' });
    expect(arrivalRecipient(null)).toEqual({ name: '', phone: '', toDealer: false, customerName: '' });
  });
  it('딜러 문구에는 고객 이름·차종이 들어가고, 보증서는 고객에게 간다고 말한다', () => {
    const t = dealerArrivalSms('조중용 부장', '홍길동', 'BMW X5', '2026-11-28', 'PPF');
    expect(t).toContain('조중용 부장 님, 내일 11월 28일 토요일 홍길동 고객님 BMW X5 PPF 입고 예정입니다.');
    expect(t).toContain('서초중앙로8길 82');
    expect(t).not.toContain('대차'); // 대차 안내는 고객용 문구에만
    const d = dealerDoneSms('조중용 부장', '홍길동', null, 'PPF');
    expect(d).toContain('홍길동 고객님 PPF 작업 마쳤습니다.');
    expect(d).toContain('보증서와 관리 안내는 고객님께');
    expect(arrivalSms('홍길동', '2026-11-28', 'PPF')).toContain('홍길동 고객님, 내일');
  });
  it('종류 판정: 열이 없거나 비어 있으면 일반', () => {
    expect(isDealer({ kind: '딜러' })).toBe(true);
    expect(isDealer({ kind: null })).toBe(false);
    expect(isDealer({})).toBe(false);
    expect(isDealer(null)).toBe(false);
  });
  it('퇴사 표시 토큰', () => {
    expect(isRetiredDealer('BMW 남양주\n[퇴사 2026-11-23]')).toBe(true);
    expect(retiredDate('BMW 남양주\n[퇴사 2026-11-23]')).toBe('2026-11-23');
    expect(isRetiredDealer('BMW 남양주')).toBe(false);
  });
});
