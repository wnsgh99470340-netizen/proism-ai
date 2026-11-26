// 발행본 vs 초안 대조 (2026-11-26 사장님 "우리 글이 얼마나 허접한지 알겠어?" → 매 글마다 살아남은 비율을 잰다)
//   node scripts/compare-published.mjs <logNo> <draftId>
// 네이버 모바일 페이지에서 발행 본문을 읽어 blog_posts 의 초안과 문장 단위로 비교한다.
// 출력: 살아남은 비율, 사장님이 지운 초안 문장, 사장님이 새로 쓴 문장 → docs/초안/발행비교-<logNo>-<날짜>.md 에 뼈대로 저장 (분석 문장은 사람이 붙인다)
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';

const [logNo, draftId] = process.argv.slice(2);
if (!logNo || !draftId) { console.error('사용: node scripts/compare-published.mjs <logNo> <draftId>'); process.exit(1); }
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const env = fs.readFileSync(`${ROOT}/.env.local`, 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
const sb = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('NEXT_PUBLIC_SUPABASE_ANON_KEY'));

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
async function fetchPublished(logNo) {
  const r = await fetch(`https://m.blog.naver.com/roice_/${logNo}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  const html = await r.text();
  const title = (html.match(/<title>([^<]*)<\/title>/)?.[1] || '').replace(/ : 네이버 블로그$/, '').trim();
  const start = html.indexOf('se-main-container');
  const section = start >= 0 ? html.slice(start) : html;
  let text = section.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t​]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  const cut = text.search(/이 블로그의 체크인|이 장소의 다른 글|공감한 사람|댓글 쓰기/);
  if (cut > 0) text = text.slice(0, cut).trim();
  text = text.replace(/^se-main-container">\s*/, '');
  const imgs = (section.match(/se-image-resource/g) || []).length;
  return { title, text, imgs };
}

// 문장 단위: 마침표가 있으면 마침표, 없으면(사장님 글) 빈 줄 사이 문단을 다시 어절로 이어 ~40자 토막으로
const norm = (s) => s.replace(/[\s.,!?~…·'"“”‘’()\-]/g, '');
function sentences(text) {
  const out = [];
  for (const para of text.split(/\n\s*\n/)) {
    const joined = para.split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
    if (!joined) continue;
    const parts = joined.split(/(?<=[.!?。])\s+|(?<=(?:니다|세요|어요|예요|이죠|거죠|습니다|합니다|입니다))\s+/).map((x) => x.trim()).filter((x) => norm(x).length >= 8);
    out.push(...parts);
  }
  return out;
}
const bigrams = (s) => { const n = norm(s); const set = new Set(); for (let i = 0; i < n.length - 1; i++) set.add(n.slice(i, i + 2)); return set; };
const dice = (a, b) => { const A = bigrams(a), B = bigrams(b); if (!A.size || !B.size) return 0; let hit = 0; for (const x of A) if (B.has(x)) hit++; return (2 * hit) / (A.size + B.size); };
const bestMatch = (s, pool) => { let best = 0; for (const p of pool) { const d = dice(s, p); if (d > best) best = d; } return best; };

const { data: draft } = await sb.from('blog_posts').select('id, title, body, created_at').eq('id', draftId).maybeSingle();
if (!draft) { console.error('초안을 못 찾음'); process.exit(1); }
const draftBody = draft.body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').trim();
const pub = await fetchPublished(logNo);
const dS = sentences(draftBody), pS = sentences(pub.text);
const KEEP = 0.72;
const kept = dS.filter((s) => bestMatch(s, pS) >= KEEP);
const removed = dS.filter((s) => bestMatch(s, pS) < KEEP);
const added = pS.filter((s) => bestMatch(s, dS) < KEEP);
const ratio = dS.length ? Math.round((kept.length / dS.length) * 100) : 0;
const len = (t) => t.replace(/\s/g, '').length;
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

const md = `# 발행본 vs 초안 대조 — ${pub.title} (${today})

- 발행: https://blog.naver.com/roice_/${logNo} · 사진 ${pub.imgs}장 · 공백 제외 ${len(pub.text).toLocaleString()}자
- 초안: ${draft.id} (${draft.created_at.slice(0, 10)}) "${draft.title}" · 공백 제외 ${len(draftBody).toLocaleString()}자
- **초안 문장 ${dS.length}개 중 ${kept.length}개 살아남음 = ${ratio}%** · 사장님이 지운 문장 ${removed.length} · 사장님이 새로 쓴 문장 ${added.length}
- 제목: 초안 "${draft.title}" → 발행 "${pub.title}"

## 사장님이 지운 초안 문장
${removed.map((s) => `- ${s}`).join('\n') || '- 없음'}

## 사장님이 새로 쓴 문장
${added.map((s) => `- ${s}`).join('\n') || '- 없음'}

## 분석 (사람이 적는다)
- 왜 지웠나 / 왜 더했나 / 다음 글 규칙에 올릴 것
`;
fs.mkdirSync(`${ROOT}/docs/초안`, { recursive: true });
fs.mkdirSync(`${ROOT}/.backup/published`, { recursive: true });
fs.writeFileSync(`${ROOT}/.backup/published/${logNo}.txt`, `${pub.title}\n\n${pub.text}`);
const out = `${ROOT}/docs/초안/발행비교-${logNo}-${today}.md`;
if (fs.existsSync(out)) fs.writeFileSync(out.replace(/\.md$/, '-auto.md'), md); else fs.writeFileSync(out, md);
console.log(`살아남은 비율 ${ratio}% (${kept.length}/${dS.length}) · 지움 ${removed.length} · 새로 씀 ${added.length} · 발행 ${len(pub.text)}자 / 초안 ${len(draftBody)}자`);
console.log(`→ ${fs.existsSync(out.replace(/\.md$/, '-auto.md')) ? out.replace(/\.md$/, '-auto.md') : out}`);
