'use client';
/**
 * 고객 타임라인 카드 (2026-11-23): 고객 상세 맨 위. "앞으로"(예정·지난 할 일) + "지금까지"(최신 먼저)
 * 처음엔 최근 6줄만, "전체 N건" 으로 펼친다. 데이터는 buildTimeline(src/lib/timeline.ts)
 */
import { useState } from 'react';
import type { TimelineEvent, TimelineTone } from '@/lib/timeline';
import { supabase } from '@/lib/supabase';
import { confirmAfterSms, openSmsApp } from '@/lib/crm-shared';
import { REVIEW_SMS, followUpMessage, followUpSmsKey } from '@/config/sms-templates';
import Btn from '@/components/ui/Btn';

/** 후기 요청은 차 브랜드 게시판(BMW·아우디·그 외 프로이즘) — 예약 줄·사후관리 탭과 같은 문구 */
function reviewVariant(car: string | null | undefined): 'proism' | 'bmw' | 'audi' {
  const c = car || '';
  if (/bmw|비엠더블유|미니/i.test(c)) return 'bmw';
  if (/아우디|audi/i.test(c)) return 'audi';
  return 'proism';
}

const DOT: Record<TimelineTone, string> = {
  normal: 'bg-[var(--c-text-2)]',
  ok: 'bg-ok',
  warn: 'bg-danger',
  muted: 'bg-[var(--c-border)]',
  future: 'bg-info',
};
const TEXT: Record<TimelineTone, string> = {
  normal: 'text-[var(--c-text-1)]',
  ok: 'text-[var(--c-text-1)]',
  warn: 'text-danger',
  muted: 'text-[var(--c-text-3)]',
  future: 'text-[var(--c-text-1)]',
};

const fmt = (iso: string, today: string) => {
  const y = iso.slice(0, 4), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
  return y === today.slice(0, 4) ? `${m}/${d}` : `${y}.${m}.${d}`;
};

interface SmsCtx { phone: string | null; car: string | null; onSent?: () => void }

/** '앞으로' 줄의 문자 버튼 (2026-11-28 사장님 "여기에 메인터넌스 문자 보내기 가능하게"): 사후관리 탭과 같은 문구·같은 보냄 표시(sms_sent) */
function SmsButton({ e, ctx }: { e: TimelineEvent; ctx: SmsCtx }) {
  const [busy, setBusy] = useState(false);
  if (!e.sms || !ctx.phone) return null;
  const { followUpId, type, memo, sent } = e.sms;
  const variant = type === '후기요청' ? reviewVariant(ctx.car) : null;
  const key = variant || followUpSmsKey(type);
  const msg = variant ? REVIEW_SMS[variant] : followUpMessage(type, memo);
  if (sent[key]) return <span className="text-[11px] text-ok whitespace-nowrap shrink-0 pt-1">✓ 문자 보냄</span>;
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      openSmsApp(ctx.phone!, msg);
      if (await confirmAfterSms('문자를 전송하셨나요?')) {
        const { error } = await supabase.from('follow_ups').update({ sms_sent: { ...sent, [key]: true } }).eq('id', followUpId);
        if (error) alert(`보낸 표시를 못 남겼습니다: ${error.message}`);
        ctx.onSent?.();
      }
    } finally { setBusy(false); }
  };
  return <Btn size="xs" variant="outline" icon="chat" onClick={send} disabled={busy} className="shrink-0">{busy ? '…' : '문자'}</Btn>;
}

function Row({ e, today, ctx }: { e: TimelineEvent; today: string; ctx?: SmsCtx }) {
  const rel = e.tone === 'future' || e.tone === 'warn' ? (() => { const days = Math.round((new Date(e.date + 'T00:00:00+09:00').getTime() - new Date(today + 'T00:00:00+09:00').getTime()) / 86400000); return days === 0 ? '오늘' : days > 0 ? `D-${days}` : `${-days}일 지남`; })() : null;
  return (
    <li className="relative pl-5 py-1.5 flex gap-2">
      <span className={`absolute left-0 top-[11px] w-2.5 h-2.5 rounded-full ring-2 ring-[var(--c-card)] ${DOT[e.tone]}`} />
      <span className="text-[11px] tabular-nums text-[var(--c-text-4)] min-w-11 shrink-0 pt-0.5">{fmt(e.date, today)}</span>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium break-keep ${TEXT[e.tone]}`}>
          {e.title}
          {rel && <span className={`ml-1.5 text-[11px] font-semibold whitespace-nowrap ${e.tone === 'warn' ? 'text-danger' : 'text-info'}`}>{rel}</span>}
        </div>
        {e.detail && <div className="text-xs text-[var(--c-text-3)] break-keep">{e.detail}</div>}
      </div>
      {ctx && <SmsButton e={e} ctx={ctx} />}
    </li>
  );
}

export default function CustomerTimeline({ upcoming, past, today, phone, car, onSent }: { upcoming: TimelineEvent[]; past: TimelineEvent[]; today: string; phone?: string | null; car?: string | null; onSent?: () => void }) {
  const ctx: SmsCtx = { phone: phone || null, car: car || null, onSent };
  const [open, setOpen] = useState(false);
  const LIMIT = 6;
  const shown = open ? past : past.slice(0, LIMIT);
  return (
    <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-[var(--c-text-3)]">이 손님과 있었던 일</div>
        <span className="text-[11px] text-[var(--c-text-4)]">{past.length}건{upcoming.length > 0 ? ` · 앞으로 ${upcoming.length}건` : ''}</span>
      </div>
      {upcoming.length > 0 && (
        <div className="mb-3 rounded-lg bg-[var(--c-subtle)] px-3 py-1.5">
          <div className="text-[11px] font-semibold text-[var(--c-text-3)] mb-0.5">앞으로</div>
          <ul className="relative before:absolute before:left-[4px] before:top-2 before:bottom-2 before:w-px before:bg-[var(--c-border)]">
            {upcoming.map((e, i) => <Row key={`u${i}`} e={e} today={today} ctx={ctx} />)}
          </ul>
        </div>
      )}
      {past.length === 0 ? (
        <div className="text-sm text-[var(--c-text-3)]">아직 기록이 없습니다</div>
      ) : (
        <ul className="relative before:absolute before:left-[4px] before:top-2 before:bottom-2 before:w-px before:bg-[var(--c-border)]">
          {shown.map((e, i) => <Row key={`p${i}`} e={e} today={today} />)}
        </ul>
      )}
      {past.length > LIMIT && (
        <button onClick={() => setOpen((v) => !v)} className="mt-2 text-xs font-medium text-[var(--c-text-2)] hover:text-[var(--c-text-1)] underline-offset-2 hover:underline">
          {open ? '접기' : `전체 ${past.length}건 보기`}
        </button>
      )}
    </div>
  );
}
