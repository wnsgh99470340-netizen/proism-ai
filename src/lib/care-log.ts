/**
 * 점검 기록 (2026-11-22 사장님 "QC 완료는 체크 하나뿐 → 사진 한 장과 한 줄을 남겨 손님 회원 페이지에 보이게")
 * - 스키마를 바꾸지 않고 follow_ups.memo 끝에 두 줄을 붙인다:
 *     점검 기록 2026-11-22: 물기포 모두 빠짐 · 끝단 들뜸 없음
 *     점검 사진: https://… https://…
 * - CRM 사후관리 완료 창과 손님 회원 페이지(/api/member)가 같이 쓴다
 */
export interface CareLog {
  date: string;
  note: string;
  photos: string[];
}

// \s 는 줄바꿈도 먹어서 메모가 비면 다음 줄(사진)을 메모로 읽는다 → 같은 줄 안의 공백만
const NOTE_RE = /^점검 기록 (\d{4}-\d{2}-\d{2}):[ \t]*(.*)$/m;
const PHOTO_RE = /^점검 사진:[ \t]*(.+)$/m;

export function parseCareLog(memo: string | null | undefined): CareLog | null {
  if (!memo) return null;
  const n = memo.match(NOTE_RE);
  const p = memo.match(PHOTO_RE);
  if (!n && !p) return null;
  const photos = p ? p[1].split(/\s+/).filter((u) => /^https?:\/\//.test(u)) : [];
  return { date: n?.[1] || '', note: (n?.[2] || '').trim(), photos };
}

/** memo 에서 점검 기록 줄을 뺀 나머지(원래 메모) */
export function stripCareLog(memo: string | null | undefined): string {
  return (memo || '').replace(NOTE_RE, '').replace(PHOTO_RE, '').replace(/\n{2,}/g, '\n').trim();
}

export function appendCareLog(memo: string | null | undefined, log: CareLog): string {
  const base = stripCareLog(memo);
  const lines = [base];
  if (log.date) lines.push(`점검 기록 ${log.date}: ${log.note.trim()}`.trimEnd());
  if (log.photos.length) lines.push(`점검 사진: ${log.photos.join(' ')}`);
  return lines.filter(Boolean).join('\n');
}

/** 완료 창의 한 번 누르기 문구. 사장님이 글자로 더 적을 수 있다 */
export const CARE_NOTE_PRESETS: Record<string, string[]> = {
  QC점검: ['물기포 모두 빠짐', '끝단 들뜸 없음', '표면 이물질 없음', '기포 조금 남아 재점검 안내', '리터치 함'],
  메인터넌스: ['필름 전용 코팅 도포', '끝단 점검 이상 없음', '오염 제거', '리터치 함', '세차 방법 다시 안내', '소개 혜택(리터치+코팅) 적용'],
  // 리터치 예약 완료 (2026-11-22): 새 시공 기록 없이 원래 시공 기록 밑에 한 건으로
  리터치: ['끝단 재마감', '기포 제거', '부분 재시공(필름값만)', '오염 제거', '소개 포인트로 공임 서비스', '소개 혜택(리터치+코팅) 적용'],
};
