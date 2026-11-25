// 오늘 있었던 일 메모 (2026-11-25)
import { describe, it, expect } from 'vitest';
import { buildNoteContent, noteText, isDailyNote, notesToMemo, DAILY_NOTE_MEMO } from '@/lib/daily-notes';

describe('오늘 메모 (daily-notes)', () => {
  it('저장 형식: content 첫머리 [오늘 메모], memo 표식', () => {
    expect(buildNoteContent('  본넷 끝단이 깊어 시간이 갔음 ')).toBe('[오늘 메모] 본넷 끝단이 깊어 시간이 갔음');
    expect(noteText('[오늘 메모] 본넷 끝단이 깊어 시간이 갔음')).toBe('본넷 끝단이 깊어 시간이 갔음');
    expect(isDailyNote({ memo: DAILY_NOTE_MEMO })).toBe(true);
    expect(isDailyNote({ memo: null, content: '[오늘 메모] x' })).toBe(true);
    expect(isDailyNote({ memo: '회원 문자', content: '[회원 문자] 링크' })).toBe(false);
  });
  it('블로그 현장 메모용 글자: 날짜·손님(차종)·내용 한 줄씩', () => {
    const s = notesToMemo([
      { id: '1', date: '2026-11-25', text: '출고 때 손님이 도어 끝부터 봄', customerId: 'c1', customerName: '홍길동', carModel: 'X5' },
      { id: '2', date: '2026-11-24', text: '오늘은 입고 없음, 샘플 정리', customerId: null, customerName: null, carModel: null },
    ]);
    expect(s).toBe('11/25 홍길동(X5): 출고 때 손님이 도어 끝부터 봄\n11/24: 오늘은 입고 없음, 샘플 정리');
  });
});
