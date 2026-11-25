/**
 * 오늘 있었던 일 메모 (2026-11-25 사장님 "기능적인 거" — 홈에서 말하듯 한 줄 남기기)
 * - 스키마 변경 없이 consultations 에 memo='오늘 메모', content 첫 줄 "[오늘 메모] …" 로 저장. 손님을 고르면 customer_id 가 붙어 그 손님 타임라인에 보인다
 * - 손님 없이 쓴 메모는 customer_id null — 전화번호가 없으니 '고객과 안 묶인 상담' 점검에는 안 잡힌다
 * - 블로그 폼 '최근 메모 불러오기'가 이 메모를 현장 메모 재료로 가져간다 (재설정 ③ "재료는 사장님 입에서")
 */
import { supabase } from './supabase';
import { todaySeoul } from './local-date';

export const DAILY_NOTE_MEMO = '오늘 메모';
export const DAILY_NOTE_PREFIX = '[오늘 메모]';

export interface DailyNote { id: string; date: string; text: string; customerId: string | null; customerName: string | null; carModel: string | null }

export const isDailyNote = (c: { memo?: string | null; content?: string | null }) => c.memo === DAILY_NOTE_MEMO || (c.content || '').startsWith(DAILY_NOTE_PREFIX);
export const noteText = (content: string | null | undefined) => (content || '').replace(new RegExp(`^\\${DAILY_NOTE_PREFIX.replace(']', '\\]')}\\s*`), '').trim();
export const buildNoteContent = (text: string) => `${DAILY_NOTE_PREFIX} ${text.trim()}`;

/** 블로그 현장 메모에 붙일 글자: "11/25 홍길동(BMW X5): …" 한 줄씩 */
export function notesToMemo(notes: DailyNote[]): string {
  return notes.map((n) => `${Number(n.date.slice(5, 7))}/${Number(n.date.slice(8, 10))}${n.customerName ? ` ${n.customerName}${n.carModel ? `(${n.carModel})` : ''}` : ''}: ${n.text}`).join('\n');
}

export async function saveDailyNote(text: string, customerId: string | null, date = todaySeoul()): Promise<{ error?: string }> {
  const t = text.trim();
  if (!t) return { error: '내용이 비었습니다' };
  const { error } = await supabase.from('consultations').insert({ customer_id: customerId, consultation_date: date, content: buildNoteContent(t), memo: DAILY_NOTE_MEMO });
  return error ? { error: error.message } : {};
}

export async function loadRecentNotes(days = 14, limit = 30): Promise<DailyNote[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { data } = await supabase.from('consultations').select('id, consultation_date, content, customer_id, customer:customers(name, car_model)').eq('memo', DAILY_NOTE_MEMO).gte('consultation_date', since).order('consultation_date', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
  return ((data || []) as unknown as { id: string; consultation_date: string; content: string | null; customer_id: string | null; customer: { name: string; car_model: string | null } | { name: string; car_model: string | null }[] | null }[]).map((r) => {
    const c = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    return { id: r.id, date: r.consultation_date, text: noteText(r.content), customerId: r.customer_id, customerName: c?.name || null, carModel: c?.car_model || null };
  });
}

export async function deleteDailyNote(id: string): Promise<void> {
  await supabase.from('consultations').delete().eq('id', id).eq('memo', DAILY_NOTE_MEMO);
}
