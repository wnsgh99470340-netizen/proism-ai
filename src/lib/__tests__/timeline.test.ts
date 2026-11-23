// 고객 타임라인 (2026-11-23): 여러 표의 기록이 한 줄 목록으로 합쳐지고 종류·순서가 맞는지
import { describe, it, expect } from 'vitest';
import { buildTimeline } from '@/lib/timeline';

const today = '2026-11-23';
const base = {
  today,
  customer: { name: '홍길동', created_at: '2026-10-01T03:00:00Z', source: '블로그' },
  appointments: [], services: [], consultations: [], followUps: [],
};

describe('고객 타임라인 (buildTimeline)', () => {
  it('상담 기록의 접두로 견적 문자·문의 답변·회원 문자·상담을 가른다', () => {
    const { past } = buildTimeline({
      ...base,
      consultations: [
        { id: '1', consultation_date: '2026-11-02', content: '[견적 문자 발송] 홍길동 010-0000-0000\n안녕하세요\nX5 전체 PPF 견적 550만원', memo: null },
        { id: '2', consultation_date: '2026-11-03', content: '[문의 답변] 홍길동\n문의하신 차종 기준으로', memo: null },
        { id: '3', consultation_date: '2026-11-20', content: '[회원 문자] 회원 페이지 링크\nhttps://x', memo: '회원 문자' },
        { id: '4', consultation_date: '2026-11-01', content: '전화 문의, 색상 고민 중', estimate: '550만', memo: '소개: 김철수 [ref:11111111-1111-1111-1111-111111111111]' },
      ],
    });
    const titles = past.map((e) => `${e.date} ${e.title}`);
    expect(titles).toEqual([
      '2026-11-20 회원 문자 · 회원 페이지 링크',
      '2026-11-03 문의 답변 보냄',
      '2026-11-02 견적 문자 보냄',
      '2026-11-01 상담',
      '2026-10-01 고객 등록',
    ]);
    expect(past.find((e) => e.kind === 'quote')?.detail).toContain('550만원');
    expect(past.find((e) => e.kind === 'consult')?.detail).toBe('전화 문의, 색상 고민 중 · 견적 550만');
    expect(past[0].tone).toBe('muted');
  });

  it('예약·시공·보증서·QC 가 날짜순으로 섞이고, 예정은 upcoming 으로 간다', () => {
    const { upcoming, past } = buildTimeline({
      ...base,
      appointments: [
        { id: 'a', appointment_date: '2026-11-10', end_date: '2026-11-13', service_type: 'PPF', status: '완료', memo: JSON.stringify({ warranty_issued: true, warranty: { date: '2026-11-13', work_details: 'PPF 전체 PPF (3M PPF 시리즈150)' } }) },
        { id: 'b', appointment_date: '2026-12-05', end_date: null, service_type: 'QC점검', status: '예약확정', memo: null },
        { id: 'c', appointment_date: '2026-09-01', end_date: null, service_type: '썬팅', status: '취소', memo: null },
      ],
      services: [{ id: 's', service_type: 'PPF', film_used: '3M PPF 시리즈150', service_date: '2026-11-13', completion_date: null, amount: 6500000 }],
      followUps: [
        { id: 'f1', follow_up_type: 'QC점검', scheduled_date: '2026-12-05', is_completed: false, completed_date: null, memo: null, service: { service_type: 'PPF' } },
        { id: 'f2', follow_up_type: '메인터넌스', scheduled_date: '2027-05-13', is_completed: false, completed_date: null, memo: null, service: { service_type: 'PPF' } },
        { id: 'f3', follow_up_type: '후기요청', scheduled_date: '2026-11-15', is_completed: true, completed_date: '2026-11-18', memo: '후기 받음 2026-11-18 https://cafe', service: null },
        { id: 'f4', follow_up_type: '입고안내', scheduled_date: '2026-11-09', is_completed: true, completed_date: '2026-11-09', memo: '홍길동 010 · PPF 11-10 입고', service: null },
      ],
    });
    // QC 방문 예약 + QC 사후관리 = 한 줄("방문 예정")
    expect(upcoming.map((e) => `${e.date} ${e.title}`)).toEqual([
      '2026-12-05 QC 점검 방문 예정 (PPF)',
      '2027-05-13 메인터넌스 연락할 날 (PPF)',
    ]);
    expect(past.map((e) => e.title)).toEqual([
      '후기 받음',
      '보증서 발급 · 회원 등록',
      '시공 완료 · PPF',
      '입고 · PPF',
      '고객 등록',
      '예약 취소 · 썬팅',
    ]);
    expect(past.find((e) => e.kind === 'service')?.detail).toBe('3M PPF 시리즈150 · 6,500,000원');
    expect(past.find((e) => e.kind === 'appointment' && e.title.startsWith('입고'))?.detail).toBe('11/10~11/13 · 완료');
    // 보낸 입고 안내는 줄을 만들지 않는다 (예약 줄로 충분)
    expect(past.some((e) => e.kind === 'arrival')).toBe(false);
  });

  it('지난 QC 는 빨간 warn 으로 upcoming 에, 미방문·기한 지나 정리는 muted', () => {
    const { upcoming, past } = buildTimeline({
      ...base,
      followUps: [
        { id: 'f1', follow_up_type: 'QC점검', scheduled_date: '2026-11-10', is_completed: false, completed_date: null, memo: null, service: { service_type: 'PPF' } },
        { id: 'f2', follow_up_type: '메인터넌스', scheduled_date: '2026-10-01', is_completed: true, completed_date: '2026-10-02', memo: '미방문 2026-10-02: 전화 안 받음\nPPF 메인터넌스', service: { service_type: 'PPF' } },
        { id: 'f3', follow_up_type: '메인터넌스', scheduled_date: '2026-06-01', is_completed: true, completed_date: '2026-11-18', memo: '기한 지나 정리 2026-11-18', service: { service_type: 'PPF' } },
        { id: 'f4', follow_up_type: 'QC점검', scheduled_date: '2026-09-01', is_completed: true, completed_date: '2026-09-03', memo: 'PPF QC\n점검 기록 2026-09-02: 물기포 모두 빠짐 · 끝단 들뜸 없음', service: { service_type: 'PPF' } },
      ],
    });
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]).toMatchObject({ date: '2026-11-10', tone: 'warn', title: 'QC 점검 연락할 날 (PPF)' });
    const titles = past.map((e) => e.title);
    expect(titles).toContain('메인터넌스 미방문 (PPF)');
    expect(titles).toContain('메인터넌스 기한 지나 정리 (PPF)');
    const qc = past.find((e) => e.title === 'QC 점검 완료 (PPF)');
    expect(qc).toMatchObject({ date: '2026-09-02', tone: 'ok', detail: '물기포 모두 빠짐 · 끝단 들뜸 없음' });
  });

  it('견적 재연락·마무리는 예약으로 이어짐 / 종결 사유 한 줄로 합친다', () => {
    const { past, upcoming } = buildTimeline({
      ...base,
      followUps: [
        { id: 'q1', follow_up_type: '견적재연락', scheduled_date: '2026-11-05', is_completed: true, completed_date: '2026-11-06', memo: '홍길동 010\n예약 잡혀 자동 정리 2026-11-06', service: null },
        { id: 'q2', follow_up_type: '견적마무리', scheduled_date: '2026-11-07', is_completed: true, completed_date: '2026-11-06', memo: '홍길동 010\n예약 잡혀 자동 정리 2026-11-06', service: null },
        { id: 'q3', follow_up_type: '견적재연락', scheduled_date: '2026-11-15', is_completed: true, completed_date: '2026-11-16', memo: '견적 종결 2026-11-16: 다른 곳에서 함\n홍길동', service: null },
        { id: 'q4', follow_up_type: '견적마무리', scheduled_date: '2026-11-17', is_completed: true, completed_date: '2026-11-16', memo: '견적 종결 2026-11-16: 다른 곳에서 함\n홍길동', service: null },
        { id: 'q5', follow_up_type: '견적마무리', scheduled_date: '2026-11-25', is_completed: false, completed_date: null, memo: '홍길동', service: null },
      ],
    });
    const quotes = past.filter((e) => e.kind === 'quote').map((e) => e.title);
    expect(quotes).toEqual(['견적 종결 · 다른 곳에서 함', '견적 → 예약으로 이어짐']);
    expect(upcoming.map((e) => e.title)).toEqual(['견적 마무리 할 날']);
  });

  it('소개·포인트·회원 페이지·리터치', () => {
    const { past } = buildTimeline({
      ...base,
      referrals: {
        receivedFrom: { id: 'r1', referrer_id: 'x', referred_id: 'me', referred_reward: '생활보호 5종', referred_reward_used_at: '2026-11-14', referrer_reward: null, referrer_reward_used_at: null, thanks_sms_sent_at: null, memo: null, created_at: '2026-10-05T00:00:00Z', referrer: { name: '김철수', phone: null } } as never,
        gave: [{ id: 'r2', referrer_id: 'me', referred_id: 'y', referred_reward: null, referred_reward_used_at: null, referrer_reward: null, referrer_reward_used_at: null, thanks_sms_sent_at: '2026-11-19T01:00:00Z', memo: null, created_at: '2026-11-18T00:00:00Z', referred: { name: '이영희', phone: null } } as never],
      },
      points: [{ id: 'p', delta: 1, reason: '이영희 님 소개 시공 완료', referral_id: 'r2', created_at: '2026-11-21T00:00:00Z' }],
      memberLink: { created_at: '2026-11-13T00:00:00Z', last_seen_at: '2026-11-22T10:00:00Z', visits: 3 },
      followUps: [{ id: 'rt', follow_up_type: '리터치', scheduled_date: '2026-11-20', is_completed: true, completed_date: '2026-11-20', memo: '점검 기록 2026-11-20: 끝단 재마감', service: { service_type: 'PPF' } }],
    });
    expect(past.map((e) => `${e.date} ${e.title}`)).toEqual([
      '2026-11-22 회원 페이지 열어 봄 · 3회',
      '2026-11-21 소개 포인트 +1점',
      '2026-11-20 리터치 (PPF)',
      '2026-11-19 소개 감사 문자 보냄',
      '2026-11-18 이영희 님을 소개',
      '2026-11-14 소개받은 분 혜택 적용 · 생활보호 5종',
      '2026-10-05 소개받음 · 김철수 님',
      '2026-10-01 고객 등록',
    ]);
  });
});
