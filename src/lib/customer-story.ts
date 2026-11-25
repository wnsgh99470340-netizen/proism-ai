/**
 * 손님 이력 → 시공기 재료 (2026-11-25 사장님 "재방문·소개 이야기 자연스럽게 녹여도 돼, 왜 안 해?")
 * - 그동안 글 재료는 사장님 메모와 조사뿐이라 CRM 이 아는 재방문·소개·전 작업이 글에 안 들어갔다
 * - 예약 줄 ✍️ 시공기 버튼이 이 줄들을 현장 메모 뒤 [손님 이력] 블록으로 붙이고, 사실표는 출처 'CRM 기록'으로 1~3줄 넣는다
 * - 사람 이름은 넣지 않는다(소개한 분·딜러 이름 모두). 글에 들어가도 되는 건 사실(언제·무슨 작업)뿐
 */
import { supabase } from './supabase';
import { dealerFor } from './dealers';

export interface PastService { service_date: string | null; service_type: string }

const ym = (iso: string | null | undefined) => { if (!iso) return ''; const [y, m] = iso.slice(0, 10).split('-').map(Number); return `${y}년 ${m}월`; };
const monthsAgo = (iso: string | null | undefined, today: string) => { if (!iso) return null; const [y1, m1] = iso.slice(0, 7).split('-').map(Number); const [y2, m2] = today.slice(0, 7).split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };
const ago = (n: number | null) => (n == null ? '' : n >= 24 ? `${Math.floor(n / 12)}년 전` : n >= 12 ? '1년 전' : n >= 1 ? `${n}개월 전` : '얼마 전');

/** 순수 부분: 이전 시공·소개·딜러 정보로 메모 줄을 만든다 (시험 대상) */
export function storyLinesFrom(input: { today: string; previous: PastService[]; referrerServices: PastService[] | null; viaDealer: boolean }): string[] {
  const out: string[] = [];
  const prev = input.previous.filter((s) => s.service_date).sort((a, b) => ((a.service_date || '') < (b.service_date || '') ? 1 : -1));
  if (prev.length > 0) {
    const last = prev[0];
    const nth = prev.length + 1;
    out.push(`재방문 손님: ${ym(last.service_date)}(${ago(monthsAgo(last.service_date, input.today))}) ${last.service_type} 하신 분, 이번이 ${nth}번째 작업${prev.length > 1 ? ` (그 전에도 ${prev.slice(1).map((s) => `${ym(s.service_date)} ${s.service_type}`).join(', ')})` : ''}`);
  }
  if (input.referrerServices) {
    const rs = input.referrerServices.filter((s) => s.service_date).sort((a, b) => ((a.service_date || '') < (b.service_date || '') ? 1 : -1));
    out.push(rs.length > 0
      ? `소개로 오신 손님: 소개한 분은 ${ym(rs[0].service_date)}(${ago(monthsAgo(rs[0].service_date, input.today))}) ${rs[0].service_type} 하신 손님`
      : '소개로 오신 손님 (소개한 분의 시공 기록은 없음)');
  }
  if (input.viaDealer) out.push('딜러(전시장)를 통해 들어온 차 — 글에 딜러 이름·전시장은 쓰지 않음');
  return out;
}

/** CRM 에서 읽어 줄을 만든다. 실패하면 빈 배열(글 재료는 없어도 글은 써진다) */
export async function customerStoryLines(customerId: string, appointmentDate: string): Promise<string[]> {
  try {
    const [{ data: svcs }, { data: ref }, dealer] = await Promise.all([
      supabase.from('services').select('service_date, service_type').eq('customer_id', customerId).neq('service_date', appointmentDate),
      supabase.from('referrals').select('referrer_id').eq('referred_id', customerId).maybeSingle(),
      dealerFor(customerId),
    ]);
    let referrerServices: PastService[] | null = null;
    if (ref?.referrer_id) {
      const { data: rs } = await supabase.from('services').select('service_date, service_type').eq('customer_id', ref.referrer_id as string);
      referrerServices = (rs || []) as PastService[];
    }
    const today = new Date().toISOString().slice(0, 10);
    return storyLinesFrom({ today, previous: (svcs || []) as PastService[], referrerServices, viaDealer: !!dealer });
  } catch { return []; }
}
