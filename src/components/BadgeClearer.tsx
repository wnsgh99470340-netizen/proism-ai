'use client';
import { useEffect } from 'react';

/**
 * 앱 아이콘 배지 지우기 (2026-11-26 사장님 "앱에 알림 1이 뜨는데 무슨 짓을 해도 안 사라져").
 * 안드로이드는 알림 창에 남아 있는 이 앱의 알림 수를 아이콘 배지로 보여 준다. 앱이 앞으로 올 때마다
 * ① 배지 API 가 있으면 지우고 ② 서비스워커에 남은 알림을 전부 닫게 한다. 받은 내용은 헤더 "받은 알림"에서 본다.
 */
export default function BadgeClearer() {
  useEffect(() => {
    const clear = async () => {
      if (document.visibilityState !== 'visible') return;
      try { await (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.(); } catch { /* 지원 안 함 */ }
      try {
        if (!('serviceWorker' in navigator)) return;
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return;
        const ns = await reg.getNotifications();
        ns.forEach((n) => n.close());
        reg.active?.postMessage({ type: 'clear-notifications' });
      } catch { /* 무시 */ }
    };
    const onVis = () => { if (document.visibilityState === 'visible') clear(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', clear);
    const t = setTimeout(clear, 1500);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', clear); clearTimeout(t); };
  }, []);
  return null;
}
