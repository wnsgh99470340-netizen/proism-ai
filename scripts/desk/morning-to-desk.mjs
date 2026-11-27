// 매일 07시 서버가 만든 "오늘의 방향"(Blob team/morning/YYYY-MM-DD.json)을 바탕화면 정신차려/아침-방향/ 에 PDF 로 쌓는다.
// (2026-11-27 사장님 "보기 좋다" — 크론은 서버라 맥에 파일을 못 쓰니, 맥의 launchd 가 07:30 과 로그인 때 이 스크립트를 돌린다)
//   node scripts/desk/morning-to-desk.mjs            → 최근 3일 중 아직 PDF 없는 날을 받아 만든다
//   launchd: ~/Library/LaunchAgents/com.proism.morning-to-desk.plist (StartCalendarInterval 07:30 + RunAtLoad)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const BLOB = 'https://qmojjasot1xbodmy.public.blob.vercel-storage.com/team/morning/';
const DESK = path.join(os.homedir(), 'Desktop', '정신차려', '아침-방향');
const MD_DIR = path.join(DESK, '_원본md');
fs.mkdirSync(MD_DIR, { recursive: true });

const seoul = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const days = [0, 1, 2].map((n) => seoul(new Date(Date.now() - n * 864e5)));
const toMd = (date, text) => {
  const md = text.replace(/^\*\*(.+?)\*\*$/gm, '## $1').replace(/^(오늘 돈과 가장 가까운 행동 3개)$/m, '## $1')
    .replace(/^어제: /m, '## 어제\n').replace(/^따끔한 한마디: /m, '## 따끔한 한마디\n').replace(/^오늘 하지 말 것: /m, '## 오늘 하지 말 것\n');
  const title = `${Number(date.slice(5, 7))}/${Number(date.slice(8))} 오늘의 방향`;
  return /^#\s/m.test(md) ? md : `# ${title}\n\n${md}`;
};

let made = 0;
for (const date of days) {
  const pdf = path.join(DESK, `${date}.pdf`);
  if (fs.existsSync(pdf)) continue;
  try {
    const r = await fetch(`${BLOB}${date}.json`, { cache: 'no-store' });
    if (!r.ok) { console.log(`${date}: 아직 없음 (${r.status})`); continue; }
    const j = await r.json();
    if (!j?.text) { console.log(`${date}: text 없음`); continue; }
    const mdPath = path.join(MD_DIR, `${date}.md`);
    fs.writeFileSync(mdPath, toMd(date, String(j.text).trim()) + '\n');
    execFileSync('/usr/bin/python3', [path.join(ROOT, 'scripts/desk/md2pdf.py'), mdPath, pdf], { stdio: 'inherit' });
    made++;
    console.log(`${date}: PDF 생성`);
  } catch (e) { console.log(`${date}: 실패 ${e instanceof Error ? e.message : e}`); }
}
console.log(`끝 — 새로 만든 PDF ${made}개`);
