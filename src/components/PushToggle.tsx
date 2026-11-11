'use client';

import { useCallback, useEffect, useState } from 'react';

type State = 'unsupported' | 'checking' | 'off' | 'on' | 'denied' | 'busy';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * 🔔 글 완성 알림 켜기/끄기 (웹 푸시). 홈 화면에 설치한 앱·브라우저 모두 가능
 */
export default function PushToggle() {
  const [state, setState] = useState<State>('checking');
  const [msg, setMsg] = useState('');
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || !publicKey) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') { setState('denied'); return; }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    } catch {
      setState('off');
    }
  }, [publicKey]);

  useEffect(() => { refresh(); }, [refresh]);

  const enable = async () => {
    setState('busy');
    setMsg('');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); return; }
      await navigator.serviceWorker.register('/sw.js');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const res = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || '등록 실패'); await sub.unsubscribe(); setState('off'); return; }
      setState('on');
      setMsg('알림이 켜졌습니다. 글이 완성되면 이 기기로 알려드립니다.');
      // 연결 확인용 테스트 알림
      fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true }) }).catch(() => {});
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '알림 설정 실패');
      setState('off');
    }
  };

  const disable = async () => {
    setState('busy');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setMsg('알림을 껐습니다.');
    } catch { /* ignore */ }
    setState('off');
  };

  if (state === 'unsupported' || state === 'checking') return null;

  const label = state === 'on' ? '🔔 알림 켜짐' : state === 'denied' ? '🔕 알림 차단됨' : state === 'busy' ? '…' : '🔕 완성 알림 켜기';
  const title = state === 'denied' ? '브라우저 설정에서 이 사이트의 알림 권한을 허용으로 바꿔주세요' : state === 'on' ? '누르면 알림을 끕니다' : '글이 완성되면 이 기기로 알림을 보냅니다';

  return (
    <div className="relative">
      <button
        onClick={state === 'on' ? disable : enable}
        disabled={state === 'busy' || state === 'denied'}
        title={title}
        className={`text-[11px] rounded-lg px-2 py-1 whitespace-nowrap transition-colors ${state === 'on' ? 'bg-gold/15 text-gold' : 'bg-[var(--c-subtle)] text-[var(--c-text-3)] hover:text-[var(--c-text-1)]'} disabled:opacity-60`}
      >
        {label}
      </button>
      {msg && (
        <div className="absolute right-0 top-8 z-50 w-56 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg p-2 text-[11px] text-[var(--c-text-2)] shadow-xl" onClick={() => setMsg('')}>
          {msg}
        </div>
      )}
    </div>
  );
}
