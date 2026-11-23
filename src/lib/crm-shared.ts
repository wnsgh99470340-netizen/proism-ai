/**
 * CRM 공통 타입·상수·헬퍼 (2026-11-23 page.tsx 쪼개기 — 동작 변경 없음)
 * page.tsx 에 있던 39~213줄을 그대로 옮김. 자동 시험(src/lib/__tests__)이 이 파일을 본다
 */
import { supabase } from './supabase';
import { toSeoulISO } from './local-date';

// ─── Types ───────────────────────────────────────────────
export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  car_brand: string | null;
  car_model: string | null;
  car_year: string | null;
  car_color: string | null;
  source: string | null;
  memo: string | null;
  /** '일반' | '딜러' (2026-11-23, 열이 없으면 undefined) */
  kind?: string | null;
  dealer_id?: string | null;
  created_at: string;
  updated_at: string;
  latest_service: string | null;
  latest_service_date: string | null;
  /** 완료된 시공이 없고 예약만 있을 때 true → 목록에 "PPF 예약 (날짜)" 로 보임 */
  latest_is_booking?: boolean;
  latest_status?: string | null;
  service_count: number;
}

export interface Appointment {
  id: string;
  customer_id: string;
  /** 어느 차에 한 작업인지 (2026-11-22 차량 N대). 표가 없으면 undefined */
  vehicle_id?: string | null;
  /** QC·메인터넌스 방문 예약이 묶인 사후관리 (열이 없으면 memo 의 "사후관리:<id>") */
  follow_up_id?: string | null;
  vehicle?: { brand: string | null; model: string | null; plate: string | null } | null;
  appointment_date: string;
  end_date?: string | null;
  service_type: string | null;
  status: string;
  memo: string | null;
  amount?: number | null;
  created_at: string;
  updated_at: string;
  customer?: { name: string; phone: string | null };
}

export interface FollowUp {
  id: string;
  service_id: string;
  customer_id: string;
  follow_up_type: string;
  scheduled_date: string;
  is_completed: boolean;
  completed_date: string | null;
  memo: string | null;
  created_at: string;
  customer?: { name: string; phone: string | null };
  service?: { service_type: string };
  sms_sent?: Record<string, boolean> | null;
  /** 잡힌 방문 예약 (2026-11-22) */
  visit?: { id: string; appointment_date: string; status: string } | null;
}

export interface Consultation {
  id: string;
  customer_id: string;
  consultation_date: string;
  content: string | null;
  estimate: string | null;
  interested_services: string | null;
  memo: string | null;
  created_at: string;
  customer?: { name: string; phone: string | null };
}

export type Tab = 'home' | 'blog' | 'customers' | 'appointments' | 'followups' | 'consultations';
export const TAB_KEYS: Tab[] = ['home', 'blog', 'customers', 'appointments', 'followups', 'consultations'];

export const SERVICE_TYPES = ['PPF', '컬러PPF', 'PWF', '랩핑', '크롬죽이기', '썬팅', '유리막코팅', '가죽코팅', '실내PPF', '신차패키지', '리터치', 'QC점검', '메인터넌스'];
/** QC·메인터넌스 방문 예약 (2026-11-22): 사후관리 한 건에 묶인 달력 예약. 완료하면 점검 기록 창 → 그 사후관리도 완료 */
export const CARE_VISIT_TYPES = ['QC점검', '메인터넌스'];
/** 리터치(2026-11-22): 완료해도 새 시공 기록을 만들지 않고 원래 시공 기록 밑에 관리 이력 한 건으로 붙는다 */
export const RETOUCH_TYPE = '리터치';
export const APPOINTMENT_STATUSES = ['상담중', '예약확정', '시공중', '완료', '취소']; // 취소(2026-11-22): 삭제하면 "예약했다 취소했다" 기록이 사라지므로 상태로 남긴다. 홈·오늘 예약·손님 페이지에서는 이미 거른다
export const FOLLOW_UP_TYPES = ['QC점검', '메인터넌스', '후기요청'];
/** 홈 상단 배너 사진 경로(public 기준, 예: '/img/home-banner.jpg'). 비우면 글자만 표시. 사장님이 배너용 사진 주면 넣는다 */
export const HOME_BANNER_IMAGE = '';
/** QC(2주)·메인터넌스(6개월) 안내 문자 */
/** 폰 문자 앱 열기 (iOS는 &body=, Android는 ?body=) */
export function openSmsApp(phone: string, msg: string) {
  const p = phone.replace(/[^\d]/g, '');
  const cleanMsg = msg.replace(/\\n/g, '\n').trim();
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const url = isIOS ? `sms:${p}&body=${encodeURIComponent(cleanMsg)}` : `sms:${p}?body=${encodeURIComponent(cleanMsg)}`;
  // 같은 창에서 연다 (2026-11-23 갤럭시: window.open 은 빈 탭을 하나 더 열어 문자 앱에서 돌아오면 그 빈 탭이 보이고 CRM 은 뒤에 숨어 confirm 을 못 봄)
  const a = document.createElement('a');
  a.href = url; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
}



/**
 * 문자(또는 카톡) 앱을 연 뒤 "보냈나요?"를 묻는다 (2026-11-23 사장님 "맥은 되는데 폰은 보낸 표시가 안 남").
 * 폰에서는 sms: 로 넘어가는 순간 화면이 숨겨지고 그때 뜬 confirm 은 자동으로 취소되어 false 가 됐다.
 * → 화면이 숨겨졌으면 돌아올 때까지 기다렸다가 묻는다. 맥처럼 화면이 그대로면 바로 묻는다.
 */
export async function confirmAfterSms(msg: string): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  // 폰은 문자 앱이 뜨기까지 잠깐 걸린다: 최대 1.5초 동안 화면이 숨겨지는지 본다 (맥은 안 숨겨져 1.5초 뒤 바로 묻는다)
  for (let i = 0; i < 15 && document.visibilityState !== 'hidden'; i++) await new Promise((r) => setTimeout(r, 100));
  if (document.visibilityState === 'hidden') {
    await new Promise<void>((resolve) => {
      const on = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', on); resolve(); } };
      document.addEventListener('visibilitychange', on);
    });
    await new Promise((r) => setTimeout(r, 300));
  }
  return confirm(msg);
}

export const TEMPLATE_KEYS = ['크롬죽이기', 'PPF', '신차패키지', '랩핑'];

// 사후관리 자동 생성 로직
export async function createAutoFollowUps(
  serviceId: string,
  customerId: string,
  serviceType: string,
  completionDate: string,
  /** 작업 내역서에 PPF 항목이 있으면(신차패키지 안의 프론트 패키지 등) QC 를 잡는다. 2026-11-19 사장님 "QC 는 PPF·컬러PPF 에만" */
  hasPpf = false
) {
  const base = new Date(completionDate + 'T00:00:00+09:00');
  const followUps: { service_id: string; customer_id: string; follow_up_type: string; scheduled_date: string; memo: string }[] = [];

  const needsQC = ['PPF', '컬러PPF', 'PWF'].includes(serviceType) || hasPpf;

  if (needsQC) {
    const qcDate = new Date(base);
    qcDate.setDate(qcDate.getDate() + 14);
    followUps.push({
      service_id: serviceId,
      customer_id: customerId,
      follow_up_type: 'QC점검',
      scheduled_date: toSeoulISO(qcDate),
      memo: `${serviceType} 시공 완료 후 2주 QC점검`,
    });
  }

  const maintDate = new Date(base);
  maintDate.setMonth(maintDate.getMonth() + 6);
  followUps.push({
    service_id: serviceId,
    customer_id: customerId,
    follow_up_type: '메인터넌스',
    scheduled_date: toSeoulISO(maintDate),
    memo: `${serviceType} 시공 완료 후 6개월 메인터넌스`,
  });

  // 후기요청: 시공 완료 3일 후
  const reviewDate = new Date(base);
  reviewDate.setDate(reviewDate.getDate() + 3);
  followUps.push({
    service_id: serviceId,
    customer_id: customerId,
    follow_up_type: '후기요청',
    scheduled_date: toSeoulISO(reviewDate),
    memo: `${serviceType} 시공 완료 후 후기 요청`,
  });

  if (followUps.length > 0) {
    // 같은 시공 기록에 이미 사후관리가 있으면 만들지 않는다 (2026-11-22 "한 작업당 무조건 한 번만"). 유형별로 빠진 것만 채운다
    const { data: have } = await supabase.from('follow_ups').select('follow_up_type').eq('service_id', serviceId);
    const haveTypes = new Set((have || []).map((h) => h.follow_up_type as string));
    const missing = followUps.filter((f) => !haveTypes.has(f.follow_up_type));
    if (missing.length > 0) await supabase.from('follow_ups').insert(missing);
  }
}

// ─── Helper ──────────────────────────────────────────────
/** 전화번호 저장 형식 통일 010-0000-0000 (2026-11-22 점검 10). 11자리·10자리가 아니면 적은 그대로 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const t = (raw || '').trim(); if (!t) return null;
  const d = t.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return t;
}
export function formatDate(dateStr: string | null) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function statusColor(status: string) {
  switch (status) {
    case '상담중': return 'bg-[var(--c-hover)] text-[var(--c-text-2)]';
    case '예약확정': return 'bg-info/20 text-info';
    case '시공중': return 'bg-warn/20 text-warn';
    case '완료': return 'bg-ok/20 text-ok';
    case '취소': return 'bg-danger/10 text-danger line-through';
    default: return 'bg-[var(--c-hover)] text-[var(--c-text-2)]';
  }
}

