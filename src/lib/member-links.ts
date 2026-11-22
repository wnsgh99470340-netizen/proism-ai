/**
 * 손님용 회원 페이지 개인 링크 (2026-11-18)
 * - 고객당 token 하나. /m/<token> 으로 들어와 전화 뒷자리 4개로 확인
 * - 표(member_links)가 없으면 오류 문구를 돌려준다
 */
import { supabase } from './supabase';
import { todaySeoul } from './local-date';

export const MEMBER_PAGE_BASE = 'https://proism-ai.vercel.app/m/';

function randomToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
}

/** 고객의 개인 링크(없으면 만들어서) */
export async function getOrCreateMemberLink(customerId: string): Promise<{ url: string; token: string } | { error: string }> {
  const { data: cur, error: e1 } = await supabase.from('member_links').select('token').eq('customer_id', customerId).maybeSingle();
  if (e1) return { error: /relation .* does not exist|schema cache/i.test(e1.message) ? 'member_links 표가 아직 없습니다. docs/회원페이지-member_links-표-만들기.sql 을 Supabase SQL Editor 에서 실행해 주세요' : e1.message };
  if (cur?.token) return { url: MEMBER_PAGE_BASE + cur.token, token: cur.token };
  const token = randomToken();
  const { error: e2 } = await supabase.from('member_links').insert({ customer_id: customerId, token });
  if (e2) return { error: e2.message };
  return { url: MEMBER_PAGE_BASE + token, token };
}

/** 이름 가리기: 김민수 → 김*수, 이름 두 글자 → 김* */
export function maskName(name: string | null | undefined): string {
  const n = (name || '').trim();
  if (n.length <= 1) return n || '고객';
  if (n.length === 2) return n[0] + '*';
  return n[0] + '*'.repeat(n.length - 2) + n[n.length - 1];
}

/** 회원 페이지 링크 안내 문자 (사장님 말투) */
export function memberLinkSms(name: string, url: string, careLine?: string | null): string {
  // careLine: 그 시공의 관리법 첫 줄 ("출고 후 1주일은 세차와 왁스를 쉬어 주세요 …") — 출고 당일 문자에 핵심 한 줄 (2026-11-22 점검 4-2)
  return `안녕하세요 3M 프로이즘 대표 진준호입니다.\n${name} 고객님을 3M 프로이즘 회원으로 등록해 드렸습니다.\n${careLine ? `${careLine.replace(/\.?$/, '.')}\n` : ''}회원 페이지에서 시공 증명서와 보증, 관리 일정, 내 차 관리법, 소개 혜택과 포인트를 보실 수 있습니다.\n${url}\n들어가실 때 전화번호 뒷자리 4개를 넣어 주세요.`;
}

/**
 * 회원 문자 자동 기록 (2026-11-23 사장님 "이것도 중복으로 등록 안 되게"): 같은 고객·같은 날·같은 종류(첫 줄)가 이미 있으면 다시 남기지 않는다
 * 완료 처리 더블 클릭 등으로 문자 제안이 두 번 떠도 기록은 한 줄. 돌려준 값 = 새로 남겼는지
 */
export async function logMemberSms(customerId: string, content: string, date = todaySeoul()): Promise<boolean> {
  const head = content.split('\n')[0];
  const { data } = await supabase.from('consultations').select('id, content').eq('customer_id', customerId).eq('memo', '회원 문자').eq('consultation_date', date);
  if ((data || []).some((r) => ((r.content as string) || '').split('\n')[0] === head)) return false;
  await supabase.from('consultations').insert({ customer_id: customerId, consultation_date: date, content, memo: '회원 문자' });
  return true;
}
