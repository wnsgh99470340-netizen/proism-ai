// 딜러 일괄 등록 (2026-11-23): 조직도 JSON(.backup/dealers-*.json, 깃 제외) → customers(kind='딜러')
//   node --env-file=.env.local scripts/register-dealers.mjs .backup/dealers-2026-11-23.json          # 미리보기(쓰지 않음)
//   node --env-file=.env.local scripts/register-dealers.mjs .backup/dealers-2026-11-23.json --apply  # 등록
// 이름 = "성명 직책"(문자 "○○○ 부장 님"에 그대로 쓰임), memo 첫 줄 = "소속 전시장"(팀은 넣지 않음, 2026-11-23 사장님), 둘째 줄 이메일(있을 때). 같은 이름+소속이 이미 있으면 건너뜀
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const [file, flag] = process.argv.slice(2);
if (!file) { console.error('사용법: node --env-file=.env.local scripts/register-dealers.mjs <json> [--apply]'); process.exit(1); }
const apply = flag === '--apply';
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const rows = JSON.parse(readFileSync(file, 'utf-8'));
const { data: existing, error } = await s.from('customers').select('id, name, phone, memo, kind').eq('kind', '딜러');
if (error) { console.error('customers 읽기 실패:', error.message); process.exit(1); }
const norm = (p) => { const d = (p || '').replace(/\D/g, ''); return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : null; };
const seen = new Map(); for (const r of rows) { const k = norm(r.phone); if (k) seen.set(k, [...(seen.get(k) || []), `${r.name} ${r.role}`]); }
const dupPhones = [...seen.entries()].filter(([, v]) => v.length > 1);
if (dupPhones.length) console.log('⚠ 같은 번호:', dupPhones.map(([p, v]) => `${p.slice(-4)} ← ${v.join(' / ')}`).join(' | '));
const toInsert = [];
for (const r of rows) {
  const name = `${r.name} ${r.role}`.trim();
  const memo = [r.org, r.email ? `이메일 ${r.email}` : ''].filter(Boolean).join('\n');
  const dup = (existing || []).find((e) => e.name === name && (e.memo || '').split('\n')[0] === memo.split('\n')[0]);
  if (dup) { console.log('건너뜀(이미 있음):', name); continue; }
  toInsert.push({ name, phone: norm(r.phone), kind: '딜러', source: null, memo });
}
console.log(`${apply ? '등록' : '미리보기'} ${toInsert.length}명`);
for (const r of toInsert) console.log(' -', r.name, '·', r.memo.split('\n')[0], '·', r.phone ? '****-' + r.phone.slice(-4) : '번호 없음');
if (apply && toInsert.length) {
  const { error: e2 } = await s.from('customers').insert(toInsert);
  if (e2) { console.error('등록 실패:', e2.message); process.exit(1); }
  console.log('완료');
}
