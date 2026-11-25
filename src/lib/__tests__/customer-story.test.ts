// 손님 이력 → 시공기 재료 (2026-11-25)
import { describe, it, expect } from 'vitest';
import { storyLinesFrom } from '@/lib/customer-story';

describe('손님 이력 줄 (customer-story)', () => {
  const today = '2026-11-25';
  it('재방문: 마지막 작업의 시기·종류·몇 번째인지', () => {
    const l = storyLinesFrom({ today, previous: [{ service_date: '2024-06-02', service_type: 'PPF' }], referrerServices: null, viaDealer: false });
    expect(l).toEqual(['재방문 손님: 2024년 6월(2년 전) PPF 하신 분, 이번이 2번째 작업']);
  });
  it('세 번째 이상이면 그 전 작업도 나열', () => {
    const l = storyLinesFrom({ today, previous: [{ service_date: '2025-03-10', service_type: '랩핑' }, { service_date: '2026-08-18', service_type: '크롬죽이기' }], referrerServices: null, viaDealer: false });
    expect(l[0]).toContain('2026년 8월(3개월 전) 크롬죽이기 하신 분, 이번이 3번째 작업');
    expect(l[0]).toContain('그 전에도 2025년 3월 랩핑');
  });
  it('소개: 소개한 분의 작업만, 이름 없음 / 딜러는 이름 쓰지 말라는 줄', () => {
    const l = storyLinesFrom({ today, previous: [], referrerServices: [{ service_date: '2025-11-01', service_type: '신차패키지' }], viaDealer: true });
    expect(l[0]).toBe('소개로 오신 손님: 소개한 분은 2025년 11월(1년 전) 신차패키지 하신 손님');
    expect(l[1]).toContain('딜러 이름·전시장은 쓰지 않음');
    expect(storyLinesFrom({ today, previous: [], referrerServices: [], viaDealer: false })).toEqual(['소개로 오신 손님 (소개한 분의 시공 기록은 없음)']);
  });
  it('첫 손님이면 아무 줄도 없다', () => {
    expect(storyLinesFrom({ today, previous: [], referrerServices: null, viaDealer: false })).toEqual([]);
  });
});
