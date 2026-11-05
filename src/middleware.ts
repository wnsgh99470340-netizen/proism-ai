import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 로그인 페이지·로그인 API·Vercel Cron(자체 시크릿으로 검증)·PWA 파일은 통과
  if (
    pathname === '/login' ||
    pathname === '/api/auth/login' ||
    pathname.startsWith('/api/cron/') ||
    pathname === '/sw.js' ||
    pathname === '/manifest.webmanifest'
  ) {
    return NextResponse.next();
  }

  // 인증 쿠키 확인
  const authToken = request.cookies.get('crm_auth')?.value;

  if (authToken !== 'authenticated') {
    // API 요청은 401 반환
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 페이지 요청은 로그인으로 리다이렉트
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 정적 파일과 Next.js 내부 경로 제외
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
