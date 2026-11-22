import { NextRequest, NextResponse } from 'next/server';
import { DEMO_COOKIE, DEMO_COOKIE_VALUE, DEMO_MAX_AGE } from '@/lib/demo';

/**
 * 둘러보기 입장 (2026-11-22): GET /demo → crm_demo 쿠키 2시간 + /crm 으로 이동
 * 쿠키는 브라우저 JS 가 읽어야 하므로 httpOnly 아님. 이 쿠키로 열리는 것은 /crm 화면뿐이고 데이터는 빈 결과다 (src/lib/demo.ts)
 * ?off=1 이면 쿠키를 지우고 로그인 화면으로
 */
export async function GET(request: NextRequest) {
  const off = request.nextUrl.searchParams.get('off') === '1';
  const res = NextResponse.redirect(new URL(off ? '/login' : '/crm', request.url));
  if (off) res.cookies.set(DEMO_COOKIE, '', { path: '/', maxAge: 0, sameSite: 'lax' });
  else res.cookies.set(DEMO_COOKIE, DEMO_COOKIE_VALUE, { path: '/', maxAge: DEMO_MAX_AGE, sameSite: 'lax', httpOnly: false, secure: process.env.NODE_ENV === 'production' });
  return res;
}
