'use client';

import { useState } from 'react';
import { todaySeoul, addDaysISO } from '@/lib/local-date';
import { supabase } from '@/lib/supabase';
import type { InquiryAnswer } from '@/lib/inquiry';

/**
 * 문의 답변 만들기 (2026-11-12)
 * 카페·문자·톡으로 온 문의 글을 붙여 넣으면 /api/inquiry 가 시장 평균가 기준 답변 초안을 만든다.
 * 사장님이 고쳐서 복사·문자 → 상담 기록 한 줄 + (전화 있으면) 다음 날 견적 재연락 등록.
 */
const REVIEWS_LINK = 'https://blog.naver.com/roice_/224472736789';

export default function InquiryReplyModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const today = todaySeoul();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ans, setAns] = useState<InquiryAnswer | null>(null);
  const [reply, setReply] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [car, setCar] = useState('');
  const [withFollowUp, setWithFollowUp] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const generate = async () => {
    if (text.trim().length < 5) { setNote('문의 글을 붙여 넣어 주세요'); return; }
    setBusy(true); setNote(null);
    try {
      const res = await fetch('/api/inquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '답변 생성 실패');
      const a = data as InquiryAnswer;
      setAns(a); setReply(a.reply);
      if (a.name && !name) setName(a.name);
      if (a.phone && !phone) setPhone(a.phone);
      if (a.car) setCar(a.car);
    } catch (e) {
      setNote(`⚠️ ${e instanceof Error ? e.message : '실패'}`);
    }
    setBusy(false);
  };

  const summary = ans ? ans.items.map(i => i.label).concat(ans.unmatched).join(', ') : '';
  const who = `${name.trim() || '미등록'} ${phone.trim()}`.trim();

  const findCustomer = async (): Promise<string | null> => {
    const digits = phone.replace(/[^\d]/g, '');
    if (!digits) return null;
    const formatted = digits.length === 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}` : phone.trim();
    const { data } = await supabase.from('customers').select('id').or(`phone.eq.${formatted},phone.eq.${digits}`).limit(1);
    return data && data.length > 0 ? (data[0].id as string) : null;
  };

  const save = async (how: 'copy' | 'sms' | 'save') => {
    if (!reply.trim()) return;
    setSaving(true); setNote(null);
    try {
      if (how === 'copy') await navigator.clipboard.writeText(reply);
      if (how === 'sms') {
        const p = phone.replace(/[^\d]/g, '');
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        window.open(isIOS ? `sms:${p}&body=${encodeURIComponent(reply)}` : `sms:${p}?body=${encodeURIComponent(reply)}`);
      }
      const customerId = await findCustomer();
      const { error } = await supabase.from('consultations').insert({
        customer_id: customerId,
        consultation_date: today,
        content: `[문의 답변]${customerId ? '' : ` ${who}`}\n${reply}`,
        estimate: ans?.total ? `대략 ${ans.total.typical.toLocaleString()}만원 안팎` : null,
        interested_services: summary || null,
        memo: [customerId ? '' : who, car, '문의 답변'].filter(Boolean).join(' · '),
      });
      if (error) throw new Error(`상담 기록 실패: ${error.message}`);
      let followNote = '';
      if (withFollowUp && phone.replace(/[^\d]/g, '').length >= 10) {
        const msg = `안녕하세요 3M 프로이즘 강남서초점입니다\n어제 문의 주신 ${car || '차량'} ${summary} 건\n더 궁금한 점 있으시면 편하게 물어보세요\n실제 시공 고객 후기 모아둔 글입니다\n${REVIEWS_LINK}`;
        const { error: fe } = await supabase.from('follow_ups').insert({
          customer_id: customerId, follow_up_type: '견적재연락', scheduled_date: addDaysISO(today, 1),
          memo: `${name.trim() || '고객'} ${phone.trim()} · ${car} ${summary}\n${msg}`,
        });
        if (fe) throw new Error(`재연락 등록 실패: ${fe.message}`);
        followNote = ' 내일 견적 재연락도 넣었습니다.';
      } else if (withFollowUp) {
        followNote = ' 전화번호가 없어 재연락은 넣지 않았습니다.';
      }
      setNote(`${how === 'copy' ? '복사했습니다.' : how === 'sms' ? '문자 앱을 열었습니다.' : '저장했습니다.'} 상담 기록에 남겼습니다.${followNote}`);
      onDone();
    } catch (e) {
      setNote(`⚠️ ${e instanceof Error ? e.message : '실패'}`);
    }
    setSaving(false);
  };

  const input = 'w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] focus:outline-none focus:border-[var(--c-text-3)]';
  const pill = 'text-xs font-medium rounded-full px-3 py-1.5 border border-[var(--c-border)] text-[var(--c-text-1)] hover:bg-[var(--c-hover)] disabled:opacity-40 transition-colors';

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-4xl max-h-[calc(100dvh-1.5rem)] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--c-border)] flex items-center justify-between">
          <div>
            <h3 className="text-[var(--c-text-1)] font-semibold text-base">💬 문의 답변</h3>
            <p className="text-xs text-[var(--c-text-3)] mt-0.5">문의 글을 붙여 넣으면 시장 평균가 기준으로 답장을 만듭니다. 고쳐서 보내세요</p>
          </div>
          <button onClick={onClose} className="text-[var(--c-text-3)] hover:text-[var(--c-text-1)] text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* 왼쪽: 문의 글 + 읽은 결과 */}
          <div className="space-y-3">
            <label className="block text-xs text-[var(--c-text-3)]">고객 문의 글</label>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder="카페 댓글·문자·톡 내용을 그대로 붙여 넣으세요" className={input} />
            <button onClick={generate} disabled={busy} className="w-full bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-50 transition-colors">
              {busy ? '읽고 가격 맞추는 중…' : ans ? '다시 만들기' : '답변 만들기'}
            </button>

            {ans && (
              <div className="rounded-lg border border-[var(--c-border)] overflow-hidden">
                <div className="px-3 py-2 bg-[var(--c-subtle)] text-xs text-[var(--c-text-3)] flex items-center justify-between">
                  <span>읽은 항목 · 수입 중형 세단 기준 시장 평균</span>
                  {ans.duration && <span>시공 {ans.duration}</span>}
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {ans.items.map((i) => (
                      <tr key={i.key} className="border-t border-[var(--c-border)]">
                        <td className="px-3 py-2 text-[var(--c-text-1)]">
                          {i.label}{i.unit && <span className="text-[var(--c-text-3)]"> · {i.unit}</span>}
                          <div className={`text-[11px] ${i.confidence === 'low' || i.confidence === 'ours' ? 'text-warn' : 'text-[var(--c-text-4)]'}`}>{i.confidenceLabel}{i.note ? ` · ${i.note}` : ''}</div>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <div className="text-[var(--c-text-1)] font-medium">{i.priceText}</div>
                          {i.min !== i.max && <div className="text-[11px] text-[var(--c-text-4)]">{i.min}~{i.max}만</div>}
                        </td>
                      </tr>
                    ))}
                    {ans.unmatched.map((u) => (
                      <tr key={u} className="border-t border-[var(--c-border)]">
                        <td className="px-3 py-2 text-[var(--c-text-1)]">{u}<div className="text-[11px] text-warn">기준에 없음 · 답변에는 "차량 보고 안내"</div></td>
                        <td className="px-3 py-2 text-right text-[var(--c-text-3)]">—</td>
                      </tr>
                    ))}
                    {ans.total && ans.items.filter(i => i.typical > 0).length >= 2 && (
                      <tr className="border-t border-[var(--c-border)] bg-[var(--c-subtle)]">
                        <td className="px-3 py-2 text-[var(--c-text-1)] font-medium">합계</td>
                        <td className="px-3 py-2 text-right text-[var(--c-text-1)] font-semibold whitespace-nowrap">대략 {ans.total.typical.toLocaleString()}만 원<div className="text-[11px] font-normal text-[var(--c-text-4)]">{ans.total.min}~{ans.total.max}만</div></td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {ans.warnings.length > 0 && (
                  <ul className="px-3 py-2 border-t border-[var(--c-border)] space-y-1">
                    {ans.warnings.map((w, i) => <li key={i} className="text-[11px] text-warn">⚠️ {w}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* 오른쪽: 답장 + 보내기 */}
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div><label className="block text-xs text-[var(--c-text-3)] mb-1">이름</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="선택" className={input} /></div>
              <div><label className="block text-xs text-[var(--c-text-3)] mb-1">전화</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="문자·재연락용" className={input} /></div>
              <div><label className="block text-xs text-[var(--c-text-3)] mb-1">차종</label><input value={car} onChange={(e) => setCar(e.target.value)} placeholder="자동" className={input} /></div>
            </div>
            <label className="block text-xs text-[var(--c-text-3)]">답장 (고쳐도 됩니다)</label>
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={16} placeholder="왼쪽에서 답변을 만들면 여기 나옵니다" className={`${input} leading-relaxed`} />
            <div className="flex items-center justify-between text-xs text-[var(--c-text-3)]">
              <span>{reply.replace(/\s/g, '').length}자</span>
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={withFollowUp} onChange={(e) => setWithFollowUp(e.target.checked)} className="accent-[var(--c-brand)]" />내일 견적 재연락 등록(전화 있을 때)</label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => save('copy')} disabled={!reply || saving} className={pill}>📋 복사하고 기록</button>
              <button onClick={() => save('sms')} disabled={!reply || saving || phone.replace(/[^\d]/g, '').length < 10} className={pill} title={phone ? '' : '전화번호를 넣으면 문자로 보낼 수 있어요'}>💬 문자로 보내기</button>
              <button onClick={() => save('save')} disabled={!reply || saving} className={pill}>기록만</button>
            </div>
            {note && <p className={`text-xs ${note.startsWith('⚠️') ? 'text-warn' : 'text-ok'}`}>{note}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
