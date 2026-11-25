'use client';
/**
 * 딜러 상세의 "딜러 현황 페이지" 버튼 (2026-11-25): 보기(새 탭) · 링크 문자 · 링크 복사
 * 코드는 회원 페이지와 같은 member_links 표(딜러 id)로 만든다
 */
import { useState } from 'react';
import Btn from '@/components/ui/Btn';
import { getOrCreateMemberLink, logMemberSms } from '@/lib/member-links';
import { dealerPageUrl, dealerLinkSms } from '@/lib/dealer-page';
import { openSmsApp, confirmAfterSms } from '@/lib/crm-shared';
import { copyText } from '@/lib/device';

export default function DealerPageButtons({ dealerId, name, phone, onSent }: { dealerId: string; name: string; phone: string | null; onSent?: () => void }) {
  const [busy, setBusy] = useState(false);
  const link = async () => {
    const r = await getOrCreateMemberLink(dealerId);
    if ('error' in r) { alert(r.error); return null; }
    return dealerPageUrl(r.token);
  };
  const view = async () => { setBusy(true); const url = await link(); setBusy(false); if (url) window.open(url, '_blank'); };
  const send = async () => {
    if (!phone) { alert('딜러 전화번호가 없습니다'); return; }
    setBusy(true); const url = await link(); setBusy(false); if (!url) return;
    openSmsApp(phone, dealerLinkSms(name, url));
    if (await confirmAfterSms('딜러 현황 페이지 링크 문자를 보내셨나요?')) {
      await logMemberSms(dealerId, `[딜러 문자] 현황 페이지 링크\n${url}`);
      onSent?.();
    }
  };
  const copy = async () => { setBusy(true); const url = await link(); setBusy(false); if (url) { copyText(url); alert('링크를 복사했습니다'); } };
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Btn size="sm" variant="outline" icon="eye" onClick={view} disabled={busy}>현황 페이지</Btn>
      <Btn size="sm" variant="dark" icon="link" onClick={send} disabled={busy || !phone}>링크 문자</Btn>
      <Btn size="sm" variant="ghost" icon="copy" onClick={copy} disabled={busy}>복사</Btn>
    </div>
  );
}
