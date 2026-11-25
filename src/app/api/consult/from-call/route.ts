import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { todaySeoul } from '@/lib/local-date';
import { analyzeImageWithClaude } from '@/lib/claude-client';
import { isBlacklisted } from '@/lib/blacklist';
import { isRetiredDealer } from '@/lib/dealers';
import { guessKind, guessService, splitSavedName, suggestFollowUp, isDuplicateCall, type ExtractedCall, type CallKind } from '@/lib/call-summary';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/consult/from-call — 통화 요약 캡처 1단계 (2026-11-25)
 * body: { data: base64, mediaType }
 * 캡처에서 통화들을 뽑고 고객·딜러·블랙리스트·기존 기록과 맞춘 후보 표를 돌려준다. 저장은 화면에서 사장님이 확인한 뒤. 예약은 만들지 않는다.
 */
const PROMPT = (year: string) => `이 이미지는 갤럭시 전화 앱의 "최근 기록"과 AI 통화 요약 캡처입니다. 보이는 통화를 전부 뽑아 JSON 하나로만 답하세요.
- 왼쪽 목록의 각 줄과 오른쪽 상세(제목·날짜·수신/발신·길이·요지·할 일 제안)를 같은 통화끼리 묶으세요. 상세가 없는 줄도 목록만으로 넣되 요지는 비웁니다.
- savedName: 전화 앱에 저장된 이름 그대로(예 "이명호 현대 그랜저", "벤츠 송파 윤성혁"). 이름이 없고 번호만 보이면 번호를 적고 phone 에도 넣으세요.
- phone: 보이면 010-0000-0000 꼴. date: "11. 23 (월)" 같은 날짜를 ${year}-MM-DD 로. time: "오후 5:04" → "17:04". direction: 수신/발신/부재중. duration: "1분 7초" 그대로.
- title: 요약 제목. bullets: 요지 불릿을 짧게(돈·개인 사정도 사실대로, 지어내지 않기). todo: "할 일 제안"이 있으면 {text, date(${year}-MM-DD)}.
- 설명 문장 없이 JSON 만: {"calls":[{"savedName":"","phone":null,"date":null,"time":null,"direction":"","duration":null,"title":"","bullets":[],"todo":null}]}`;

export async function POST(request: NextRequest) {
  try {
    const { data, mediaType } = (await request.json()) as { data?: string; mediaType?: string };
    if (!data || !mediaType || !/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) return Response.json({ error: '이미지 파일만 올릴 수 있습니다.' }, { status: 400 });
    if (Buffer.from(data, 'base64').length > 4 * 1024 * 1024) return Response.json({ error: '4MB 이하 이미지만 올릴 수 있습니다.' }, { status: 400 });
    const today = todaySeoul();
    const raw = await analyzeImageWithClaude(data, mediaType, PROMPT(today.slice(0, 4)), 8000, 'claude-sonnet-5-5');
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return Response.json({ error: '통화 요약을 읽지 못했습니다' }, { status: 500 });
    let j: { calls?: Partial<ExtractedCall>[] } = {};
    try { j = JSON.parse(m[0]); } catch { const i = m[0].lastIndexOf('},'); if (i > 0) j = JSON.parse(m[0].slice(0, i + 1) + ']}'); }
    const calls: ExtractedCall[] = (j.calls || []).filter((c) => c && (c.savedName || c.phone)).map((c) => ({
      savedName: String(c.savedName || c.phone || '').trim(),
      phone: c.phone ? String(c.phone).replace(/\D/g, '').replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3') : null,
      date: c.date && /^\d{4}-\d{2}-\d{2}$/.test(String(c.date)) ? String(c.date) : today,
      time: c.time ? String(c.time).trim() : null,
      direction: (['수신', '발신', '부재중'].includes(String(c.direction)) ? String(c.direction) : '') as ExtractedCall['direction'],
      duration: c.duration ? String(c.duration).trim() : null,
      title: String(c.title || '').trim(),
      bullets: Array.isArray(c.bullets) ? c.bullets.map((b) => String(b).trim()).filter(Boolean) : [],
      todo: c.todo && typeof c.todo === 'object' && (c.todo as { text?: string }).text ? { text: String((c.todo as { text: string }).text), date: /^\d{4}-\d{2}-\d{2}$/.test(String((c.todo as { date?: string }).date || '')) ? String((c.todo as { date: string }).date) : null } : null,
    }));
    // 상세 머리글에서 잘린 이름("벤…")은 같은 캡처 목록의 온전한 이름으로 (2026-11-25 첫 시험: 15:02 통화가 "벤…"으로 읽혀 윤성혁 팀장과 못 맞춤)
    for (const c of calls) {
      const m = c.savedName.match(/^(.+?)(…|\.\.\.)$/);
      if (!m) continue;
      const full = calls.find((o) => o !== c && !/(…|\.\.\.)$/.test(o.savedName) && o.savedName.startsWith(m[1]));
      if (full) { c.savedName = full.savedName; if (!c.phone && full.phone) c.phone = full.phone; }
    }
    if (calls.length === 0) return Response.json({ rows: [], note: '읽은 통화가 없습니다' });

    // 맞추기 재료
    const [{ data: customers }, { data: cons }] = await Promise.all([
      supabase.from('customers').select('id, name, phone, car_brand, car_model, kind, memo'),
      supabase.from('consultations').select('customer_id, consultation_date, content, memo').gte('consultation_date', calls.map((c) => c.date!).sort()[0]),
    ]);
    const all = (customers || []) as { id: string; name: string; phone: string | null; car_brand: string | null; car_model: string | null; kind: string | null; memo: string | null }[];
    const digits = (p: string | null | undefined) => (p || '').replace(/\D/g, '');
    const rows = [];
    for (const c of calls) {
      const sp = splitSavedName(c.savedName);
      const d = digits(c.phone);
      let match = d.length >= 10 ? all.find((x) => digits(x.phone) === d) || null : null;
      let matchBy: 'phone' | 'name' | null = match ? 'phone' : null;
      if (!match && sp.name) {
        const cands = all.filter((x) => x.name.split(' ')[0] === sp.name && !(x.kind === '딜러' && isRetiredDealer(x.memo)));
        const narrowed = sp.org ? cands.filter((x) => (x.memo || '').startsWith(sp.org!)) : cands;
        if (narrowed.length === 1) { match = narrowed[0]; matchBy = 'name'; }
        else if (cands.length === 1) { match = cands[0]; matchBy = 'name'; }
      }
      const isDealer = match?.kind === '딜러' || (!match && !!sp.org);
      const kind: CallKind = guessKind(c, isDealer);
      const phone = c.phone || match?.phone || null;
      // 이미 열린 재연락·앞 예약이 있으면 재연락을 제안하지 않는다
      let hasOpenQuote = false, hasUpcoming = false;
      if (match) {
        const [{ data: fu }, { data: ap }] = await Promise.all([
          supabase.from('follow_ups').select('id').eq('customer_id', match.id).in('follow_up_type', ['견적재연락', '견적마무리']).eq('is_completed', false).limit(1),
          supabase.from('appointments').select('id').eq('customer_id', match.id).gte('appointment_date', today).neq('status', '취소').limit(1),
        ]);
        hasOpenQuote = !!(fu && fu.length); hasUpcoming = !!(ap && ap.length);
      } else if (d.length >= 10) {
        const { data: fu } = await supabase.from('follow_ups').select('id, memo').in('follow_up_type', ['견적재연락', '견적마무리']).eq('is_completed', false).ilike('memo', `%${phone}%`).limit(1);
        hasOpenQuote = !!(fu && fu.length);
      }
      const sameDay = (cons || []).filter((x) => x.consultation_date === c.date && (match ? x.customer_id === match.id : d.length >= 10 && `${x.memo || ''} ${x.content || ''}`.replace(/\D/g, '').includes(d))).map((x) => (x.content as string) || '');
      rows.push({
        key: `${c.date}-${c.time}-${d || sp.name}`,
        call: c,
        name: match ? match.name : sp.name,
        phone,
        car: match ? [match.car_brand, match.car_model].filter(Boolean).join(' ') || sp.car : sp.car,
        org: sp.org,
        customerId: match?.id || null,
        customerKind: match?.kind || null,
        matchBy,
        blacklisted: match ? isBlacklisted(match.memo) : false,
        kind,
        service: guessService(`${c.savedName} ${c.title} ${c.bullets.join(' ')}`),
        duplicate: isDuplicateCall(sameDay, c),
        hasOpenQuote, hasUpcoming,
        followUpDate: suggestFollowUp(c, kind, today, hasOpenQuote, hasUpcoming),
      });
    }
    return Response.json({ rows, today });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '읽기 실패' }, { status: 500 });
  }
}
