/**
 * 직원용 예약 페이지 (2026-11-27 사장님 "예약/일정 탭만 직원들이 볼 수 있게 공유, 핸드폰 앱으로")
 * - /s/<코드>. 코드는 표 없이 CRM 비밀번호에서 만든다(비밀번호를 바꾸면 링크도 바뀜). 들어갈 때 STAFF_PIN 4자리
 * - 읽기 전용. 전화번호·금액·딜러·이메일은 내려보내지 않는다 — toStaffCar 가 고정된 키만 만든다
 * - 순수 함수는 시험 대상(staff-page.test.ts). DB 읽기는 /api/staff/[token], 화면은 /s/[token]
 */
import { createHash } from 'crypto';
import { addDaysISO } from '@/lib/local-date';
import { parseWorkOrder, workSummaryLines } from '@/lib/work-order';

export const STAFF_PAGE_BASE = 'https://proism-ai.vercel.app/s/';
export const staffPageUrl = (token: string) => STAFF_PAGE_BASE + token;

/** 서버 전용: sha256("proism-staff-v1:" + CRM_PASSWORD) 앞 24자 */
export function staffToken(): string {
  const pw = process.env.CRM_PASSWORD || '';
  if (!pw) return '';
  return createHash('sha256').update(`proism-staff-v1:${pw}`).digest('hex').slice(0, 24);
}

/** 보여 줄 기간: 오늘 -14일 ~ +60일 */
export function staffVisibleRange(today: string): { from: string; to: string } {
  return { from: addDaysISO(today, -14), to: addDaysISO(today, 60) };
}

/** 응답 키 — 시험으로 고정. 여기 없는 키(phone·amount·dealer·email 등)는 절대 내려가지 않는다 */
export const STAFF_CAR_KEYS = ['id', 'name', 'car', 'plate', 'service_type', 'appointment_date', 'end_date', 'status', 'note', 'work'] as const;
export interface StaffCar {
  id: string; name: string; car: string | null; service_type: string | null;
  appointment_date: string; end_date: string | null; status: string; note: string | null;
  /** 차량번호 — 작업 내역서 JSON 의 car_number (2026-11-27 사장님 피드백) */
  plate: string | null;
  /** 작업 내역 줄 — 작업 내역서 JSON 이면 workSummaryLines (사후관리 카드와 같은 함수), 아니면 [] */
  work: string[];
}

export interface StaffAppointmentRow {
  id: string; appointment_date: string; end_date?: string | null; service_type?: string | null; status: string; memo?: string | null;
  customer?: { name?: string | null; car_brand?: string | null; car_model?: string | null } | null;
  vehicle?: { brand?: string | null; model?: string | null } | null;
  [k: string]: unknown;
}

const PHONE_RE = /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g;
const MONEY_RE = /\d[\d,.]*\s*(만\s*원|만원|만|원)/g;
/** 전화번호·금액 가리기 */
export function maskSensitive(t: string): string {
  return t.replace(PHONE_RE, '').replace(MONEY_RE, '').replace(/[ \t]{2,}/g, ' ').trim();
}

/** 작업 내역 줄: 작업 내역서 JSON 일 때만 (글자 메모는 note 쪽) */
export function staffWork(memo: string | null | undefined): string[] {
  if (!parseWorkOrder(memo)) return [];
  return workSummaryLines(memo).map(maskSensitive).filter(Boolean);
}

/** 메모: JSON(작업 내역서)이면 field_note·notes 만, 글자면 앞 120자 */
export function staffNote(memo: string | null | undefined): string | null {
  const m = (memo || '').trim();
  if (!m) return null;
  if (m.startsWith('{')) {
    try {
      const j = JSON.parse(m) as { field_note?: unknown; notes?: unknown };
      const parts = [j.field_note, j.notes].filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => maskSensitive(x)).filter(Boolean);
      return parts.length ? parts.join('\n') : null;
    } catch { /* 글자로 */ }
  }
  // 글자 메모 속 전화번호·금액은 가린다 — 직원 페이지는 금액을 보이지 않는다
  const t = maskSensitive(m);
  return t ? t.slice(0, 120) : null;
}

export function toStaffCar(a: StaffAppointmentRow): StaffCar {
  const v = a.vehicle && (a.vehicle.brand || a.vehicle.model) ? a.vehicle : null;
  const brand = v ? v.brand : a.customer?.car_brand;
  const model = v ? v.model : a.customer?.car_model;
  return {
    id: a.id,
    name: (a.customer?.name || '').trim() || '이름 없음',
    car: [brand, model].filter(Boolean).join(' ') || null,
    service_type: a.service_type || null,
    appointment_date: a.appointment_date,
    end_date: a.end_date || null,
    status: a.status,
    note: staffNote(a.memo),
    plate: (() => { const n = parseWorkOrder(a.memo)?.car_number; return typeof n === 'string' && n.trim() ? n.trim().slice(0, 16) : null; })(),
    work: staffWork(a.memo),
  };
}

/** 범위 안(기간이 범위와 겹침) + 취소 제외 → 날짜 순 */
export function staffCars(rows: StaffAppointmentRow[], today: string): StaffCar[] {
  const { from, to } = staffVisibleRange(today);
  return rows
    .filter((a) => a.status !== '취소' && a.appointment_date && a.appointment_date <= to && (a.end_date || a.appointment_date) >= from)
    .map(toStaffCar)
    .sort((x, y) => (x.appointment_date < y.appointment_date ? -1 : x.appointment_date > y.appointment_date ? 1 : 0));
}
