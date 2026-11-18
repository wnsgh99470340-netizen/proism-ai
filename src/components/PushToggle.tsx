'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
  const [why, setWhy] = useState('');
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

  // 기기별 안내 (2026-11-18 사장님: 갤럭시에서 알림 설정이 안 됨 → 왜 안 되는지와 어디를 켜야 하는지 보여 준다)
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isSamsung = /SamsungBrowser/i.test(ua);
  const browserName = isSamsung ? '삼성 인터넷' : /Chrome/i.test(ua) ? 'Chrome' : /Safari/i.test(ua) ? 'Safari' : '브라우저';
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const androidHelp = `갤럭시에서 켜는 법: ① 폰 설정 → 애플리케이션 → ${browserName} → 알림 → 허용 ② ${browserName}에서 이 사이트 주소창의 자물쇠(또는 ⋮ 메뉴 → 설정 → 사이트 설정) → 알림 → 허용 ③ 다시 이 버튼. 삼성 인터넷은 설정 → 사이트 및 다운로드 → 알림도 켜져 있어야 합니다.`;
  const diag = () => `(${browserName}${standalone ? ' 홈 화면 앱' : ' 브라우저'} · 권한 ${typeof Notification === 'undefined' ? '없음' : Notification.permission})`;

  const synced = useRef(false);

  /** 구독을 서버에 (다시) 등록. 아이폰이 구독을 바꾸거나 서버가 만료로 지운 뒤에도 알림이 계속 오게 */
  const register = useCallback(async (sub: PushSubscription) => {
    const res = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '등록 실패');
  }, []);

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || !publicKey) {
      setWhy(!publicKey ? '알림 키가 설정되지 않았습니다' : !('serviceWorker' in navigator) ? '이 브라우저는 백그라운드 알림을 지원하지 않습니다' : !('PushManager' in window) ? (isIOS && !standalone ? '아이폰은 홈 화면에 추가한 앱에서만 알림이 됩니다. 공유 → 홈 화면에 추가 후 앱에서 켜 주세요' : `${browserName}에서는 푸시 알림을 지원하지 않습니다. Chrome 이나 삼성 인터넷으로 열어 주세요`) : '알림 기능이 없는 브라우저입니다');
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') { setState('denied'); return; }
    try {
      // 서비스워커가 아직 안 올라온 첫 화면에서도 기다렸다가 본다 (getRegistration 이 undefined 라 "꺼짐"으로 보이던 틈)
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) { await navigator.serviceWorker.register('/sw.js').catch(() => {}); reg = await navigator.serviceWorker.getRegistration(); }
      if (!reg) { setState('off'); return; }
      let sub = await reg.pushManager.getSubscription();
      // 2026-11-18 사장님 "알림이 지혼자 꺼짐": 권한은 허용인데 구독만 사라진 경우(아이폰이 구독을 지우거나 바꿈) → 묻지 않고 다시 구독
      if (!sub && Notification.permission === 'granted') {
        try {
          const ready = await navigator.serviceWorker.ready;
          sub = await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
        } catch { /* 자동 재구독이 안 되면 버튼으로 */ }
      }
      if (sub && !synced.current) {
        synced.current = true;
        register(sub).catch(() => {}); // 서버 쪽 기록을 매번 맞춰 둔다 (upsert)
      }
      setState(sub ? 'on' : 'off');
    } catch {
      setState('off');
    }
  }, [publicKey, register]);

  useEffect(() => {
    refresh();
    // 앱을 다시 앞으로 가져올 때마다 확인 (홈 화면 앱은 새로고침이 없어서)
    const onVis = () => { if (document.visibilityState === 'visible') { synced.current = false; refresh(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  const enable = async () => {
    setState('busy');
    setMsg('');
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'denied') { setState('denied'); setMsg(`이 사이트의 알림이 차단돼 있습니다. ${isAndroid ? androidHelp : '브라우저 설정 → 사이트 설정 → 알림에서 허용으로 바꾼 뒤 다시 눌러 주세요.'} ${diag()}`); return; }
      if (perm !== 'granted') { setState('off'); setMsg(`알림 허용 창이 뜨지 않았습니다. 전에 창을 닫은 적이 있으면 브라우저가 조용히 막습니다. ${isAndroid ? androidHelp : '주소창의 자물쇠 → 알림 → 허용으로 바꾼 뒤 다시 눌러 주세요.'} ${diag()}`); return; }
      await navigator.serviceWorker.register('/sw.js');
      const reg = await navigator.serviceWorker.ready;
      let sub: PushSubscription;
      try {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      } catch (err) {
        // 안드로이드에서 흔한 실패: 폰 설정에서 브라우저 알림 자체가 꺼져 있거나, 푸시 서비스 연결이 막힘
        const name = err instanceof Error ? err.name : '';
        const text = err instanceof Error ? err.message : String(err);
        setMsg(`구독을 만들지 못했습니다 (${name}: ${text}). ${isAndroid ? `폰 설정 → 애플리케이션 → ${browserName} → 알림이 꺼져 있으면 이 오류가 납니다. 켠 뒤 ${browserName}을 완전히 닫았다가 다시 열어 주세요.` : ''} ${diag()}`);
        setState('off');
        return;
      }
      try { await register(sub); } catch (err) { setMsg(err instanceof Error ? err.message : '등록 실패'); await sub.unsubscribe(); setState('off'); return; }
      synced.current = true;
      setState('on');
      setMsg('알림이 켜졌습니다. 글이 완성되면 이 기기로 알려드립니다.');
      // 연결 확인용 테스트 알림
      fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true }) }).catch(() => {});
    } catch (e) {
      setMsg(`${e instanceof Error ? e.message : '알림 설정 실패'} ${diag()}`);
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

  if (state === 'checking') return null;

  const label = state === 'on' ? '🔔 알림 켜짐' : state === 'denied' ? '🔕 알림 차단됨' : state === 'unsupported' ? '🔕 알림 안 됨' : state === 'busy' ? '…' : '🔕 완성 알림 켜기';
  const title = state === 'denied' ? '누르면 켜는 방법을 보여 줍니다' : state === 'unsupported' ? why : state === 'on' ? '누르면 알림을 끕니다' : '글이 완성되면 이 기기로 알림을 보냅니다';
  // 차단·미지원 상태에서도 누르면 이유와 켜는 방법을 보여 준다
  const explain = () => setMsg(`${state === 'unsupported' ? why : `이 사이트의 알림이 차단돼 있습니다. ${isAndroid ? androidHelp : '브라우저 설정 → 사이트 설정 → 알림에서 허용으로 바꾼 뒤 다시 눌러 주세요.'}`} ${diag()}`);

  return (
    <div className="relative">
      <button
        onClick={state === 'on' ? disable : state === 'denied' || state === 'unsupported' ? explain : enable}
        disabled={state === 'busy'}
        title={title}
        className={`text-[11px] rounded-lg px-2 py-1 whitespace-nowrap transition-colors ${state === 'on' ? 'bg-gold/15 text-gold' : 'bg-[var(--c-subtle)] text-[var(--c-text-3)] hover:text-[var(--c-text-1)]'} disabled:opacity-60`}
      >
        {label}
      </button>
      {msg && (
        <div className="absolute right-0 top-8 z-50 w-72 max-w-[calc(100vw-2rem)] bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg p-2.5 text-[11px] leading-relaxed text-[var(--c-text-2)] shadow-xl" onClick={() => setMsg('')}>
          {msg}
        </div>
      )}
    </div>
  );
}
