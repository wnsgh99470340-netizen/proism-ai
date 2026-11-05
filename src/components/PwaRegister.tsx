'use client';

import { useEffect } from 'react';

/** 서비스워커 등록 (프로덕션에서만). 홈 화면 추가·오프라인 셸용 */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 등록 실패는 앱 동작에 영향 없음 */
    });
  }, []);
  return null;
}
