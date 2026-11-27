// 폰 푸시 한 통 보내기 (2026-11-27 "매일 한 권 책 요약" 알림용).
//   node scripts/desk/book-push.mjs "<제목>" "<본문>" [url]
// .env.local 의 CRM_PASSWORD 로 로그인 쿠키 해시를 만들어 운영 서버 POST /api/push {notify} 를 부른다. 비밀값은 출력하지 않는다.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const env = Object.fromEntries(
  fs.readFileSync(`${ROOT}/.env.local`, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '').trim()]; }),
);
const pw = env.CRM_PASSWORD;
if (!pw) { console.error('CRM_PASSWORD 없음'); process.exit(1); }
const cookie = createHash('sha256').update(`proism-crm-v1:${pw}`).digest('hex');
const base = (env.NEXT_PUBLIC_BASE_URL || 'https://proism-ai.vercel.app').replace(/\/$/, '');

const [title, body, url = '/crm'] = process.argv.slice(2);
if (!title || !body) { console.error('사용법: book-push.mjs "<제목>" "<본문>" [url]'); process.exit(1); }

const r = await fetch(`${base}/api/push`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: `crm_auth=${cookie}` },
  body: JSON.stringify({ notify: { title, body, url, tag: `book-${new Date().toISOString().slice(0, 10)}` } }),
});
const j = await r.json().catch(() => ({}));
console.log(r.status, JSON.stringify({ ok: j.ok, sent: j.sent, failed: j.failed, error: j.error }));
process.exit(r.ok ? 0 : 1);
