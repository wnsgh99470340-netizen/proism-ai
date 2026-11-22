'use client';

import { useRef, useState } from 'react';
import { CARE_NOTE_PRESETS } from '@/lib/care-log';

/**
 * QC·메인터넌스 완료 창 (2026-11-22): 완료 체크 대신 "무엇을 봤는지" 한 줄과 사진을 남긴다
 * - 문구는 칩을 눌러 모으고 글자로 보탤 수 있다. 사진은 폰에서 1600px 로 줄여 /api/care/photo 에 올린다
 * - 기록은 follow_ups.memo 에 붙고(src/lib/care-log.ts) 손님 회원 페이지 관리 탭에 그대로 보인다
 * - "기록 없이 완료"도 남겨 둔다 (급할 때)
 */
export default function CareCompleteModal({ type, customerName, onClose, onDone, services }: {
  type: string;
  customerName: string;
  onClose: () => void;
  onDone: (note: string, photos: string[], serviceId?: string | null) => Promise<void> | void;
  /** 리터치(2026-11-22): 어느 시공 기록 밑에 붙일지. 하나면 자동, 여럿이면 고르게 */
  services?: { id: string; label: string }[];
}) {
  const presets = CARE_NOTE_PRESETS[type] || [];
  const [picked, setPicked] = useState<string[]>([]);
  const [extra, setExtra] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [serviceId, setServiceId] = useState<string>(services && services.length > 0 ? services[0].id : '');

  const note = [...picked, extra.trim()].filter(Boolean).join(' · ');
  const toggle = (p: string) => setPicked((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files).slice(0, 4 - photos.length)) {
        if (!/^image\//.test(file.type)) continue;
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const res = await fetch('/api/care/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: dataUrl.split(',')[1], mediaType: 'image/jpeg', name: file.name }) });
        const j = await res.json();
        if (!res.ok || j.error) { alert(j.error || '사진 업로드 실패'); continue; }
        setPhotos((cur) => [...cur, j.url as string]);
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const finish = async (withLog: boolean) => {
    setSaving(true);
    try { await onDone(withLog ? note : '', withLog ? photos : [], serviceId || null); } finally { setSaving(false); }
  };

  const title = type === 'QC점검' ? 'QC 점검 완료' : `${type} 완료`;
  const isRetouch = type === '리터치';
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl w-full max-w-md max-h-[calc(100dvh-1.5rem)] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--c-border)] flex items-center justify-between">
          <div>
            <div className="text-[var(--c-text-1)] font-semibold">{title}</div>
            <div className="text-xs text-[var(--c-text-3)] mt-0.5">{customerName} 고객님 · 여기 적은 내용이 손님 회원 페이지 관리 탭에 그대로 보입니다</div>
          </div>
          <button onClick={onClose} className="text-[var(--c-text-3)] hover:text-[var(--c-text-1)] text-lg">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {isRetouch && (
            <div>
              <div className="text-xs text-[var(--c-text-3)] mb-2">어느 시공의 리터치인가요</div>
              {services && services.length > 0 ? (
                <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50">
                  {services.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              ) : (
                <div className="text-xs text-warn bg-warn/10 rounded-lg px-3 py-2">이 고객님의 시공 기록이 없어 묶을 곳이 없습니다. 리터치 기록은 고객에게만 남고, 손님 페이지에는 "그 외"로 보입니다</div>
              )}
            </div>
          )}
          <div>
            <div className="text-xs text-[var(--c-text-3)] mb-2">{isRetouch ? '무엇을 했나요' : '무엇을 봤나요'}</div>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button key={p} type="button" onClick={() => toggle(p)} className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${picked.includes(p) ? 'bg-brand text-white border-brand' : 'border-[var(--c-border)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)]'}`}>{p}</button>
              ))}
            </div>
            <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="더 적을 것 (예: 앞범퍼 하단 끝단 한 번 더 눌러 줌)" className="mt-2 w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50" />
          </div>
          <div>
            <div className="text-xs text-[var(--c-text-3)] mb-2">사진 (최대 4장 · 번호판이 크게 나온 사진은 피해 주세요)</div>
            <div className="flex gap-2 flex-wrap">
              {photos.map((u) => (
                <div key={u} className="relative">
                  <img src={u} alt="" className="w-20 h-20 object-cover rounded-lg border border-[var(--c-border)]" />
                  <button type="button" onClick={() => setPhotos((cur) => cur.filter((x) => x !== u))} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--c-text-1)] text-[var(--c-card)] text-[10px] leading-5">✕</button>
                </div>
              ))}
              {photos.length < 4 && (
                <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="w-20 h-20 rounded-lg border border-dashed border-[var(--c-border)] text-[var(--c-text-3)] text-xs hover:bg-[var(--c-hover)] disabled:opacity-50">{busy ? '올리는 중…' : '📷 찍기 · 고르기'}</button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          </div>
          {note && <div className="text-xs text-[var(--c-text-2)] bg-[var(--c-subtle)] rounded-lg px-3 py-2">손님에게 보이는 줄: <span className="font-medium text-[var(--c-text-1)]">{note}</span></div>}
        </div>
        <div className="px-5 py-4 border-t border-[var(--c-border)] flex items-center gap-2">
          <button type="button" onClick={() => finish(false)} disabled={saving} className="text-xs text-[var(--c-text-3)] hover:text-[var(--c-text-1)] px-2 py-2">기록 없이 완료</button>
          <button type="button" onClick={() => finish(true)} disabled={saving || busy || (!note && photos.length === 0)} className="ml-auto bg-brand hover:bg-brand-dark disabled:opacity-40 text-white text-sm font-medium rounded-lg px-5 py-2">{saving ? '저장 중…' : '기록 남기고 완료'}</button>
        </div>
      </div>
    </div>
  );
}
