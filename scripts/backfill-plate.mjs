// 완료된 작업 내역서의 차량번호를 차량 표에 채운다 (번호 없는 차, 손님 차가 한 대일 때만). 값은 출력하지 않음
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = fs.readFileSync('/Users/junho/Desktop/클로드코드/proism-ai/.env.local', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
const sb = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('NEXT_PUBLIC_SUPABASE_ANON_KEY'));
const dry = process.argv.includes('--dry');
const { data: appts } = await sb.from('appointments').select('id, customer_id, memo, vehicle_id').eq('status', '완료');
let candidates = 0, filled = 0;
for (const a of appts || []) {
  let wo = null; try { wo = JSON.parse(a.memo || ''); } catch { continue; }
  const plate = (wo?.car_number || '').trim(); if (!plate) continue;
  const { data: vs } = await sb.from('vehicles').select('id, plate, is_primary').eq('customer_id', a.customer_id);
  const target = (vs || []).find((v) => v.id === a.vehicle_id) || (vs || []).find((v) => v.is_primary) || ((vs || []).length === 1 ? vs[0] : null);
  if (!target || target.plate) continue;
  candidates += 1;
  if (!dry) { const { error } = await sb.from('vehicles').update({ plate }).eq('id', target.id); if (!error) filled += 1; }
}
console.log(dry ? `채울 수 있는 차 ${candidates}대 (dry)` : `채운 차 ${filled}/${candidates}대`);
