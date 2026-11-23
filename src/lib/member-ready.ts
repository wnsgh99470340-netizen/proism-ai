/**
 * 회원 등록 전 빠진 것 검사 (2026-11-23 사장님 "성함·차종·전화번호·작업 중 하나라도 빠지면 회원 등록 안 되게 — 빠진 채로 등록해서 보낼 수는 없잖아")
 * - 회원 등록 = 작업 내역서 완료(보증서 발급) + 회원 페이지 링크 문자. 두 경로 모두 이 검사를 먼저 지나야 한다
 * - 검사는 순수 함수(memberMissing)로 두고, 화면은 DB 에서 읽어 넘긴다(checkMemberReady)
 */
import { supabase } from './supabase';
import { loadVehicles } from './vehicles';

export interface MemberReadyInput {
  name: string | null | undefined;
  phone: string | null | undefined;
  /** 차종(브랜드·모델 중 하나라도) */
  car: string | null | undefined;
  /** 작업 내역(작업 내역서 항목 수 또는 시공 기록 수) */
  workCount: number;
}

/** 빠진 항목 이름 목록. 비어 있으면 등록해도 된다 */
export function memberMissing(i: MemberReadyInput): string[] {
  const out: string[] = [];
  const nm = (i.name || '').trim();
  if (!nm || /^(.+ )?고객$/.test(nm)) out.push('성함'); // 비었거나 "BMW X4 고객" 같은 차종 임시 이름
  if ((i.phone || '').replace(/\D/g, '').length < 10) out.push('전화번호');
  if (!(i.car || '').trim()) out.push('차종');
  if (!(i.workCount > 0)) out.push('작업 내역');
  return out;
}

export function memberBlockMessage(missing: string[]): string {
  return `회원 등록(보증서 발급·회원 페이지)을 하려면 아래가 필요합니다.\n- ${missing.join('\n- ')}\n\n고객 정보 수정에서 채우고 다시 해 주세요. 빠진 채로는 등록하지 않습니다.`;
}

/** 고객 id 로 DB 를 읽어 검사. workCount 는 시공 기록 수(작업 내역서 완료 경로에서는 항목 수를 따로 넘긴다) */
export async function checkMemberReady(customerId: string, workCountOverride?: number): Promise<string[]> {
  const { data: c } = await supabase.from('customers').select('name, phone, car_brand, car_model').eq('id', customerId).maybeSingle();
  if (!c) return ['고객 기록'];
  let car = [c.car_brand, c.car_model].filter(Boolean).join(' ');
  if (!car) { const vs = await loadVehicles(customerId); car = vs.map((v) => [v.brand, v.model].filter(Boolean).join(' ')).find(Boolean) || ''; }
  let workCount = workCountOverride ?? 0;
  if (workCountOverride === undefined) { const { count } = await supabase.from('services').select('id', { count: 'exact', head: true }).eq('customer_id', customerId); workCount = count || 0; }
  return memberMissing({ name: c.name as string, phone: c.phone as string | null, car, workCount });
}
