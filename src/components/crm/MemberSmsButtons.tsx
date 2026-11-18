'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { todaySeoul } from '@/lib/local-date';
import { MEMBERSHIP } from '@/config/membership';

/**
 * 회원 문자 버튼 (2026-11-18): 회원 페이지 목록과 고객 상세 멤버십 카드에서 같은 버튼
 * - 회원 안내 / 소개 안내 두 가지. 문자 앱을 열고, 보냈다고 하면 상담 기록에 "[회원 문자] ..." 한 줄 남김
 */
export function openSmsApp(phone: string, msg: string) {
  const p = phone.replace(/[^\d]/g, '');
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  window.open(isIOS ? `sms:${p}&body=${encodeURIComponent(msg)}` : `sms:${p}?body=${encodeURIComponent(msg)}`);
}

const TEMPLATES = [
  { key: 'member', label: '회원 안내', build: (n: string) => MEMBERSHIP.memberInfoSms(n) },
  { key: 'referral', label: '소개 안내', build: (n: string) => MEMBERSHIP.referralInviteSms(n) },
] as const;

export default function MemberSmsButtons({ customerId, name, phone, size = 'sm', onSent }: { customerId: string; name: string; phone: string | null; size?: 'sm' | 'xs'; onSent?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!phone) return <span className="text-[11px] text-[var(--c-text-4)]">전화 없음</span>;
  const cls = size === 'xs'
    ? 'text-[11px] font-medium px-2 py-0.5 rounded-full border border-[var(--c-border)] hover:bg-[var(--c-subtle)] text-[var(--c-text-1)] whitespace-nowrap disabled:opacity-50'
    : 'text-xs font-semibold px-3 py-1.5 rounded-full border border-[var(--c-border)] bg-[var(--c-card)] hover:bg-[var(--c-subtle)] text-[var(--c-text-1)] whitespace-nowrap disabled:opacity-50';
  const send = async (t: (typeof TEMPLATES)[number]) => {
    openSmsApp(phone, t.build(name));
    if (!confirm('문자를 전송하셨나요? (기록으로 남깁니다)')) return;
    setBusy(t.key);
    await supabase.from('consultations').insert({ customer_id: customerId, consultation_date: todaySeoul(), content: `[회원 문자] ${t.label}\n${t.build(name)}`, memo: '회원 문자' });
    setBusy(null);
    onSent?.();
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      {TEMPLATES.map((t) => <button key={t.key} disabled={!!busy} onClick={() => send(t)} className={cls} title={t.build(name)}>{busy === t.key ? '…' : `💬 ${t.label}`}</button>)}
    </span>
  );
}
