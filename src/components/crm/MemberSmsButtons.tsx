'use client';

import Btn from '@/components/ui/Btn';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { confirmAfterSms, openSmsApp } from '@/lib/crm-shared';
import { todaySeoul } from '@/lib/local-date';
import { getOrCreateMemberLink, memberLinkSms, logMemberSms } from '@/lib/member-links';
import { checkMemberReady, memberBlockMessage } from '@/lib/member-ready';
import { isCustomerMember } from '@/lib/membership-flag';
import { shareTextOnPhone, copyText } from '@/lib/device';

/**
 * 회원 문자 버튼 (2026-11-18): 회원 페이지 목록과 고객 상세 멤버십 카드에서 같은 버튼
 * - 2026-11-25부터 문자는 한 통(회원 등록·QC/메인터넌스·회원 페이지 링크·소개 안내 = memberLinkSms). 보냈다고 하면 상담 기록에 "[회원 문자] 회원 페이지 링크" 한 줄
 */
export { openSmsApp };

export default function MemberSmsButtons({ customerId, name, phone, size = 'sm', onSent }: { customerId: string; name: string; phone: string | null; size?: 'sm' | 'xs'; onSent?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!phone) return <span className="text-[11px] text-[var(--c-text-4)]">전화 없음</span>;
  const bs = size === 'xs' ? 'xs' : 'sm';
  // 손님용 회원 페이지 링크 (2026-11-18): 개인 링크를 만들어(없으면) 문자로 보내고 주소도 복사
  const sendLink = async () => {
    setBusy('link');
    const missing = await checkMemberReady(customerId); // 성함·전화·차종·작업 중 하나라도 없으면 안 보냄 (2026-11-23)
    if (missing.length > 0) { setBusy(null); alert(memberBlockMessage(missing)); return; }
    if (!(await isCustomerMember(customerId))) { setBusy(null); alert('아직 회원이 아닙니다. 고객 상세의 "회원 등록"을 먼저 눌러 주세요.'); return; } // 2026-11-26 사장님이 등록한 분만
    const r = await getOrCreateMemberLink(customerId);
    setBusy(null);
    if ('error' in r) { alert(r.error); return; }
    try { await navigator.clipboard?.writeText(r.url); } catch { /* 복사 실패는 무시 */ }
    openSmsApp(phone, memberLinkSms(name, r.url));
    if (!(await confirmAfterSms('회원 페이지 링크 문자를 전송하셨나요? (기록으로 남깁니다. 주소는 복사해 두었습니다)'))) return;
    await logMemberSms(customerId, `[회원 문자] 회원 페이지 링크\n${r.url}`);
    onSent?.();
  };
  // 링크를 카톡으로 (2026-11-23 사장님 "링크 카톡도 가능해?"): 폰이면 기기 공유창에서 카카오톡을 고르고, PC 면 글을 복사해 붙여 넣게
  const sendLinkKakao = async () => {
    setBusy('kakao');
    const missing = await checkMemberReady(customerId);
    if (missing.length > 0) { setBusy(null); alert(memberBlockMessage(missing)); return; }
    if (!(await isCustomerMember(customerId))) { setBusy(null); alert('아직 회원이 아닙니다. 고객 상세의 "회원 등록"을 먼저 눌러 주세요.'); return; }
    const r = await getOrCreateMemberLink(customerId);
    setBusy(null);
    if ('error' in r) { alert(r.error); return; }
    const text = memberLinkSms(name, r.url);
    if (await shareTextOnPhone(text)) {
      if (!(await confirmAfterSms('카톡으로 보내셨나요? (기록으로 남깁니다)'))) return;
    } else {
      if (!(await copyText(text))) { alert('복사하지 못했습니다.'); return; }
      if (!confirm('문구를 복사했습니다. 카카오톡에 붙여 넣어 보낸 뒤 확인을 누르면 기록으로 남깁니다.')) return;
    }
    await logMemberSms(customerId, `[회원 문자] 회원 페이지 링크 (카톡)\n${r.url}`);
    onSent?.();
  };
  // 사장님이 손님 화면을 그대로 열어 보기 (2026-11-19): 로그인된 기기는 뒷자리 없이 열린다 (API 가 crm_auth 쿠키로 확인)
  const openPage = async () => {
    setBusy('open');
    const r = await getOrCreateMemberLink(customerId);
    setBusy(null);
    if ('error' in r) { alert(r.error); return; }
    window.open(`/m/${r.token}`, '_blank', 'noopener');
  };
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <Btn size={bs} icon="eye" disabled={!!busy} onClick={openPage} title="손님이 보는 회원 페이지를 그대로 엽니다 (로그인된 기기는 뒷자리 없이 열림)">{busy === 'open' ? '…' : '회원 페이지'}</Btn>
      <Btn size={bs} icon="link" disabled={!!busy} onClick={sendLink} title="회원 등록 안내 + QC·메인터넌스 + 회원 페이지 링크 + 소개 안내를 문자 한 통으로">{busy === 'link' ? '…' : '회원 문자'}</Btn>
      <Btn size={bs} icon="kakao" variant="kakao" disabled={!!busy} onClick={sendLinkKakao} title="같은 내용을 카카오톡으로 (폰: 공유창에서 카카오톡 선택)">{busy === 'kakao' ? '…' : '회원 카톡'}</Btn>
    </span>
  );
}
