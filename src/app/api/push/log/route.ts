import { NextResponse } from 'next/server';
import { readPushLog } from '@/lib/push-log';

/** 받은 알림 목록 (2026-11-26). 로그인 쿠키는 미들웨어가 본다 */
export const dynamic = 'force-dynamic';
export async function GET() {
  const items = await readPushLog(100);
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
}
