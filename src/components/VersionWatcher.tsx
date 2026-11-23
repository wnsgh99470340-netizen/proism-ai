'use client';
import { useEffect } from 'react';

/**
 * 새 배포 감지 (2026-11-23 사장님 "갤럭시는 아직 똑같은데" — 홈 화면 앱이 켜져 있는 동안 옛 코드를 계속 썼음)
 * 앱이 앞으로 올 때마다(최대 1분에 한 번) /api/version 을 읽어 이 화면이 만들어진 버전과 다르면 새로고침한다.
 * 입력 중인 창을 날리지 않도록 열린 모달(.fixed.inset-0)이 있으면 다음 기회로 미룬다.
 */
const MINE = process.env.NEXT_PUBLIC_BUILD_ID || '';
export default function VersionWatcher() {
  useEffect(() => {
    if (!MINE) return; // 로컬 개발
    let last = 0;
    const check = async () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 60_000) return;
      last = Date.now();
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        if (!r.ok) return;
        const { id } = (await r.json()) as { id: string | null };
        if (id && id !== MINE && !document.querySelector('.fixed.inset-0')) window.location.reload();
      } catch { /* 오프라인이면 다음에 */ }
    };
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', check);
    const t = setTimeout(check, 3000);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', check); clearTimeout(t); };
  }, []);
  return null;
}
