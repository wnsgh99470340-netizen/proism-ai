import { buildOwnerStyle, getOwnerStyle } from '@/lib/owner-style';

export const maxDuration = 300;

/** GET /api/style — 현재 기준 요약 */
export async function GET() {
  const s = await getOwnerStyle();
  if (!s) return Response.json({ style: null });
  return Response.json({ style: { builtAt: s.builtAt, postCount: s.postCount, usedCount: s.usedTerms.length, unusedCount: s.unusedTerms.length, sampleTitles: s.sampleTitles, card: s.card, usedTerms: s.usedTerms.slice(0, 40).map(t => t.term), unusedTerms: s.unusedTerms } });
}

/** POST /api/style — 사장님 글 전체에서 기준 다시 만들기 */
export async function POST() {
  try {
    const s = await buildOwnerStyle();
    return Response.json({ ok: true, builtAt: s.builtAt, postCount: s.postCount, usedCount: s.usedTerms.length, unusedCount: s.unusedTerms.length, card: s.card });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '알 수 없는 오류' }, { status: 500 });
  }
}
