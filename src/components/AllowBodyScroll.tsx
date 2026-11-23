'use client';
import { useEffect } from 'react';

/** 전체 앱은 body 스크롤을 막아 두었다(CRM 레이아웃). 보증서·견적·로그인처럼 자기 스크롤 영역이 없는 긴 페이지에서만 body 스크롤을 다시 켠다 (2026-11-23, 명함 페이지에서 폰 스크롤이 안 되던 것과 같은 원인) */
export default function AllowBodyScroll() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'auto';
    return () => { document.body.style.overflow = prev; };
  }, []);
  return null;
}
