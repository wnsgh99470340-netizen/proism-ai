// 크롤링한 블로그 글 분석 (2026-11-25): 말투·구조 참고용 통계. node scripts/analyze-crawl.mjs roice_ poi_1357 effort--
import fs from 'node:fs';
const ids = process.argv.slice(2);
const clean = (t) => (t || '').replace(/^se-main-container">\s*/, '').replace(/​/g, '').trim();
const svcOf = (s) => /신차\s*패키지/.test(s) ? '신차패키지' : /컬러\s*PPF|PWF/i.test(s) ? '컬러PPF' : /크롬/.test(s) ? '크롬죽이기' : /랩핑/.test(s) ? '랩핑' : /썬팅|틴팅/.test(s) ? '썬팅' : /유리막|코팅/.test(s) ? '유리막코팅' : /실내/.test(s) ? '실내PPF' : /PPF/i.test(s) ? 'PPF' : '기타';
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const out = [];
for (const id of ids) {
  const f = `.backup/crawl/${id}/posts.json`; if (!fs.existsSync(f)) { out.push(`# ${id}: 아직 없음`); continue; }
  const posts = JSON.parse(fs.readFileSync(f, 'utf8')).map((p) => ({ ...p, text: clean(p.text) })).filter((p) => p.text.replace(/\s/g, '').length > 200);
  const lens = posts.map((p) => p.text.replace(/\s/g, '').length).sort((a, b) => a - b);
  const med = lens[Math.floor(lens.length / 2)] || 0;
  const titleLen = posts.map((p) => p.title.length); const tAvg = Math.round(titleLen.reduce((a, b) => a + b, 0) / (titleLen.length || 1));
  const svc = new Map(); for (const p of posts) svc.set(svcOf(p.title + ' ' + p.text.slice(0, 300)), (svc.get(svcOf(p.title + ' ' + p.text.slice(0, 300))) || 0) + 1);
  const regionFirst = posts.filter((p) => /^(강남|서초|양재|반포|하남|미사|송파|잠실|방배|분당|판교|위례|구리|남양주|압구정|청담|논현|역삼)/.test(p.title)).length;
  const carFirst = posts.filter((p) => /^(BMW|벤츠|아우디|포르쉐|테슬라|제네시스|현대|기아|랜드로버|볼보|렉서스|마세라티|람보르기니|페라리|벤틀리|미니|폭스바겐|[A-Z0-9]{1,4}\s)/i.test(p.title)).length;
  const opens = new Map(); const closes = new Map(); const lines = new Map(); const periods = []; const lineLens = []; const firstP = []; const questions = []; const imgs = [];
  for (const p of posts) {
    const ls = p.text.split('\n').map((l) => l.trim()).filter((l) => l.length > 1);
    const o = ls.slice(0, 2).join(' / '); opens.set(o.slice(0, 40), (opens.get(o.slice(0, 40)) || 0) + 1);
    const c = ls.slice(-3).join(' / '); closes.set(c.slice(0, 50), (closes.get(c.slice(0, 50)) || 0) + 1);
    for (const l of ls) { if (l.length >= 8) lines.set(l, (lines.get(l) || 0) + 1); lineLens.push(l.length); }
    const sents = p.text.split(/\n+/).filter((l) => l.trim().length > 5);
    periods.push(sents.filter((l) => /[.!?]\s*$/.test(l.trim())).length / (sents.length || 1));
    questions.push((p.text.match(/\?/g) || []).length);
    imgs.push(p.imgs || 0);
    firstP.push(ls[0] || '');
  }
  const avg = (a) => (a.reduce((x, y) => x + y, 0) / (a.length || 1));
  const repeated = top(lines, 12).filter(([, n]) => n >= Math.max(3, posts.length * 0.05));
  const we = posts.filter((p) => /저희/.test(p.text)).length, i1 = posts.filter((p) => /저는|제가/.test(p.text)).length;
  out.push(`# ${id} — ${posts.length}편 (${posts[posts.length - 1]?.date} ~ ${posts[0]?.date})
- 분량(공백 제외): 중앙값 ${med}자, 최소 ${lens[0]}, 최대 ${lens[lens.length - 1]} / 사진 평균 ${avg(imgs).toFixed(1)}장
- 제목: 평균 ${tAvg}자, 지역명으로 시작 ${regionFirst}편(${Math.round(regionFirst / posts.length * 100)}%), 차종·브랜드로 시작 ${carFirst}편(${Math.round(carFirst / posts.length * 100)}%)
- 시공 종류: ${top(svc, 8).map(([k, v]) => `${k} ${v}`).join(' · ')}
- 문장 끝 마침표 비율 평균 ${(avg(periods) * 100).toFixed(0)}% / 한 줄 평균 ${avg(lineLens).toFixed(0)}자 / 물음표 평균 ${avg(questions).toFixed(1)}개 / "저희" 쓰는 글 ${Math.round(we / posts.length * 100)}% · "저는/제가" ${Math.round(i1 / posts.length * 100)}%
- 자주 쓰는 도입(첫 두 줄) 상위: ${top(opens, 5).map(([k, v]) => `[${v}] ${k}`).join(' | ')}
- 자주 쓰는 마무리(끝 세 줄) 상위: ${top(closes, 4).map(([k, v]) => `[${v}] ${k}`).join(' | ')}
- 여러 글에 그대로 되풀이되는 줄: ${repeated.map(([k, v]) => `[${v}] ${k.slice(0, 50)}`).join(' | ') || '없음'}
- 제목 예 10개: ${posts.slice(0, 10).map((p) => p.title).join(' / ')}`);
}
fs.mkdirSync('.backup/crawl', { recursive: true });
fs.writeFileSync('.backup/crawl/분석.md', out.join('\n\n'));
console.log(out.join('\n\n'));
