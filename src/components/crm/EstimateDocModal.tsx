'use client';
/**
 * 견적서 만들기 (2026-11-26 사장님 "작업 견적서 받을 수 있을까요" 하는 손님 — 상담 기록 우측 상단 버튼).
 * 고객·차종·항목(시공 내용·제품·정상가·할인가)을 적으면 보증서와 같은 틀의 견적서 그림을 만든다.
 *  - PNG 저장 / 폰이면 이미지 공유(문자·카톡으로 바로) / 기록(상담 기록 "[견적서 발급] …")
 *  - 견적 문자 창의 "견적서로" 버튼이 폼 값을 그대로 넘겨 열 수도 있다
 */
import { useMemo, useRef, useState } from 'react';
import Btn from '@/components/ui/Btn';
import { supabase } from '@/lib/supabase';
import { todaySeoul, addDaysISO } from '@/lib/local-date';
import { formatPhoneInput } from '@/lib/phone';

export interface EstimateItem { name: string; product: string; normal: string; sale: string }
export interface EstimateInitial {
  customerId?: string | null;
  name?: string;
  phone?: string;
  car?: string;
  items?: Partial<EstimateItem>[];
  note?: string;
}

const won = (v: string | number) => { const n = Number(String(v).replace(/[^\d]/g, '')); return n ? `${n.toLocaleString()}원` : ''; };
const num = (v: string) => Number(String(v).replace(/[^\d]/g, '')) || 0;
const comma = (v: string) => (num(v) ? num(v).toLocaleString() : ''); // 입력 칸에 콤마 표시 (2026-11-26 사장님 "비용에 콤마")
const DEFAULT_NOTE = '차량 상태에 따라 금액이 조금 달라질 수 있습니다.';
const INSURER_NOTE = '상기 금액은 현장 확인 기준이며, 추가 손상 발견 시 재견적될 수 있습니다.';
const BIZ_KEY = 'crm_estimate_bizno_v1';

export default function EstimateDocModal({ initial, onClose, onDone }: { initial: EstimateInitial; onClose: () => void; onDone?: () => void }) {
  const today = todaySeoul();
  const [name, setName] = useState(initial.name || '');
  const [phone, setPhone] = useState(initial.phone || '');
  const [car, setCar] = useState(initial.car || '');
  // 두 가지 버전 (2026-11-26 사장님 "보험사에도 보낼 수 있도록"): 고객용은 단순하게, 보험사용은 견적 번호·유효기간·차량번호·사업자등록번호·공급가/부가세
  const [mode, setMode] = useState<'customer' | 'insurer'>('customer');
  const [validDays, setValidDays] = useState('30');
  const [plate, setPlate] = useState('');
  const [insurer, setInsurer] = useState('');      // 보험사·담당자
  const [claimNo, setClaimNo] = useState('');      // 사고 접수번호
  const [bizNo, setBizNo] = useState(() => { try { return localStorage.getItem(BIZ_KEY) || ''; } catch { return ''; } }); // 사업자등록번호 — 한 번 적으면 기억
  const [vatIncluded, setVatIncluded] = useState(true); // 적은 금액이 부가세 포함인지
  const [note, setNote] = useState(initial.note ?? DEFAULT_NOTE);
  const [items, setItems] = useState<EstimateItem[]>(() => {
    const given = (initial.items || []).filter((i) => (i.name || '').trim()).map((i) => ({ name: i.name || '', product: i.product || '', normal: i.normal || '', sale: i.sale || '' }));
    return given.length ? given : [{ name: '', product: '', normal: '', sale: '' }];
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const setItem = (i: number, patch: Partial<EstimateItem>) => setItems(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems([...items, { name: '', product: '', normal: '', sale: '' }]);
  const removeItem = (i: number) => setItems(items.length > 1 ? items.filter((_, k) => k !== i) : [{ name: '', product: '', normal: '', sale: '' }]);

  const rows = items.filter((i) => i.name.trim());
  const totals = useMemo(() => {
    const normal = rows.reduce((a, r) => a + num(r.normal), 0);
    const final = rows.reduce((a, r) => a + (num(r.sale) || num(r.normal)), 0);
    return { normal, final, discounted: rows.some((r) => num(r.sale) && num(r.sale) !== num(r.normal)) };
  }, [rows]);
  const validUntil = addDaysISO(today, Math.max(0, Number(validDays) || 0));
  const docNo = `EST-${today.replace(/-/g, '')}-${(phone.replace(/\D/g, '').slice(-4) || plate.replace(/\D/g, '').slice(-4) || '0000')}`;
  const insurerMode = mode === 'insurer';
  // 보험사용 금액 분해: 적은 금액이 부가세 포함이면 공급가 = 합계/1.1, 아니면 합계가 공급가이고 부가세를 얹는다
  const supply = vatIncluded ? Math.round(totals.final / 1.1) : totals.final;
  const vat = vatIncluded ? totals.final - supply : Math.round(totals.final * 0.1);
  const grand = vatIncluded ? totals.final : totals.final + vat;
  const switchMode = (m: 'customer' | 'insurer') => { setMode(m); setNote((cur) => (cur === DEFAULT_NOTE || cur === INSURER_NOTE || !cur.trim()) ? (m === 'insurer' ? INSURER_NOTE : DEFAULT_NOTE) : cur); };

  const render = async (): Promise<Blob | null> => {
    if (!printRef.current) return null;
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    return new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));
  };
  const fileName = () => `3M프로이즘_견적서_${name.trim() || car.trim() || '고객'}_${today}.png`;

  const log = async () => {
    const digits = phone.replace(/\D/g, '');
    let customerId: string | null = initial.customerId || null;
    if (!customerId && digits.length >= 10) {
      const formatted = digits.length === 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}` : phone.trim();
      const { data } = await supabase.from('customers').select('id').or(`phone.eq.${formatted},phone.eq.${digits}`).limit(1);
      customerId = (data && data[0]?.id as string) || null;
    }
    const who = `${name.trim() || '미등록'} ${phone.trim()}`.trim();
    const lines = rows.map((r) => `${r.name}${r.product ? ` (${r.product})` : ''} ${won(r.sale || r.normal)}`);
    await supabase.from('consultations').insert({
      customer_id: customerId,
      consultation_date: today,
      content: `[견적서 발급]${insurerMode ? ' (보험사용)' : ''}${customerId ? '' : ` ${who}`}\n${car}${plate.trim() ? ` ${plate.trim()}` : ''}${insurerMode && insurer.trim() ? ` · ${insurer.trim()}` : ''}\n${lines.join('\n')}\n합계 ${won(insurerMode ? grand : totals.final)}${insurerMode ? ` · ${docNo} · 유효 ${validUntil}` : ''}`,
      estimate: won(insurerMode ? grand : totals.final) || null,
      interested_services: rows.map((r) => r.name).join(', ').slice(0, 120) || null,
      memo: [customerId ? '' : who, car].filter(Boolean).join(' · ') || null,
    });
  };

  const check = () => {
    try { if (bizNo.trim()) localStorage.setItem(BIZ_KEY, bizNo.trim()); } catch { /* 무시 */ }
    if (!car.trim()) { setMsg('⚠️ 차종을 적어 주세요.'); return false; }
    if (insurerMode && !plate.trim()) { setMsg('⚠️ 보험사용은 차량번호가 필요합니다.'); return false; }
    if (rows.length === 0) { setMsg('⚠️ 시공 항목을 한 줄 이상 적어 주세요.'); return false; }
    return true;
  };

  const savePng = async () => {
    if (!check()) return;
    setBusy(true); setMsg(null);
    try {
      const blob = await render(); if (!blob) throw new Error('그림을 만들지 못했습니다');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = fileName(); a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      await log(); onDone?.();
      setMsg('견적서 PNG 를 저장했고 상담 기록에 남겼습니다.');
    } catch (e) { setMsg(`⚠️ ${e instanceof Error ? e.message : '실패'}`); } finally { setBusy(false); }
  };

  const share = async () => {
    if (!check()) return;
    setBusy(true); setMsg(null);
    try {
      const blob = await render(); if (!blob) throw new Error('그림을 만들지 못했습니다');
      const file = new File([blob], fileName(), { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
        await nav.share({ files: [file], text: `${name.trim() ? `${name.trim()} 고객님, ` : ''}요청하신 ${car} 견적서입니다.\n3M 프로이즘 강남서초점 010-7287-7140` });
        await log(); onDone?.();
        setMsg('견적서 이미지를 공유했고 상담 기록에 남겼습니다.');
      } else {
        await savePng();
        setMsg('이 기기는 이미지 공유가 안 되어 PNG 로 저장했습니다. 문자 앱에서 사진을 붙여 보내 주세요.');
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setMsg(`⚠️ ${e instanceof Error ? e.message : '실패'}`);
    } finally { setBusy(false); }
  };

  const input = 'w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[var(--c-text-1)]';
  const small = 'w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--c-text-1)] outline-none focus:border-[var(--c-text-1)]';
  const td: React.CSSProperties = { border: '1px solid #ddd', padding: '9px 12px', fontSize: '13px' };
  const th: React.CSSProperties = { ...td, backgroundColor: '#f5f5f5', fontWeight: 700, textAlign: 'left' };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-[var(--c-card)] w-full sm:max-w-2xl max-h-[92dvh] rounded-t-2xl sm:rounded-2xl border border-[var(--c-border)] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 sm:px-6 pt-4 pb-3 border-b border-[var(--c-border)]">
          <h2 className="text-base font-bold text-[var(--c-text-1)]">견적서 만들기</h2>
          <button type="button" onClick={onClose} className="text-[var(--c-text-3)] hover:text-[var(--c-text-1)] text-lg leading-none" aria-label="닫기">×</button>
        </div>

        <div className="overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
          <div className="inline-flex rounded-lg border border-[var(--c-border)] overflow-hidden text-xs font-semibold">
            {([['customer', '고객용'], ['insurer', '보험사용']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => switchMode(k)} className={`px-3 py-1.5 transition-colors ${mode === k ? 'bg-[var(--c-text-1)] text-[var(--c-card)]' : 'text-[var(--c-text-2)] hover:bg-[var(--c-subtle)]'}`}>{l}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs text-[var(--c-text-3)]">고객</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" className={input} /></label>
            <label className="block"><span className="text-xs text-[var(--c-text-3)]">전화</span><input value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))} placeholder="010-0000-0000" inputMode="tel" className={input} /></label>
            <label className="block"><span className="text-xs text-[var(--c-text-3)]">차종 *</span><input value={car} onChange={(e) => setCar(e.target.value)} placeholder="예: 벤츠 ML350" className={input} /></label>
            <label className="block"><span className="text-xs text-[var(--c-text-3)]">차량번호{insurerMode ? ' *' : ''}</span><input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="12가 3456" className={input} /></label>
            {insurerMode && (<>
              <label className="block"><span className="text-xs text-[var(--c-text-3)]">보험사 · 담당자</span><input value={insurer} onChange={(e) => setInsurer(e.target.value)} placeholder="예: ○○화재 홍길동 대리" className={input} /></label>
              <label className="block"><span className="text-xs text-[var(--c-text-3)]">사고 접수번호</span><input value={claimNo} onChange={(e) => setClaimNo(e.target.value)} placeholder="있으면" className={input} /></label>
              <label className="block"><span className="text-xs text-[var(--c-text-3)]">사업자등록번호 (한 번 적으면 기억)</span><input value={bizNo} onChange={(e) => setBizNo(e.target.value)} placeholder="000-00-00000" inputMode="numeric" className={input} /></label>
              <label className="block"><span className="text-xs text-[var(--c-text-3)]">유효기간 (일)</span><input value={validDays} onChange={(e) => setValidDays(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={input} /></label>
              <label className="col-span-2 flex items-center gap-2 text-xs text-[var(--c-text-2)]"><input type="checkbox" checked={vatIncluded} onChange={(e) => setVatIncluded(e.target.checked)} className="accent-brand" />적은 금액은 부가세 포함 (끄면 공급가액으로 보고 부가세 10%를 얹습니다)</label>
            </>)}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-[var(--c-text-3)]">시공 항목 *</span>
              <button type="button" onClick={addItem} className="text-xs text-[var(--c-text-2)] hover:text-[var(--c-text-1)]">＋ 항목 추가</button>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-2 items-start">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="시공 내용 (예: 그릴·범퍼 하단 카본 랩핑)" className={`${small} col-span-2 sm:col-span-1`} />
                    <input value={it.product} onChange={(e) => setItem(i, { product: e.target.value })} placeholder="제품 (예: 3M 2080 카본)" className={small} />
                    <input value={comma(it.normal)} onChange={(e) => setItem(i, { normal: e.target.value.replace(/[^\d]/g, '') })} placeholder={insurerMode ? '금액' : '정상가'} inputMode="numeric" className={small} />
                    {!insurerMode && <input value={comma(it.sale)} onChange={(e) => setItem(i, { sale: e.target.value.replace(/[^\d]/g, '') })} placeholder="할인가 (없으면 비움)" inputMode="numeric" className={small} />}
                  </div>
                  <button type="button" onClick={() => removeItem(i)} className="text-[var(--c-text-4)] hover:text-danger text-sm px-1 pt-1.5" aria-label="항목 삭제">✕</button>
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-[var(--c-text-2)] text-right">
              {insurerMode
                ? <>공급가액 {won(supply) || '0원'} · 부가세 {won(vat) || '0원'} · 합계 <span className="font-bold text-[var(--c-text-1)]">{won(grand) || '0원'}</span></>
                : <>{totals.discounted && <span className="line-through text-[var(--c-text-4)] mr-2">{won(totals.normal)}</span>}합계 <span className="font-bold text-[var(--c-text-1)]">{won(totals.final) || '0원'}</span></>}
            </div>
          </div>

          <label className="block"><span className="text-xs text-[var(--c-text-3)]">비고</span><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={`${input} resize-none`} /></label>
          {msg && <div className="text-xs text-[var(--c-text-2)]">{msg}</div>}
        </div>

        <div className="px-4 sm:px-6 py-3 border-t border-[var(--c-border)] flex flex-wrap justify-end gap-2">
          <Btn variant="ghost" onClick={onClose} className="mr-auto sm:mr-0">닫기</Btn>
          <Btn icon="download" onClick={savePng} disabled={busy}>PNG 저장</Btn>
          <Btn icon="share" variant="primary" onClick={share} disabled={busy} title="폰에서는 문자·카톡으로 바로 보냅니다">이미지로 보내기</Btn>
        </div>

        {/* 그림으로 만들 견적서 (화면 밖) — 보증서와 같은 틀 */}
        <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
          <div ref={printRef} style={{ width: '800px', backgroundColor: '#ffffff', fontFamily: 'sans-serif', color: '#111' }}>
            <div style={{ backgroundColor: '#E4002B', padding: '20px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#ffffff', letterSpacing: '2px', lineHeight: 1 }}>3M<br /><span style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '1px' }}>PROIZM</span></div>
                <div style={{ width: '1px', height: '36px', backgroundColor: 'rgba(255,255,255,0.3)' }} />
                <div style={{ fontSize: '26px', fontWeight: 700, color: '#ffffff', letterSpacing: '8px' }}>견적서</div>
              </div>
              <div style={{ color: '#ffffff', fontSize: '11px', textAlign: 'right', lineHeight: 1.6 }}>
                <div>3M Preferred Installer</div>
                <div>3M 프로이즘 강남서초점</div>
              </div>
            </div>
            <div style={{ padding: '28px 40px 36px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
                <tbody>
                  {insurerMode ? (<>
                    <tr><td style={{ ...th, width: '110px' }}>견적 번호</td><td style={td}>{docNo}</td><td style={{ ...th, width: '110px' }}>견적일</td><td style={td}>{today}</td></tr>
                    <tr><td style={th}>수신</td><td style={td}>{insurer.trim() || '-'}</td><td style={th}>유효기간</td><td style={td}>{validUntil} 까지</td></tr>
                    <tr><td style={th}>차량</td><td style={td}>{car.trim() || '-'}{plate.trim() ? ` · ${plate.trim()}` : ''}</td><td style={th}>접수번호</td><td style={td}>{claimNo.trim() || '-'}</td></tr>
                    <tr><td style={th}>차주</td><td style={td} colSpan={3}>{name.trim() || '-'}{phone.trim() ? ` · ${phone.trim()}` : ''}</td></tr>
                  </>) : (<>
                    <tr><td style={{ ...th, width: '110px' }}>고객</td><td style={td}>{name.trim() || '-'}{phone.trim() ? ` · ${phone.trim()}` : ''}</td><td style={{ ...th, width: '110px' }}>견적일</td><td style={td}>{today}</td></tr>
                    <tr><td style={th}>차종</td><td style={td} colSpan={3}>{car.trim() || '-'}{plate.trim() ? ` · ${plate.trim()}` : ''}</td></tr>
                  </>)}
                </tbody>
              </table>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '14px' }}>
                <thead>
                  {insurerMode
                    ? <tr><th style={th}>작업 내용</th><th style={{ ...th, width: '200px' }}>사용 제품</th><th style={{ ...th, width: '130px', textAlign: 'right' }}>금액</th></tr>
                    : <tr><th style={th}>시공 내용</th><th style={{ ...th, width: '170px' }}>제품</th><th style={{ ...th, width: '110px', textAlign: 'right' }}>정상가</th><th style={{ ...th, width: '110px', textAlign: 'right' }}>견적가</th></tr>}
                </thead>
                <tbody>
                  {rows.map((r, i) => insurerMode ? (
                    <tr key={i}>
                      <td style={td}>{r.name}</td>
                      <td style={td}>{r.product || '-'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{won(vatIncluded ? Math.round(num(r.normal) / 1.1) : num(r.normal)) || '-'}</td>
                    </tr>
                  ) : (
                    <tr key={i}>
                      <td style={td}>{r.name}</td>
                      <td style={td}>{r.product || '-'}</td>
                      <td style={{ ...td, textAlign: 'right', color: num(r.sale) && num(r.sale) !== num(r.normal) ? '#999' : '#111', textDecoration: num(r.sale) && num(r.sale) !== num(r.normal) ? 'line-through' : 'none' }}>{won(r.normal) || '-'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{won(r.sale || r.normal) || '-'}</td>
                    </tr>
                  ))}
                  {insurerMode ? (<>
                    <tr><td style={{ ...th, textAlign: 'right' }} colSpan={2}>공급가액</td><td style={{ ...td, textAlign: 'right' }}>{won(supply) || '-'}</td></tr>
                    <tr><td style={{ ...th, textAlign: 'right' }} colSpan={2}>부가세 (10%)</td><td style={{ ...td, textAlign: 'right' }}>{won(vat) || '-'}</td></tr>
                    <tr><td style={{ ...th, textAlign: 'right' }} colSpan={2}>합계</td><td style={{ ...td, textAlign: 'right', fontWeight: 800, fontSize: '16px', color: '#E4002B' }}>{won(grand) || '-'}</td></tr>
                  </>) : (
                    <tr>
                      <td style={{ ...th, textAlign: 'right' }} colSpan={3}>합계</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 800, fontSize: '16px', color: '#E4002B' }}>{won(totals.final) || '-'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {note.trim() && <div style={{ fontSize: '12px', color: '#555', whiteSpace: 'pre-wrap', lineHeight: 1.7, marginBottom: '22px' }}>{note.trim()}</div>}
              <div style={{ borderTop: '1px solid #e5e5e5', paddingTop: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div style={{ fontSize: '11px', color: '#777', lineHeight: 1.7 }}>
                  <div>3M 프로이즘 강남서초점 · 대표 진준호{insurerMode && bizNo.trim() ? ` · 사업자등록번호 ${bizNo.trim()}` : ''}</div>
                  <div>서울특별시 서초구 서초중앙로8길 82 1동 1층 1호 · 010-7287-7140</div>
                  <div>blog.naver.com/roice_</div>
                </div>
                <div style={{ fontSize: '11px', color: '#999' }}>{insurerMode ? `작성 ${today} · 3M 프로이즘 강남서초점 (인)` : 'PPF 2주 QC · 6개월 메인터넌스'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
