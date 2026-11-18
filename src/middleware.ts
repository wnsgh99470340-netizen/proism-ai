import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, isAuthCookieValid, authCookieValue, authCookieOptions } from '@/lib/auth-cookie';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 로그인 페이지·로그인 API·Vercel Cron(자체 시크릿으로 검증)·PWA 파일은 통과
  if (
    pathname === '/login' ||
    pathname === '/api/auth/login' ||
    pathname.startsWith('/api/cron/') ||
    pathname === '/sw.js' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/api/jobs/run' || // 서버 내부 단계 호출 (라우트에서 시크릿/쿠키 직접 검증)
    pathname === '/card' || pathname.startsWith('/card/') // 공개 명함 페이지·명함 이미지·연락처 파일 (견적 문자 링크)
  ) {
    return NextResponse.next();
  }

  // 인증 쿠키 확인
  const authToken = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (!(await isAuthCookieValid(authToken))) {
    // API 요청은 401 반환
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 페이지 요청은 로그인으로 리다이렉트
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 인증된 기기: 방문할 때마다 쿠키 기간을 1년으로 다시 늘린다 (예전 세션 쿠키도 이 한 번으로 오래 가는 쿠키로 바뀜)
  const res = NextResponse.next();
  if (!pathname.startsWith('/api/')) {
    res.cookies.set(AUTH_COOKIE_NAME, await authCookieValue(), authCookieOptions());
  }
  return res;
}

export const config = {
  matcher: [
    /*
     * 정적 파일과 Next.js 내부 경로 제외
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
