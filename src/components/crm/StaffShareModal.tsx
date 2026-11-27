'use client';

import { useEffect, useState } from 'react';
import Btn from '@/components/ui/Btn';
import { copyText } from '@/lib/device';
import { openSmsApp } from '@/lib/crm-shared';

/**
 * 직원 공유 창 (2026-11-27 사장님 "예약/일정 탭만 직원들이 볼 수 있게 공유")
 * - GET /api/staff/link 로 직원용 예약 페이지 주소를 받아 복사·문자로 보내기. 보내기 기록은 남기지 않음(손님 상담이 아님)
 */
export default function StaffShareModal({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<{ url: string; pinSet: boolean } | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/staff/link', { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || '주소를 못 받았습니다'); setInfo(j); })
      .catch((e) => setErr(e instanceof Error ? e.message : '주소를 못 받았습니다'));
  }, []);

  const sms = info ? `프로이즘 예약 일정입니다. 링크 열고 홈 화면에 추가하세요. 들어갈 때 번호 4자리는 사장님께. ${info.url}` : '';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[var(--c-text-1)]">직원 공유</h3>
        <p className="text-sm text-[var(--c-text-3)] mt-1">직원 폰에서 예약 일정만 보는 페이지입니다. 읽기 전용이고 전화번호·금액은 안 보입니다.</p>
        {err && <div className="text-sm text-danger mt-3">{err}</div>}
        {info && (
          <>
            <div className="mt-4 text-xs font-semibold text-[var(--c-text-3)]">링크</div>
            <div className="mt-1 text-sm break-all bg-[var(--c-subtle)] rounded-xl px-3 py-2.5 text-[var(--c-text-1)] select-all">{info.url}</div>
            {!info.pinSet && <div className="mt-3 text-sm text-danger bg-danger/10 rounded-xl px-3 py-2">Vercel 에 STAFF_PIN 을 넣어야 열립니다</div>}
            <p className="text-xs text-[var(--c-text-3)] mt-3">들어갈 때 번호 4자리가 필요합니다. 번호는 직접 알려 주세요(문자에는 안 들어갑니다).</p>
          </>
        )}
        {!info && !err && <div className="text-sm text-[var(--c-text-3)] mt-4">불러오는 중…</div>}
        <div className="flex flex-wrap justify-end gap-2 mt-5">
          <Btn onClick={onClose}>닫기</Btn>
          <Btn icon="eye" disabled={!info} onClick={() => info && window.open(info.url, '_blank')}>열어 보기</Btn>
          <Btn icon="copy" disabled={!info} onClick={async () => { if (info && (await copyText(info.url))) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>{copied ? '복사됨' : '복사'}</Btn>
          <Btn icon="chat" variant="primary" disabled={!info} onClick={() => info && openSmsApp('', sms)}>문자로 보내기</Btn>
        </div>
      </div>
    </div>
  );
}
