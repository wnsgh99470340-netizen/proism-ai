'use client';
import { useEffect, useState } from 'react';
import { copyText } from '@/lib/device';

/**
 * 기기 정보 (2026-11-23 사장님 "갤럭시에서 카톡·알림·복사 다 안 되는데?" — 제가 갤럭시 화면을 못 보니, 앱 안에서 상태를 보여 주고 캡처로 받는다)
 * 회원 탭 맨 아래 '기기 정보' 작은 글자로 연다. 개인정보 없음.
 */
type Row = [string, string];
export default function DeviceDiagModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [copyResult, setCopyResult] = useState<string>('');
  useEffect(() => {
    (async () => {
      const ua = navigator.userAgent;
      const browser = /SamsungBrowser/i.test(ua) ? '삼성 인터넷' : /KAKAOTALK/i.test(ua) ? '카카오톡 안 브라우저' : /NAVER\(/i.test(ua) ? '네이버 앱 안 브라우저' : /; wv\)/i.test(ua) ? '다른 앱 안 브라우저(웹뷰)' : /CriOS/i.test(ua) ? '아이폰 크롬' : /Chrome/i.test(ua) ? '크롬' : /Safari/i.test(ua) ? '사파리' : '알 수 없음';
      const os = /Android/i.test(ua) ? '안드로이드' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Macintosh/i.test(ua) ? '맥' : /Windows/i.test(ua) ? '윈도우' : '?';
      const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const notif = typeof Notification === 'undefined' ? '지원 안 함' : Notification.permission === 'granted' ? '허용됨' : Notification.permission === 'denied' ? '차단됨' : '아직 안 물어봄';
      const push = 'PushManager' in window ? '지원' : '지원 안 함';
      let sub = '없음';
      try { const reg = await navigator.serviceWorker?.getRegistration(); const s = await reg?.pushManager.getSubscription(); if (s) sub = `있음 (${new URL(s.endpoint).host})`; } catch { sub = '확인 실패'; }
      const sw = 'serviceWorker' in navigator ? ((await navigator.serviceWorker.getRegistration()) ? '등록됨' : '등록 안 됨') : '지원 안 함';
      const clip = typeof navigator.clipboard !== 'undefined' && navigator.clipboard !== null ? '지원' : '지원 안 함(폴백 사용)';
      const kakao = (window as Window & { Kakao?: { isInitialized?: () => boolean } }).Kakao ? ((window as Window & { Kakao?: { isInitialized?: () => boolean } }).Kakao?.isInitialized?.() ? '로드됨·준비됨' : '로드됨·초기화 안 됨') : '로드 안 됨';
      const share = 'share' in navigator ? '지원' : '지원 안 함';
      setRows([
        ['앱 버전', (process.env.NEXT_PUBLIC_BUILD_ID || '로컬').slice(0, 7)],
        ['기기·브라우저', `${os} · ${browser}`],
        ['홈 화면 앱으로 열림', standalone ? '예' : '아니오(브라우저 탭)'],
        ['알림 권한', notif],
        ['푸시 지원', push],
        ['이 기기의 알림 구독', sub],
        ['서비스워커', sw],
        ['복사 기능', clip],
        ['카카오 SDK', kakao],
        ['공유 기능', share],
        ['쿠키', navigator.cookieEnabled ? '켜짐' : '꺼짐'],
        ['화면', `${window.innerWidth}×${window.innerHeight}`],
      ]);
    })();
  }, []);
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-sm p-5 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[var(--c-text-1)] font-semibold text-base">기기 정보</h3>
          <button onClick={onClose} className="text-[var(--c-text-3)] hover:text-[var(--c-text-1)] text-lg leading-none">✕</button>
        </div>
        <p className="text-[11px] text-[var(--c-text-3)] mb-3">안 되는 게 있을 때 이 화면을 캡처해 보내 주세요. 개인정보는 없습니다.</p>
        <dl className="text-sm space-y-1.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-[var(--c-border)] pb-1.5">
              <dt className="text-[var(--c-text-3)] shrink-0">{k}</dt>
              <dd className="text-[var(--c-text-1)] text-right break-all">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex items-center gap-2">
          <button onClick={async () => setCopyResult((await copyText(text)) ? '복사됐습니다 ✓' : '복사 실패 ✕')} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[var(--c-text-1)] text-[var(--c-page)]">복사 시험</button>
          <span className="text-xs text-[var(--c-text-2)]">{copyResult}</span>
        </div>
      </div>
    </div>
  );
}
