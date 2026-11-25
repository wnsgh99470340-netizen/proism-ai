/**
 * 딜러 정산(미수) 표시 (2026-11-25 사장님 "딜러한테 비용 정산 받았는지 체크하는 기능, 딜러들이 미수가 좀 심해")
 * - 스키마 변경 없이 services.memo(JSON) 에 dealer_settlement 를 둔다
 * - 딜러가 넣어 준 차의 시공 기록은 표시가 없으면 '미수'다 (정산 받은 날을 적어야 '정산')
 * - 금액은 우리가 받을 금액(services.amount). 딜러가 손님께 안내한 금액은 다를 수 있으니(마진) 손님 페이지·딜러 페이지 어디에도 내려보내지 않는다
 */
export interface DealerSettlement { paid_at?: string | null; amount?: number | null; note?: string | null }

export interface SettleableService { id: string; service_date: string | null; service_type: string; amount: number | null; memo: string | null }

function parseMemo(memo: string | null | undefined): Record<string, unknown> {
  if (!memo) return {};
  try { const j = JSON.parse(memo); return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : {}; } catch { return {}; }
}

/** memo 에서 정산 표시를 읽는다. 없으면 null(= 미수) */
export function parseSettlement(memo: string | null | undefined): DealerSettlement | null {
  const j = parseMemo(memo);
  const s = j.dealer_settlement as DealerSettlement | undefined;
  return s && typeof s === 'object' ? s : null;
}

export const isSettled = (memo: string | null | undefined) => !!parseSettlement(memo)?.paid_at;

/** 정산 받음 표시를 넣은 새 memo. memo 가 JSON 이 아니면(옛 글자 메모) 그 글자는 note 로 보존 */
export function withSettlement(memo: string | null | undefined, s: DealerSettlement | null): string {
  const j = parseMemo(memo);
  if (!memo || Object.keys(j).length === 0) {
    if (memo && memo.trim() && !memo.trim().startsWith('{')) j.legacy_memo = memo;
  }
  if (s) j.dealer_settlement = s; else delete j.dealer_settlement;
  return JSON.stringify(j);
}

export interface SettlementSummary { unpaidCount: number; unpaidTotal: number; paidCount: number; paidTotal: number; unknownCount: number }
/** 딜러 한 명의 시공 기록 묶음 → 미수 건수·합계. 금액이 없는 기록은 unknown 으로 따로 센다(합계에 못 넣음) */
export function summarizeSettlement(services: SettleableService[]): SettlementSummary {
  const out: SettlementSummary = { unpaidCount: 0, unpaidTotal: 0, paidCount: 0, paidTotal: 0, unknownCount: 0 };
  for (const s of services) {
    const st = parseSettlement(s.memo);
    const amt = st?.amount ?? s.amount ?? null;
    if (st?.paid_at) { out.paidCount += 1; out.paidTotal += amt || 0; }
    else if (amt == null || amt <= 0) out.unknownCount += 1;
    else { out.unpaidCount += 1; out.unpaidTotal += amt; }
  }
  return out;
}

export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
