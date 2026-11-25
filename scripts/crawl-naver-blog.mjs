// 네이버 블로그 크롤링 (2026-11-25 사장님 "블로그 주소 세 개 크롤링"): 글 목록(PostTitleListAsync) + 본문(m.blog.naver.com)
//   node scripts/crawl-naver-blog.mjs <blogId> [--list-only] [--max N]
// 결과: .backup/crawl/<blogId>/posts.json (+ posts.md). 깃에 안 올라감
import fs from 'node:fs';
const [blogId, ...flags] = process.argv.slice(2);
if (!blogId) { console.error('blogId 필요'); process.exit(1); }
const listOnly = flags.includes('--list-only');
const maxIdx = flags.indexOf('--max'); const max = maxIdx >= 0 ? Number(flags[maxIdx + 1]) : Infinity;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\+/g, ' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function list() {
  const out = []; const seen = new Set();
  for (let page = 1; page <= 60; page++) {
    const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&viewdate=&currentPage=${page}&categoryNo=0&parentCategoryNo=&countPerPage=30`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: `https://blog.naver.com/${blogId}` } });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt.replace(/\\'/g, "'")); } catch { const m = txt.match(/"postList":(\[.*?\])\s*[,}]/s); if (!m) break; try { j = { postList: JSON.parse(m[1].replace(/\\'/g, "'")) }; } catch { break; } }
    const posts = j.postList || [];
    if (!posts.length) break;
    let added = 0;
    for (const p of posts) { const logNo = String(p.logNo); if (seen.has(logNo)) continue; seen.add(logNo); out.push({ logNo, title: decode(decodeURIComponent(p.title || '')), date: p.addDate || '', category: p.categoryNo }); added++; }
    if (!added) break;
    await sleep(200);
  }
  return out;
}
async function body(logNo) {
  // src/lib/blog-research.ts fetchNaverPostText 와 같은 방식: se-main-container 부터 끝까지 태그를 벗기고, 네이버 꼬리(체크인·다른 글 미리보기·댓글)는 잘라낸다
  const r = await fetch(`https://m.blog.naver.com/${blogId}/${logNo}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  const html = await r.text();
  const start = html.indexOf('se-main-container');
  const section = start >= 0 ? html.slice(start) : html;
  const imgs = (section.match(/postfiles\.pstatic\.net|blogfiles\.pstatic\.net/g) || []).length;
  let text = section.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  const tail = text.search(/이 블로그의 체크인|이 장소의 다른 글|공감한 사람 보러가기|댓글\s*\d*\s*공유하기|태그\s*#|\n이웃추가/);
  if (tail > 200) text = text.slice(0, tail).trim();
  return { text, imgs };
}
const dir = `.backup/crawl/${blogId}`; fs.mkdirSync(dir, { recursive: true });
const posts = await list();
console.log(`${blogId}: 목록 ${posts.length}건`, posts.length ? `(${posts[posts.length - 1].date} ~ ${posts[0].date})` : '');
if (listOnly) { fs.writeFileSync(`${dir}/list.json`, JSON.stringify(posts, null, 1)); process.exit(0); }
const prev = fs.existsSync(`${dir}/posts.json`) ? JSON.parse(fs.readFileSync(`${dir}/posts.json`, 'utf8')) : [];
const have = new Map(prev.map((p) => [p.logNo, p]));
const result = [];
let n = 0;
for (const p of posts) {
  if (n >= max) break;
  if (have.has(p.logNo) && (have.get(p.logNo).text || '').replace(/\s/g, '').length > 100) { result.push(have.get(p.logNo)); continue; }
  try { const b = await body(p.logNo); result.push({ ...p, ...b, url: `https://blog.naver.com/${blogId}/${p.logNo}` }); } catch (e) { result.push({ ...p, text: '', imgs: 0, error: String(e) }); }
  n++; if (n % 20 === 0) { console.log(`  본문 ${n}건`); fs.writeFileSync(`${dir}/posts.json`, JSON.stringify(result, null, 1)); }
  await sleep(250);
}
fs.writeFileSync(`${dir}/posts.json`, JSON.stringify(result, null, 1));
fs.writeFileSync(`${dir}/posts.md`, result.map((p) => `# ${p.title}\n${p.date} · ${p.url || ''} · 사진 ${p.imgs || 0}장 · ${(p.text || '').replace(/\s/g, '').length}자\n\n${p.text || '(본문 없음)'}\n`).join('\n\n---\n\n'));
const withText = result.filter((p) => (p.text || '').length > 100).length;
console.log(`${blogId}: 본문 ${withText}/${result.length}건 저장 → ${dir}/posts.json, posts.md`);
