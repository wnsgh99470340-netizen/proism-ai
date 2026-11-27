// "매일 한 권" 요약을 Blob 에 올린다 (2026-11-27 사장님 "맥이 매일 아침 꺼져 있어" → 서버 크론이 07시에 team/book/<날짜>.json 을 읽어 푸시).
//   node scripts/desk/book-upload.mjs <YYYY-MM-DD> <pdf경로> "<제목>" "<푸시 본문>" [번호]
// 올리는 것: team/book/<날짜>.pdf (공개) + team/book/<날짜>.json {date, number, title, body, pdfUrl}. 토큰은 .env.local 의 BLOB_READ_WRITE_TOKEN(출력 안 함).
import fs from 'node:fs';
import { put } from '@vercel/blob';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const env = Object.fromEntries(
  fs.readFileSync(`${ROOT}/.env.local`, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '').trim()]; }),
);
const token = env.BLOB_READ_WRITE_TOKEN;
if (!token) { console.error('BLOB_READ_WRITE_TOKEN 없음'); process.exit(1); }

const [date, pdfPath, title, body, number = ''] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !pdfPath || !title || !body) {
  console.error('사용법: book-upload.mjs <YYYY-MM-DD> <pdf경로> "<제목>" "<본문>" [번호]'); process.exit(1);
}
if (!fs.existsSync(pdfPath)) { console.error(`PDF 없음: ${pdfPath}`); process.exit(1); }
const opts = { access: 'public', addRandomSuffix: false, allowOverwrite: true, token };
const pdf = await put(`team/book/${date}.pdf`, fs.readFileSync(pdfPath), { ...opts, contentType: 'application/pdf' });
const meta = { date, number, title: title.slice(0, 60), body: body.slice(0, 1500), pdfUrl: pdf.url, madeAt: new Date().toISOString() };
const js = await put(`team/book/${date}.json`, JSON.stringify(meta), { ...opts, contentType: 'application/json' });
console.log(JSON.stringify({ pdf: pdf.url, json: js.url }));
