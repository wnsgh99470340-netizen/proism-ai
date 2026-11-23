import { NextResponse } from 'next/server';

/** 지금 배포된 버전 (2026-11-23): 홈 화면 앱이 옛 코드를 계속 쓰지 않도록 VersionWatcher 가 앞으로 올 때마다 비교한다 */
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ id: process.env.NEXT_PUBLIC_BUILD_ID || null }, { headers: { 'Cache-Control': 'no-store' } });
}
