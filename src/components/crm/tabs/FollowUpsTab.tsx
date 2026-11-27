'use client';

/** 사후관리 탭 (2026-11-23 page.tsx 에서 분리 — 동작 변경 없음). 상태·핸들러는 page.tsx 에 있고 props 로 받는다 */
import type { Dispatch, SetStateAction } from 'react';
import { Icon } from '@/components/ui/icons';
import { supabase } from '@/lib/supabase';
import { confirmAfterSms, openSmsApp } from '@/lib/crm-shared';
import { copyText, shareTextOnPhone } from '@/lib/device';
import { QC_SMS, REVIEW_SMS, followUpMessage } from '@/config/sms-templates';
import { parseCareLog, stripCareLog } from '@/lib/care-log';
import { parseWorkOrder, workSummaryLines, publicPhotos, internalPhotos } from '@/lib/work-order';
import { isSkipped, closeQuoteAs, quoteCloseReason, QUOTE_CLOSE_REASONS } from '@/lib/followups';
import type { PickerCustomer } from '@/hooks/useCrmData';
import { type FollowUp, type Tab, RETOUCH_TYPE, formatDate } from '@/lib/crm-shared';

export type FollowUpFilter = 'all' | 'QC점검' | '메인터넌스' | '후기요청' | '견적재연락' | '견적마무리';

interface FollowUpsTabProps {
  today: string;
  followUps: FollowUp[];
  /** 유형 필터 적용 + 미처리 우선 정렬된 목록 (page.tsx 에서 계산) */
  filteredFollowUps: FollowUp[];
  allCustomers: PickerCustomer[];
  followUpFilter: FollowUpFilter;
  setFollowUpFilter: (v: FollowUpFilter) => void;
  followSearch: string;
  setFollowSearch: (v: string) => void;
  followDate: string;
  setFollowDate: (v: string) => void;
  followMonth: { y: number; m: number };
  setFollowMonth: Dispatch<SetStateAction<{ y: number; m: number }>>;
  showOverdue: boolean;
  setShowOverdue: Dispatch<SetStateAction<boolean>>;
  statsMonth: string;
  fetchFollowUps: () => void;
  fetchStats: (month: string) => void;
  customerHasWarranty: (customerId: string) => boolean;
  handleToggleFollowUp: (f: FollowUp) => void;
  handleReviewReceived: (f: FollowUp) => void;
  handleAddCustomerFromQuote: (who: string) => void;
  handleOpenWarrantyFromFollowUp: (f: FollowUp) => void;
  openCareBook: (f: FollowUp) => void;
  setActiveTab: (tab: Tab) => void;
}

export default function FollowUpsTab({
  today, followUps, filteredFollowUps, allCustomers,
  followUpFilter, setFollowUpFilter, followSearch, setFollowSearch, followDate, setFollowDate, followMonth, setFollowMonth, showOverdue, setShowOverdue,
  statsMonth, fetchFollowUps, fetchStats, customerHasWarranty,
  handleToggleFollowUp, handleReviewReceived, handleAddCustomerFromQuote, handleOpenWarrantyFromFollowUp, openCareBook, setActiveTab,
}: FollowUpsTabProps) {
  return (
    <div>
      {/* 상단 요약 카드 */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {([
          { label: '미처리', count: followUps.filter((f) => !f.is_completed).length, cls: 'text-danger' },
          { label: '3일 안', count: followUps.filter((f) => { if (f.is_completed) return false; const d = Math.ceil((new Date(f.scheduled_date).getTime() - new Date(today).getTime()) / 86400000); return d >= 0 && d <= 3; }).length, cls: 'text-warn' },
          { label: '처리완료', count: followUps.filter((f) => f.is_completed).length, cls: 'text-ok' },
        ]).map((s) => (
          <div key={s.label} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl px-4 py-3">
            <div className="text-xs text-[var(--c-text-3)] whitespace-nowrap">{s.label}</div>
            <div className={`text-2xl font-bold tabular-nums leading-tight mt-0.5 ${s.cls}`}>{s.count}<span className="text-xs font-normal text-[var(--c-text-3)] ml-1">건</span></div>
          </div>
        ))}
      </div>

      {/* 필터 버튼 (유형별) — 폰에서는 가로 스크롤, 글자 줄바꿈 없음 (2026-11-23 갤럭시 점검) */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto [scrollbar-width:none]">
        {([
          { key: 'all' as const, label: '전체', count: followUps.length, style: 'bg-gold/20 text-gold' },
          { key: 'QC점검' as const, label: 'QC', count: followUps.filter((f) => f.follow_up_type === 'QC점검').length, style: 'bg-info/20 text-info' },
          { key: '메인터넌스' as const, label: '메인터넌스', count: followUps.filter((f) => f.follow_up_type === '메인터넌스').length, style: 'bg-violet/20 text-violet' },
          { key: '후기요청' as const, label: '후기요청', count: followUps.filter((f) => f.follow_up_type === '후기요청').length, style: 'bg-warn/20 text-warn' },
          { key: '견적재연락' as const, label: '견적 재연락', count: followUps.filter((f) => f.follow_up_type === '견적재연락' || f.follow_up_type === '견적마무리').length, style: 'bg-gold/20 text-gold' },
        ]).map((f) => (
          <button
            key={f.key}
            onClick={() => setFollowUpFilter(f.key)}
            className={`text-sm px-3 py-1.5 rounded-full border transition-colors font-medium whitespace-nowrap shrink-0 ${
              followUpFilter === f.key
                ? 'bg-[var(--c-text-1)] text-[var(--c-card)] border-transparent'
                : 'bg-[var(--c-card)] text-[var(--c-text-2)] border-[var(--c-border)] hover:bg-[var(--c-subtle)]'
            }`}
          >
            {f.label}
            <span className={`ml-1.5 text-xs ${followUpFilter === f.key ? 'opacity-80' : 'text-[var(--c-text-4)]'}`}>{f.count}</span>
          </button>
        ))}
      </div>

      {/* 달력 + 검색 + 그날 목록 */}
      {(() => {
        const renderFollowUp = (f: FollowUp) => {
          const isQuote = f.follow_up_type === '견적재연락' || f.follow_up_type === '견적마무리';
          // 견적 재연락은 고객 등록이 없을 수 있어 메모 첫 줄("이름 전화 · 차종 시공")에서 전화를 읽는다
          const memoPhone = isQuote || f.follow_up_type === '입고안내' ? (f.memo || '').split('\n')[0].match(/01[016789]-?\d{3,4}-?\d{4}/)?.[0] : undefined;
          const arrivalToDealer = f.follow_up_type === '입고안내' && /\(딜러\)/.test((f.memo || '').split('\n')[0]); // 딜러가 넣어 준 차 → 딜러 번호로 (2026-11-23)
          const phone = (arrivalToDealer ? memoPhone : undefined) || f.customer?.phone || memoPhone;
          const quoteHead = isQuote ? (f.memo || '').split('\n')[0] : '';
          const quoteBody = isQuote ? (f.memo || '').split('\n').slice(1).join('\n') : '';
          const daysUntil = Math.ceil((new Date(f.scheduled_date).getTime() - new Date(today).getTime()) / 86400000);
          const isUrgent = !f.is_completed && daysUntil >= 0 && daysUntil <= 3;
          const isOverdue = !f.is_completed && f.scheduled_date < today;

          const smsQC = QC_SMS;
          const smsMaint = followUpMessage('메인터넌스', f.memo); // 회차 문구 (2026-11-22)
          const smsReviewProism = REVIEW_SMS.proism;
          const smsReviewBMW = REVIEW_SMS.bmw;
          const smsReviewAudi = REVIEW_SMS.audi;
          const sent = f.sms_sent || {};
          const markSent = async (key: string) => {
            const updated = { ...sent, [key]: true };
            await supabase.from('follow_ups').update({ sms_sent: updated }).eq('id', f.id);
            fetchFollowUps();
          };
          const sendSms = async (msg: string, key: string) => {
            if (!phone) return;
            openSmsApp(phone, msg);
            if (await confirmAfterSms('문자를 전송하셨나요?')) markSent(key);
          };
          const sendKakao = async (msg: string, key: string) => {
            if (!phone) return;
            // \n 리터럴을 실제 줄바꿈으로, 연속 줄바꿈 정리
            const cleanMsg = msg.replace(/\\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
            if (await shareTextOnPhone(cleanMsg)) {
              // 폰: 공유창에서 카카오톡을 골라 보냄
            } else if (window.Kakao?.isInitialized()) {
              try {
                window.Kakao.Share.sendDefault({
                  objectType: 'text',
                  text: cleanMsg,
                  link: { mobileWebUrl: 'https://blog.naver.com/roice_', webUrl: 'https://blog.naver.com/roice_' },
                  buttonTitle: '블로그 방문',
                });
              } catch {
                // SDK 에러 시 카카오톡 커스텀 URL scheme fallback
                const kakaoLink = `https://sharer.kakao.com/talk/friends/picker/link?url=${encodeURIComponent('https://blog.naver.com/roice_')}&text=${encodeURIComponent(cleanMsg)}`;
                window.open(kakaoLink, '_blank', 'width=480,height=600');
              }
            } else {
              copyText(cleanMsg);
              alert('카카오 SDK 로딩 중입니다. 문구가 복사되었으니 카톡에 직접 붙여넣기 해주세요.');
            }
            if (await confirmAfterSms('카톡을 전송하셨나요?')) markSent(key);
          };
          const copyMsg = async (msg: string) => {
            alert((await copyText(msg)) ? '문구가 복사되었습니다.' : '복사하지 못했습니다.');
          };

          const typeBadgeClass = f.follow_up_type === 'QC점검'
            ? 'bg-info/20 text-info'
            : f.follow_up_type === RETOUCH_TYPE
            ? 'bg-ok/20 text-ok'
            : f.follow_up_type === '후기요청'
              ? 'bg-warn/20 text-warn'
              : isQuote
                ? 'bg-gold/20 text-gold'
                : 'bg-violet/20 text-violet';

          const statusBadge = f.is_completed
            ? (isSkipped(f.memo) ? { text: '미방문', class: 'bg-[var(--c-hover)] text-[var(--c-text-3)]' } : quoteCloseReason(f.memo) ? { text: `종결 · ${quoteCloseReason(f.memo)}`, class: 'bg-[var(--c-hover)] text-[var(--c-text-3)]' } : /예약 잡혀 자동 정리/.test(f.memo || '') ? { text: '예약 잡힘', class: 'bg-ok/20 text-ok' } : { text: '처리완료', class: 'bg-ok/20 text-ok' })
            : isOverdue
              ? { text: `${Math.abs(daysUntil)}일 지남`, class: 'bg-danger/20 text-danger' }
              : isUrgent
                ? { text: daysUntil === 0 ? '오늘' : `D-${daysUntil}`, class: 'bg-warn/20 text-warn' }
                : { text: '미처리', class: 'bg-danger/15 text-danger' };

          const cardBorder = isOverdue
            ? 'border-danger/40'
            : isUrgent
              ? 'border-warn/40'
              : f.is_completed
                ? 'border-ok/20'
                : 'border-[var(--c-border)]';

          const sentBtn = 'bg-ok/15 text-ok';
          const qcBtn = phone ? (sent.qc ? sentBtn : 'bg-info/15 text-info hover:bg-info/25') : 'bg-[var(--c-subtle)] text-[var(--c-text-3)]/40 cursor-not-allowed';
          const maintBtn = phone ? (sent.maintenance ? sentBtn : 'bg-violet/15 text-violet hover:bg-violet/25') : 'bg-[var(--c-subtle)] text-[var(--c-text-3)]/40 cursor-not-allowed';
          const reviewBtn = (key: string) => phone ? (sent[key] ? sentBtn : 'bg-warn/15 text-warn hover:bg-warn/25') : 'bg-[var(--c-subtle)] text-[var(--c-text-3)]/40 cursor-not-allowed';

          return (
            <div
              key={f.id}
              className={`bg-[var(--c-card)] border rounded-xl p-4 ${cardBorder} ${isUrgent ? 'ring-1 ring-warn/20' : ''}`}
            >
              {/* 카드 상단: 유형 + 상태 뱃지 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${typeBadgeClass}`}>
                    {f.follow_up_type}
                  </span>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusBadge.class}`}>
                    {statusBadge.text}
                  </span>
                </div>
                <button
                  onClick={() => handleToggleFollowUp(f)}
                  className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors shrink-0 ${
                    f.is_completed
                      ? 'bg-ok border-ok text-white'
                      : 'border-[var(--c-text-4)] hover:border-gold'
                  }`}
                >
                  {f.is_completed && <span className="text-xs font-bold">✓</span>}
                </button>
              </div>

              {/* 카드 본문: 고객 정보 */}
              <div className="flex items-start justify-between mb-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--c-text-1)]">{f.customer?.name || '-'}</span>
                    {arrivalToDealer && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-info/15 text-info" title="딜러가 넣어 준 차 — 입고 안내는 딜러에게">→ 딜러 {(f.memo || '').split(' ')[0].replace('(딜러)', '')}</span>}
                    {phone && <span className="text-xs text-[var(--c-text-4)]">{phone}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--c-text-3)] flex-wrap">
                    <span className="bg-[var(--c-subtle)] px-2 py-0.5 rounded">{f.service?.service_type || '-'}</span>
                    {(f.customer?.car_brand || f.customer?.car_model) && <span className="text-[var(--c-text-2)]">{[f.customer?.car_brand, f.customer?.car_model].filter(Boolean).join(' ')}</span>}
                    <span>{formatDate(f.scheduled_date)}</span>
                    {f.scheduled_date === today && <span className="text-warn font-medium">(오늘)</span>}
                  </div>
                  {/* 작업 내역 (2026-11-26): 이 사후관리가 붙은 시공 기록의 작업 내역서 — 이름만 보고는 무슨 작업인지 기억이 안 나서 */}
                  {!isQuote && f.service && (() => {
                    const lines = workSummaryLines(f.service.memo, f.service);
                    const wo = parseWorkOrder(f.service.memo);
                    const extra = wo ? { note: (wo.field_note || '').trim(), notes: (wo.notes || '').trim(), photos: publicPhotos(wo, 12), inPhotos: internalPhotos(wo), plate: (wo.car_number || '').trim() } : null;
                    const hasExtra = !!extra && (!!extra.note || !!extra.notes || extra.photos.length > 0 || extra.inPhotos.length > 0);
                    if (lines.length === 0) return <div className="text-[11px] text-[var(--c-text-4)] mt-1">작업 내역서 없음{f.service.service_date ? ` · 시공 ${formatDate(f.service.service_date)}` : ''}</div>;
                    return (
                      <div className="mt-1.5 text-xs">
                        <div className="text-[11px] text-[var(--c-text-4)] mb-0.5">작업 내역{f.service.service_date ? ` · 시공 ${formatDate(f.service.service_date)}` : ''}{extra?.plate ? ` · ${extra.plate}` : ''}</div>
                        <ul className="space-y-0.5">{lines.map((l, i) => <li key={i} className="text-[var(--c-text-2)] leading-snug">{l}</li>)}</ul>
                        {hasExtra && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[var(--c-text-3)] text-[11px]">현장 메모·사진</summary>
                            {extra!.note && <div className="mt-1 text-[var(--c-text-2)] whitespace-pre-wrap">{extra!.note}</div>}
                            {extra!.notes && <div className="mt-1 text-[var(--c-text-3)] whitespace-pre-wrap">특이사항: {extra!.notes}</div>}
                            {extra!.inPhotos.length > 0 && <div className="mt-1.5"><div className="text-[11px] text-[var(--c-text-4)]">입고 상태(내부)</div><div className="flex gap-1.5 mt-0.5 flex-wrap">{extra!.inPhotos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="w-12 h-12 object-cover rounded-md border border-[var(--c-border)]" /></a>)}</div></div>}
                            {extra!.photos.length > 0 && <div className="mt-1.5"><div className="text-[11px] text-[var(--c-text-4)]">출고 사진</div><div className="flex gap-1.5 mt-0.5 flex-wrap">{extra!.photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="w-12 h-12 object-cover rounded-md border border-[var(--c-border)]" /></a>)}</div></div>}
                          </details>
                        )}
                      </div>
                    );
                  })()}
                  {f.memo && !isQuote && stripCareLog(f.memo) && <div className="text-xs text-[var(--c-text-4)] mt-1">{stripCareLog(f.memo)}</div>}
                  {(() => {
                    const log = parseCareLog(f.memo);
                    if (!log) return null;
                    return (
                      <div className="mt-1.5 rounded-lg bg-ok/10 px-2.5 py-1.5">
                        <div className="text-xs text-ok font-medium">점검 기록{log.date ? ` ${formatDate(log.date)}` : ''}{log.note ? ` · ${log.note}` : ''}</div>
                        {log.photos.length > 0 && <div className="flex gap-1.5 mt-1.5">{log.photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="w-12 h-12 object-cover rounded-md border border-[var(--c-border)]" /></a>)}</div>}
                      </div>
                    );
                  })()}
                  {isQuote && (
                    <div className="text-xs text-[var(--c-text-4)] mt-1">
                      {quoteHead}
                      <details className="mt-1"><summary className="cursor-pointer text-[var(--c-text-3)]">보낼 문자 보기</summary><pre className="whitespace-pre-wrap font-sans mt-1 text-[var(--c-text-2)]">{quoteBody}</pre></details>
                    </div>
                  )}
                </div>
              </div>

              {/* 카드 하단: 액션 버튼 */}
              <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-[var(--c-border)]">
                {f.follow_up_type === 'QC점검' && (
                  <>
                  <button onClick={() => sendKakao(smsQC, 'qc')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.qc ? sentBtn : 'bg-[#FEE500] text-[#191919] hover:bg-[#FDD835]'}`}>{sent.qc ? '✓ 카톡완료' : '카톡'}</button>
                  <button onClick={() => sendSms(smsQC, 'qc')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${qcBtn}`}>{sent.qc ? '✓ 문자완료' : '문자'}</button>
                  <button onClick={() => copyMsg(smsQC)} className="text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors bg-[var(--c-subtle)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)]">복사</button>
                  </>
                )}
                {f.follow_up_type === '메인터넌스' && (
                  <>
                  <button onClick={() => sendKakao(smsMaint, 'maintenance')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.maintenance ? sentBtn : 'bg-[#FEE500] text-[#191919] hover:bg-[#FDD835]'}`}>{sent.maintenance ? '✓ 카톡완료' : '카톡'}</button>
                  <button onClick={() => sendSms(smsMaint, 'maintenance')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${maintBtn}`}>{sent.maintenance ? '✓ 문자완료' : '문자'}</button>
                  <button onClick={() => copyMsg(smsMaint)} className="text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors bg-[var(--c-subtle)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)]">복사</button>
                  </>
                )}
                {f.follow_up_type === '후기요청' && (
                  <>
                  <button onClick={() => sendKakao(smsReviewProism, 'proism')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.proism ? sentBtn : 'bg-[#FEE500] text-[#191919] hover:bg-[#FDD835]'}`}>{sent.proism ? '✓ 프로이즘 카톡' : '프로이즘 카톡'}</button>
                  <button onClick={() => sendSms(smsReviewProism, 'proism')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${reviewBtn('proism')}`}>{sent.proism ? '✓ 프로이즘 문자' : '프로이즘 문자'}</button>
                  <button onClick={() => sendKakao(smsReviewBMW, 'bmw')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.bmw ? sentBtn : 'bg-[#FEE500] text-[#191919] hover:bg-[#FDD835]'}`}>{sent.bmw ? '✓ BMW 카톡' : 'BMW 카톡'}</button>
                  <button onClick={() => sendSms(smsReviewBMW, 'bmw')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${reviewBtn('bmw')}`}>{sent.bmw ? '✓ BMW 문자' : 'BMW 문자'}</button>
                  <button onClick={() => sendKakao(smsReviewAudi, 'audi')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.audi ? sentBtn : 'bg-[#FEE500] text-[#191919] hover:bg-[#FDD835]'}`}>{sent.audi ? '✓ 아우디 카톡' : '아우디 카톡'}</button>
                  <button onClick={() => sendSms(smsReviewAudi, 'audi')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${reviewBtn('audi')}`}>{sent.audi ? '✓ 아우디 문자' : '아우디 문자'}</button>
                  <button onClick={() => handleReviewReceived(f)} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${/후기 받음/.test(f.memo || '') ? 'bg-ok/15 text-ok' : 'bg-violet/15 text-violet hover:bg-violet/25'}`}>{/후기 받음/.test(f.memo || '') ? '✓ 후기 받음' : '후기 받음'}</button>
                  </>
                )}
                {isQuote && !f.customer_id && (
                  <button onClick={() => handleAddCustomerFromQuote(quoteHead)} className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-ok/15 hover:bg-ok/25 text-ok transition-colors">＋ 고객 목록에 추가</button>
                )}
                {f.follow_up_type === '입고안내' && (
                  <>
                  <button onClick={() => sendSms(followUpMessage('입고안내', f.memo), 'arrival')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.arrival ? sentBtn : 'bg-info/15 text-info hover:bg-info/25'}`}>{sent.arrival ? '✓ 문자완료' : '입고 안내 문자'}</button>
                  <button onClick={() => copyMsg(followUpMessage('입고안내', f.memo))} className="text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors bg-[var(--c-subtle)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)]">복사</button>
                  </>
                )}
                {isQuote && !f.is_completed && QUOTE_CLOSE_REASONS.map((r) => (
                  <button key={r} onClick={async () => { if (!confirm(`이 견적을 "${r}"(으)로 종결할까요? 재연락·마무리가 같이 닫힙니다.`)) return; await closeQuoteAs(f, r); fetchFollowUps(); fetchStats(statsMonth); }} className="text-[10px] font-medium px-2 py-1 rounded-lg bg-[var(--c-subtle)] text-[var(--c-text-3)] hover:bg-[var(--c-hover)]" title="견적 종결 — 월말 숫자에 사유별로 집계">{r}</button>
                ))}
                {isQuote && (
                  <>
                  <button onClick={() => sendSms(quoteBody, 'quote')} disabled={!phone} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${sent.quote ? sentBtn : 'bg-gold/20 text-gold hover:bg-gold/30'}`}>{sent.quote ? '✓ 문자완료' : (f.follow_up_type === '견적재연락' ? '재연락 문자' : '마무리 문자')}</button>
                  <button onClick={() => copyMsg(quoteBody)} className="text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors bg-[var(--c-subtle)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)]">복사</button>
                  </>
                )}
                {(f.follow_up_type === 'QC점검' || f.follow_up_type === '메인터넌스') && !f.is_completed && (
                  f.visit
                    ? <button onClick={() => { setActiveTab('appointments'); }} className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-info/15 text-info" title="예약/일정 달력에 잡힌 방문">📅 {f.visit.appointment_date.slice(5).replace('-', '/')} 방문</button>
                    : <button onClick={() => openCareBook(f)} className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-[var(--c-subtle)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)]" title="손님과 잡은 날짜로 달력 예약을 만듭니다">방문 잡기</button>
                )}
                <button
                  onClick={() => handleToggleFollowUp(f)}
                  className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ml-auto ${
                    f.is_completed
                      ? 'bg-ok/15 text-ok'
                      : 'bg-[var(--c-subtle)] text-[var(--c-text-2)] hover:bg-[var(--c-hover)]'
                  }`}
                >
                  {f.is_completed ? '✓ 완료됨' : '완료 처리'}
                </button>
                <button onClick={() => handleOpenWarrantyFromFollowUp(f)} className={`text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors ${customerHasWarranty(f.customer_id) ? 'bg-ok text-white' : 'bg-ok/10 hover:bg-ok/20 text-ok'}`}>{customerHasWarranty(f.customer_id) ? '✓ 보증서' : '보증서'}</button>
              </div>
            </div>
          );
        };

        const q = followSearch.trim().replace(/-/g, '');
        const matchQ = (f: FollowUp) => {
          if (!q) return true;
          const hay = `${f.customer?.name || ''} ${(f.customer?.phone || '').replace(/-/g, '')} ${(f.memo || '').replace(/-/g, '')}`;
          return hay.includes(q);
        };
        const base = filteredFollowUps;
        const searched = q ? base.filter(matchQ) : [];
        const dayList = base.filter((f) => f.scheduled_date === followDate);
        const overdue = base.filter((f) => !f.is_completed && f.scheduled_date < today);
        const countByDate: Record<string, number> = {};
        base.forEach((f) => { if (!f.is_completed && !f.visit) countByDate[f.scheduled_date] = (countByDate[f.scheduled_date] || 0) + 1; }); // 방문 잡힌 건은 문자 대상이 아니라 숫자에서 뺌 (2026-11-22)
        const visitsOnDay = base.filter((f) => !f.is_completed && f.visit && f.visit.appointment_date === followDate);
        // 달력 셀
        const first = new Date(followMonth.y, followMonth.m, 1);
        const startPad = first.getDay();
        const daysInMonth = new Date(followMonth.y, followMonth.m + 1, 0).getDate();
        const cells: (string | null)[] = [...Array(startPad).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${followMonth.y}-${String(followMonth.m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)];
        while (cells.length % 7) cells.push(null);
        const goMonth = (d: number) => setFollowMonth(({ y, m }) => { const nd = new Date(y, m + d, 1); return { y: nd.getFullYear(), m: nd.getMonth() }; });
        const pickDate = (iso: string) => { setFollowDate(iso); setFollowSearch(''); };
        const dateLabel = (iso: string) => { const d = new Date(iso + 'T00:00:00'); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${['일', '월', '화', '수', '목', '금', '토'][d.getDay()]}요일`; };

        return (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
              {/* 왼쪽: 검색 + 달력 */}
              <div className="space-y-3">
                <input
                  value={followSearch}
                  onChange={(e) => setFollowSearch(e.target.value)}
                  placeholder="고객 이름·전화번호로 찾기"
                  className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2.5 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50"
                />
                <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <button onClick={() => goMonth(-1)} className="w-8 h-8 rounded-full border border-[var(--c-border)] hover:bg-[var(--c-subtle)] flex items-center justify-center text-[var(--c-text-2)] text-base leading-none transition-colors" aria-label="이전 달">‹</button>
                    <div className="text-sm font-semibold text-[var(--c-text-1)]">{followMonth.y}년 {followMonth.m + 1}월</div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { const d = new Date(); setFollowMonth({ y: d.getFullYear(), m: d.getMonth() }); pickDate(today); }} className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-[var(--c-border)] text-[var(--c-text-2)] hover:bg-[var(--c-subtle)] transition-colors">오늘</button>
                      <button onClick={() => goMonth(1)} className="w-8 h-8 rounded-full border border-[var(--c-border)] hover:bg-[var(--c-subtle)] flex items-center justify-center text-[var(--c-text-2)] text-base leading-none transition-colors" aria-label="다음 달">›</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 text-center text-[10px] text-[var(--c-text-4)] mb-1">{['일', '월', '화', '수', '목', '금', '토'].map((w) => <div key={w}>{w}</div>)}</div>
                  <div className="grid grid-cols-7 gap-1">
                    {cells.map((iso, i) => {
                      if (!iso) return <div key={`e${i}`} />;
                      const n = countByDate[iso] || 0;
                      const sel = iso === followDate && !q;
                      const isToday = iso === today;
                      const past = iso < today;
                      return (
                        <button key={iso} onClick={() => pickDate(iso)}
                          className={`relative aspect-square rounded-lg text-xs flex flex-col items-center justify-center gap-0.5 transition-colors ${sel ? 'bg-[var(--c-subtle)] ring-1 ring-[var(--c-border)] text-[var(--c-text-1)] font-semibold' : 'hover:bg-[var(--c-hover)] text-[var(--c-text-2)]'}`}>
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center ${isToday ? 'bg-[var(--c-text-1)] text-[var(--c-card)] font-bold' : ''}`}>{Number(iso.slice(-2))}</span>
                          {n > 0 && <span className={`text-[9px] leading-none px-1.5 py-0.5 rounded-full ${past ? 'bg-danger/15 text-danger' : 'bg-info/15 text-info'}`}>{n}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-[10px] text-[var(--c-text-4)]">숫자 = 그날 보낼 미처리 건수 · 빨간 숫자 = 지난 건</div>
                </div>
              </div>

              {/* 오른쪽: 그날 목록 / 검색 결과 */}
              <div className="space-y-3 min-w-0">
                {q ? (
                  <>
                    <div className="text-sm text-[var(--c-text-2)]">"{followSearch.trim()}" 검색 결과 <span className="text-gold font-semibold">{searched.length}</span>건</div>
                    {searched.map(renderFollowUp)}
                    {searched.length === 0 && <div className="text-center py-12 text-sm text-[var(--c-text-3)]">일치하는 고객이 없습니다</div>}
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-[var(--c-text-1)]">{dateLabel(followDate)}{followDate === today ? ' (오늘)' : ''} <span className="text-gold">{dayList.filter((f) => !f.visit || f.is_completed).length}</span>건{visitsOnDay.length > 0 && <span className="ml-2 text-xs font-medium text-info">📅 방문 {visitsOnDay.length}건</span>}</div>
                    </div>
                    {dayList.map(renderFollowUp)}
                    {dayList.length === 0 && <div className="text-center py-10 text-sm text-[var(--c-text-3)]">이 날 보낼 사후관리 문자가 없습니다</div>}
                    {overdue.length > 0 && (
                      <div className="pt-2">
                        <button onClick={() => setShowOverdue((v) => !v)} className="w-full text-left text-xs font-medium px-3 py-2 rounded-xl border border-danger/30 bg-[var(--c-card)] text-danger hover:bg-danger/5">
                          {showOverdue ? '▾' : '▸'} 지난 미처리 {overdue.length}건 {showOverdue ? '접기' : '보기'}
                        </button>
                        {showOverdue && <div className="space-y-3 mt-3">{overdue.map(renderFollowUp)}</div>}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {/* 프로모션 발송 섹션 */}
      <div className="mt-6 bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5">
        <h3 className="text-base font-bold text-[var(--c-text-1)] mb-4">프로모션 문자</h3>
        {(() => {
          const month = new Date().getMonth() + 1;
          const promos = [
            { season: '봄', months: [3,4,5], label: '신차 시즌 패키지', tpl: (n: string) => `${n}님, 3M 프로이즘입니다. 봄 신차 출고 시즌 맞이 신차패키지 특별 할인 진행 중입니다. PPF+썬팅+코팅 풀패키지 문의주세요! 010-7287-7140` },
            { season: '여름', months: [6,7,8], label: '썬팅 시즌 할인', tpl: (n: string) => `${n}님, 3M 프로이즘입니다. 여름맞이 썬팅 특별가 진행 중입니다. 3M 크리스탈라인/루마 버텍스 시공 시 사이드미러 PPF 무료! 010-7287-7140` },
            { season: '가을', months: [9,10,11], label: '컬러 체인지 시즌', tpl: (n: string) => `${n}님, 3M 프로이즘입니다. 가을 랩핑/컬러PPF 시즌 할인 진행 중입니다. 3M 2080/PWF로 새로운 컬러 체험해보세요! 010-7287-7140` },
            { season: '겨울', months: [12,1,2], label: 'PPF 보호 시즌', tpl: (n: string) => `${n}님, 3M 프로이즘입니다. 겨울철 염화칼슘/비산먼지 대비 PPF 시공 특가 진행 중입니다. 프로200 풀랩 할인 문의주세요! 010-7287-7140` },
            { season: '연중', months: [1,2,3,4,5,6,7,8,9,10,11,12], label: '재방문 고객 혜택', tpl: (n: string) => `${n}님, 3M 프로이즘입니다. 기존 고객님 대상 재시공 10% 할인 혜택 드립니다. 추가 시공이나 메인터넌스 문의주세요! 010-7287-7140` },
          ];
          const activePromos = promos.filter((p) => p.months.includes(month));

          return (
            <div className="space-y-3">
              {activePromos.map((promo) => (
                <div key={promo.label} className="border border-[var(--c-border)] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-gold/20 text-gold px-2 py-0.5 rounded">{promo.season}</span>
                      <span className="text-sm text-[var(--c-text-1)] font-medium">{promo.label}</span>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--c-text-3)] mb-3 leading-relaxed">{promo.tpl('{고객명}')}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select id={`promo-cust-${promo.label}`} className="flex-1 min-w-[160px] bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--c-text-1)] outline-none">
                      <option value="">고객 선택</option>
                      {allCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>)}
                    </select>
                    {(() => {
                      const getPromoCustomer = () => {
                        const sel = document.getElementById(`promo-cust-${promo.label}`) as HTMLSelectElement;
                        const custId = sel?.value;
                        const cust = allCustomers.find((c) => c.id === custId);
                        if (!cust) { alert('고객을 선택해주세요.'); return null; }
                        return cust;
                      };
                      const trackPromo = (cust: { id: string; name: string }, msg: string) => {
                        fetch('/api/promotions', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ customer_id: cust.id, customer_name: cust.name, promotion_type: promo.label, message: msg }),
                        }).catch(() => {});
                      };
                      return (
                        <>
                          <button
                            onClick={async () => {
                              const cust = getPromoCustomer();
                              if (!cust) return;
                              const msg = promo.tpl(cust.name).replace(/\\n/g, '\n').trim();
                              if (await shareTextOnPhone(msg)) {
                                // 폰: 공유창에서 카카오톡을 골라 보냄
                              } else if (window.Kakao?.isInitialized()) {
                                try {
                                  window.Kakao.Share.sendDefault({
                                    objectType: 'text',
                                    text: msg,
                                    link: { mobileWebUrl: 'https://blog.naver.com/roice_', webUrl: 'https://blog.naver.com/roice_' },
                                    buttonTitle: '블로그 방문',
                                  });
                                } catch {
                                  const kakaoLink = `https://sharer.kakao.com/talk/friends/picker/link?url=${encodeURIComponent('https://blog.naver.com/roice_')}&text=${encodeURIComponent(msg)}`;
                                  window.open(kakaoLink, '_blank', 'width=480,height=600');
                                }
                              } else {
                                copyText(msg);
                                alert('카카오 SDK 로딩 중입니다. 문구가 복사되었으니 카톡에 직접 붙여넣기 해주세요.');
                              }
                              trackPromo(cust, msg);
                            }}
                            className="inline-flex items-center gap-1 text-xs bg-[#FEE500] hover:bg-[#FDD835] text-[#191919] font-semibold rounded-full px-3 py-1.5 transition-colors whitespace-nowrap"
                          >
                            <Icon name="kakao" size={13} />카톡
                          </button>
                          <button
                            onClick={() => {
                              const cust = getPromoCustomer();
                              if (!cust || !cust.phone) { if (cust) alert('전화번호가 없습니다.'); return; }
                              const msg = promo.tpl(cust.name);
                              openSmsApp(cust.phone, msg);
                              trackPromo(cust, msg);
                            }}
                            className="inline-flex items-center gap-1 text-xs bg-[var(--c-card)] text-[var(--c-text-1)] border border-[var(--c-border)] hover:bg-[var(--c-subtle)] font-semibold rounded-full px-3 py-1.5 transition-colors whitespace-nowrap"
                          >
                            <Icon name="chat" size={13} />문자
                          </button>
                          <button
                            onClick={() => {
                              const cust = getPromoCustomer();
                              if (!cust) return;
                              const msg = promo.tpl(cust.name);
                              copyText(msg);
                              trackPromo(cust, msg);
                              alert(`${cust.name}님 문구가 복사되었습니다.`);
                            }}
                            className="inline-flex items-center gap-1 text-xs bg-[var(--c-card)] text-[var(--c-text-1)] border border-[var(--c-border)] hover:bg-[var(--c-subtle)] font-semibold rounded-full px-3 py-1.5 transition-colors whitespace-nowrap"
                          >
                            <Icon name="copy" size={13} />복사
                          </button>
                        </>
                      );
                    })()}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
