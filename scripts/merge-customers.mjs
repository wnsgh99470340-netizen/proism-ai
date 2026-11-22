// 같은 사람의 고객 기록 둘을 하나로 (2026-11-22 차량 N대): 두 번째 기록의 차 → 첫 기록의 차량, 예약·시공·사후관리·상담·소개·포인트를 첫 기록으로 옮기고 두 번째 기록 삭제
// 실행: node merge_customers.mjs            (계획만)
//       node merge_customers.mjs --apply    (실행, .backup 에 백업)
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^"|"$/g,'')]}));
const URL=env.NEXT_PUBLIC_SUPABASE_URL, KEY=env.SUPABASE_SERVICE_ROLE_KEY||env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=representation'};
const q=async (p)=>{const r=await fetch(`${URL}/rest/v1/${p}`,{headers:H});const j=await r.json();if(!r.ok)throw new Error(JSON.stringify(j));return j;};
const patch=async (p,body)=>{const r=await fetch(`${URL}/rest/v1/${p}`,{method:'PATCH',headers:H,body:JSON.stringify(body)});return r.status;};
const post=async (p,body)=>{const r=await fetch(`${URL}/rest/v1/${p}`,{method:'POST',headers:H,body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(JSON.stringify(j));return j;};
const del=async (p)=>(await fetch(`${URL}/rest/v1/${p}`,{method:'DELETE',headers:H})).status;
const APPLY=process.argv.includes('--apply');

// vehicles 표 확인
try { await q('vehicles?select=id&limit=1'); } catch(e){ console.log('vehicles 표가 아직 없습니다. SQL 먼저 실행하세요.'); process.exit(1); }

const cu=await q('customers?select=*&limit=1000');
const byPhone={}; for(const c of cu){const k=(c.phone||'').replace(/\D/g,''); if(!k) continue; (byPhone[k]=byPhone[k]||[]).push(c);}
const pairs=Object.values(byPhone).filter(v=>v.length>1).map(v=>v.sort((a,b)=>a.created_at.localeCompare(b.created_at)));
console.log('같은 전화 묶음', pairs.length);
const backup={at:new Date().toISOString(),pairs:[]};
for(const group of pairs){
  const primary=group[0], others=group.slice(1);
  console.log(`\n== ${primary.name} (${primary.car_model||'-'}, ${primary.created_at.slice(0,10)}) ← ${others.map(o=>`${o.name}(${o.car_model||'-'})`).join(', ')}`);
  for(const o of others){
    const [ap,sv,fu,co,rg,rr,pt,ml]=await Promise.all([
      q(`appointments?select=*&customer_id=eq.${o.id}`), q(`services?select=*&customer_id=eq.${o.id}`), q(`follow_ups?select=*&customer_id=eq.${o.id}`),
      q(`consultations?select=*&customer_id=eq.${o.id}`), q(`referrals?select=*&referrer_id=eq.${o.id}`).catch(()=>[]), q(`referrals?select=*&referred_id=eq.${o.id}`).catch(()=>[]),
      q(`referral_points?select=*&customer_id=eq.${o.id}`).catch(()=>[]), q(`member_links?select=*&customer_id=eq.${o.id}`).catch(()=>[]),
    ]);
    console.log(`   옮길 것: 예약 ${ap.length} 시공 ${sv.length} 사후관리 ${fu.length} 상담 ${co.length} 소개 ${rg.length+rr.length} 포인트 ${pt.length} 회원링크 ${ml.length}(삭제)`);
    backup.pairs.push({primary:primary.id, other:o, ap, sv, fu, co, rg, rr, pt, ml});
    if(!APPLY) continue;
    // 1) 두 번째 기록의 차 → 첫 기록의 차량(대표 아님). 이미 같은 차종이 있으면 그걸 씀
    const vehicles=await q(`vehicles?select=*&customer_id=eq.${primary.id}`);
    let veh=vehicles.find(v=>(v.model||'')===(o.car_model||'') && (v.brand||'')===(o.car_brand||''));
    if(!veh && (o.car_model||o.car_brand)) veh=(await post('vehicles',{customer_id:primary.id, brand:o.car_brand||null, model:o.car_model||null, year:o.car_year||null, color:o.car_color||null, is_primary:false}))[0];
    // 2) 기록 옮기기 (+ 그 차에 연결)
    const vpatch=veh?{customer_id:primary.id, vehicle_id:veh.id}:{customer_id:primary.id};
    console.log('   appointments', await patch(`appointments?customer_id=eq.${o.id}`, vpatch));
    console.log('   services', await patch(`services?customer_id=eq.${o.id}`, vpatch));
    console.log('   follow_ups', await patch(`follow_ups?customer_id=eq.${o.id}`, {customer_id:primary.id}));
    console.log('   consultations', await patch(`consultations?customer_id=eq.${o.id}`, {customer_id:primary.id}));
    if(rg.length) console.log('   referrals(referrer)', await patch(`referrals?referrer_id=eq.${o.id}`, {referrer_id:primary.id}));
    if(rr.length) console.log('   referrals(referred)', await patch(`referrals?referred_id=eq.${o.id}`, {referred_id:primary.id}));
    if(pt.length) console.log('   points', await patch(`referral_points?customer_id=eq.${o.id}`, {customer_id:primary.id}));
    if(ml.length) console.log('   member_links del', await del(`member_links?customer_id=eq.${o.id}`));
    // 3) 메모 합치고 두 번째 기록 삭제
    if(o.memo) await patch(`customers?id=eq.${primary.id}`, {memo:[primary.memo||'', `[합친 기록 ${o.car_model||''}] ${o.memo}`].filter(Boolean).join('\n')});
    console.log('   customer del', await del(`customers?id=eq.${o.id}`));
  }
}
fs.mkdirSync('.backup',{recursive:true}); fs.writeFileSync(`.backup/customers-merge-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(backup,null,1));
console.log(APPLY?'\n완료':'\n계획만 — --apply 로 실행');
