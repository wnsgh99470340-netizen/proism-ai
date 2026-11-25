// 딜러용 현황 페이지 (2026-11-25): 차 한 대의 상태 판정과 링크 문자
import { describe, it, expect } from 'vitest';
import { carState, dealerLinkSms, dealerPageUrl } from '@/lib/dealer-page';
import { dealerArrivalSms, dealerDoneSms } from '@/config/sms-templates';

const today = '2026-11-25';

describe('딜러 현황 — 차 상태 (carState)', () => {
  it('앞 예약확정은 입고 예정, 끝나는 날이 있으면 출고 예정도 같이', () => {
    const s = carState([{ appointment_date: '2026-11-28', end_date: '2026-12-01', service_type: 'PPF', status: '예약확정' }], [], today);
    expect(s.tone).toBe('soon'); expect(s.label).toBe('입고 예정'); expect(s.detail).toBe('11월 28일 입고 · 12월 1일 출고 예정'); expect(s.service).toBe('PPF');
  });
  it('시작일이 오늘이면 오늘 입고', () => {
    expect(carState([{ appointment_date: today, end_date: null, service_type: '썬팅', status: '예약확정' }], [], today).label).toBe('오늘 입고');
  });
  it('시공중이거나 시작일이 지난 예약확정은 작업 중 + 출고 예정일', () => {
    expect(carState([{ appointment_date: '2026-11-24', end_date: '2026-11-27', service_type: 'PPF', status: '시공중' }], [], today).detail).toBe('11월 27일 출고 예정');
    const late = carState([{ appointment_date: '2026-11-20', end_date: '2026-11-23', service_type: 'PPF', status: '예약확정' }], [], today);
    expect(late.tone).toBe('working'); expect(late.detail).toContain('출고 예정이었음');
  });
  it('완료는 출고 완료(끝나는 날), 예약 없이 시공 기록만 있어도 출고 완료', () => {
    expect(carState([{ appointment_date: '2026-11-10', end_date: '2026-11-13', service_type: '랩핑', status: '완료' }], [], today)).toMatchObject({ tone: 'done', detail: '11월 13일 출고' });
    expect(carState([], [{ service_date: '2026-06-02', completion_date: '2026-06-05', service_type: 'PPF' }], today)).toMatchObject({ tone: 'done', detail: '6월 5일 출고', service: 'PPF' });
  });
  it('취소된 예약은 무시하고 가장 최근 예약을 본다, 아무것도 없으면 기록 없음', () => {
    const s = carState([
      { appointment_date: '2026-12-05', end_date: null, service_type: 'PPF', status: '취소' },
      { appointment_date: '2026-11-01', end_date: '2026-11-03', service_type: 'PPF', status: '완료' },
    ], [], today);
    expect(s.label).toBe('출고 완료');
    expect(carState([], [], today).tone).toBe('none');
  });
  it('정렬 키: 진행 중(0) < 상담(1) < 완료(2) < 없음(3)', () => {
    const w = carState([{ appointment_date: '2026-11-24', end_date: '2026-11-27', service_type: null, status: '시공중' }], [], today).sortKey;
    const d = carState([{ appointment_date: '2026-11-10', end_date: null, service_type: null, status: '완료' }], [], today).sortKey;
    expect(w < d).toBe(true);
  });
});

describe('딜러 현황 — 문자', () => {
  it('링크 문자는 사장님 인사로 시작하고 주소·뒷자리 안내가 들어간다', () => {
    const t = dealerLinkSms('조중용 부장', dealerPageUrl('abc123def456ghi789jkl012'));
    expect(t.startsWith('안녕하세요 3M 프로이즘 대표 진준호입니다.')).toBe(true);
    expect(t).toContain('https://proism-ai.vercel.app/d/abc123def456ghi789jkl012');
    expect(t).toContain('뒷자리 4개');
  });
  it('입고·출고 문자에 링크를 주면 마지막 줄에 붙고, 없으면 예전 그대로', () => {
    const url = 'https://proism-ai.vercel.app/d/abc123def456ghi789jkl012';
    expect(dealerArrivalSms('조중용 부장', '홍길동', 'BMW X5', '2026-11-28', 'PPF', url)).toContain(`작업 현황: ${url}`);
    expect(dealerArrivalSms('조중용 부장', '홍길동', 'BMW X5', '2026-11-28', 'PPF')).not.toContain('작업 현황');
    expect(dealerDoneSms('조중용 부장', '홍길동', null, 'PPF', url).trim().endsWith(url)).toBe(true);
  });
});
