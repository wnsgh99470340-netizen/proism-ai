/**
 * 받은 알림 기록 (2026-11-26 사장님 "알림 1이 뭔지도 모르겠어, 뭐가 왔는지 찾아볼 수 있는 탭").
 * 푸시를 보낼 때마다 제목·본문·링크·시각을 Vercel Blob push/log.json 한 파일에 쌓는다(최근 300개, 스키마 변경 없음).
 * 헤더 "받은 알림" 창이 GET /api/push/log 로 읽는다.
 */
import { list, put } from '@vercel/blob';

export interface PushLogEntry {
  at: string;        // ISO
  title: string;
  body: string;
  url?: string;
  tag?: string;
  sent?: number;     // 보낸 기기 수
}

const PATH = 'push/log.json';
const KEEP = 300;

async function blobUrl(): Promise<string | null> {
  try {
    const { blobs } = await list({ prefix: PATH, limit: 1 });
    return blobs.find((b) => b.pathname === PATH)?.url || null;
  } catch { return null; }
}

export async function readPushLog(limit = 100): Promise<PushLogEntry[]> {
  const url = await blobUrl();
  if (!url) return [];
  try {
    const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return [];
    const arr = (await r.json()) as PushLogEntry[];
    return Array.isArray(arr) ? arr.slice(0, limit) : [];
  } catch { return []; }
}

/** 최신이 앞. 실패해도 알림 전송은 막지 않는다 */
export async function appendPushLog(entry: PushLogEntry): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    const prev = await readPushLog(KEEP);
    const next = [entry, ...prev].slice(0, KEEP);
    await put(PATH, JSON.stringify(next), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
  } catch (e) {
    console.warn('[push-log] append failed:', e instanceof Error ? e.message : e);
  }
}

/** 화면용: 날짜별 묶음 (서울 날짜) — 순수 함수 */
export function groupPushLog(items: PushLogEntry[]): { date: string; items: PushLogEntry[] }[] {
  const out: { date: string; items: PushLogEntry[] }[] = [];
  for (const it of items) {
    const d = seoulDate(it.at);
    const g = out[out.length - 1];
    if (g && g.date === d) g.items.push(it); else out.push({ date: d, items: [it] });
  }
  return out;
}

export function seoulDate(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}
export function seoulTime(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return t.toISOString().slice(11, 16);
}
