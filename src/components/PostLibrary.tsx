'use client';

import { useState } from 'react';

interface Props {
  /** 현재 미리보기 중인 초안 (최종본 저장의 기본값) */
  draftTitle: string;
  draftBody: string;
  onSaveFinal: (title: string, body: string, feedback: string) => Promise<string | null>;
  onSaveOwner: (title: string, body: string) => Promise<string | null>;
}

const inputCls =
  'w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-2.5 py-2 text-xs text-[var(--c-text-1)] placeholder-[var(--c-text-4)] outline-none focus:border-[#C8A951]/60';

/**
 * 사장님 글 데이터베이스 입력부
 * - 최종본 저장: 초안을 고친 뒤 "무엇을 왜 고쳤는지" 피드백과 함께 저장 → 다음 글부터 반영
 * - 내 글 추가: 사장님이 직접 쓴 글을 톤 기준으로 저장
 */
export default function PostLibrary({ draftTitle, draftBody, onSaveFinal, onSaveOwner }: Props) {
  const [mode, setMode] = useState<'none' | 'final' | 'owner'>('none');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [feedback, setFeedback] = useState('');
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const open = (m: 'final' | 'owner') => {
    setMode(m);
    setStatus('');
    if (m === 'final') { setTitle(draftTitle); setBody(draftBody); setFeedback(''); }
    else { setTitle(''); setBody(''); setFeedback(''); }
  };

  const submit = async () => {
    if (!title.trim() || !body.trim()) { setStatus('제목과 본문을 입력하세요.'); return; }
    setBusy(true);
    const err = mode === 'final'
      ? await onSaveFinal(title.trim(), body.trim(), feedback.trim())
      : await onSaveOwner(title.trim(), body.trim());
    setBusy(false);
    if (err) { setStatus(`저장 실패: ${err}`); return; }
    setStatus(mode === 'final' ? '최종본과 피드백을 저장했습니다. 다음 글부터 반영됩니다.' : '내 글을 저장했습니다. 다음 글부터 말투 참고에 들어갑니다.');
    setMode('none');
  };

  return (
    <div className="mx-3 mb-3 bg-[#1a1a1f] border border-[var(--c-border)] rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-[var(--c-text-1)]">📚 사장님 글 DB</span>
        <span className="text-[10px] text-[var(--c-text-3)]">쌓일수록 내 말투에 가까워짐</span>
      </div>

      {mode === 'none' && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => open('final')}
            disabled={!draftBody}
            className="bg-[#C8A951]/10 hover:bg-[#C8A951]/20 text-[#C8A951] text-xs py-2.5 rounded-lg font-medium disabled:opacity-40"
          >
            ✅ 이 글 고쳐서 최종본 저장
          </button>
          <button
            onClick={() => open('owner')}
            className="bg-[var(--c-subtle)] hover:bg-[var(--c-hover)] text-[var(--c-text-1)] text-xs py-2.5 rounded-lg font-medium"
          >
            ✍️ 내가 쓴 글 추가
          </button>
        </div>
      )}

      {mode !== 'none' && (
        <div className="space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" className={inputCls} />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={mode === 'final' ? 14 : 10}
            placeholder={mode === 'final' ? '초안을 원하는 대로 고치세요' : '직접 쓴 블로그 글 본문을 붙여넣으세요'}
            className={`${inputCls} resize-y font-mono leading-relaxed`}
          />
          {mode === 'final' && (
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              placeholder="무엇을 왜 고쳤는지 한두 줄 (예: 차량 소개가 길어서 줄임 / 마무리가 광고 같아서 담백하게). 다음 글에 반드시 반영됩니다"
              className={`${inputCls} resize-none`}
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={submit} disabled={busy} className="bg-[#E4002B] hover:bg-[#c60026] text-white text-xs py-2 rounded-lg font-medium disabled:opacity-50">
              {busy ? '저장 중...' : '저장'}
            </button>
            <button onClick={() => setMode('none')} className="bg-[var(--c-subtle)] text-[var(--c-text-2)] text-xs py-2 rounded-lg">취소</button>
          </div>
        </div>
      )}

      {status && <div className="mt-2 text-[11px] text-[var(--c-text-2)]">{status}</div>}
    </div>
  );
}
