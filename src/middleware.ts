import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, isAuthCookieValid, authCookieValue, authCookieOptions } from '@/lib/auth-cookie';
import { DEMO_COOKIE, DEMO_COOKIE_VALUE } from '@/lib/demo';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 둘러보기 (2026-11-22): /demo 입장은 열어 두고, 그 쿠키로는 /crm 화면(페이지)만 통과. /api/* 는 아래에서 그대로 401 → 데이터는 빈 채로 보인다 (src/lib/demo.ts)
  if (pathname === '/demo') return NextResponse.next();
  const demo = request.cookies.get(DEMO_COOKIE)?.value === DEMO_COOKIE_VALUE;
  // 사장님 기기(로그인된 상태)에서 /demo 를 열어도 홈 카드·숫자·블로그 목록 API 가 실제 데이터를 내려주면 안 된다 → 둘러보기 쿠키가 있으면 API 는 로그인 여부와 상관없이 401 (로그인 API 만 예외)
  if (demo && pathname.startsWith('/api/') && pathname !== '/api/auth/login') {
    return NextResponse.json({ error: 'demo' }, { status: 401 });
  }
  if (demo && (pathname === '/' || pathname === '/crm' || pathname.startsWith('/crm/'))) return NextResponse.next();

  // 로그인 페이지·로그인 API·Vercel Cron(자체 시크릿으로 검증)·PWA 파일은 통과
  if (
    pathname === '/login' ||
    pathname === '/api/auth/login' ||
    pathname === '/api/version' || // 새 배포 감지 (VersionWatcher)
    pathname.startsWith('/api/cron/') ||
    pathname === '/sw.js' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/api/jobs/run' || // 서버 내부 단계 호출 (라우트에서 시크릿/쿠키 직접 검증)
    pathname === '/card' || pathname.startsWith('/card/') || // 공개 명함 페이지·명함 이미지·연락처 파일 (견적 문자 링크)
    /^\/m\/[A-Za-z0-9]{12,}$/.test(pathname) || // 손님용 회원 페이지: 개인 코드 + 전화 뒷자리 4개 확인 (2026-11-18 사장님 결정)
    (request.method === 'GET' && /^\/api\/member\/[A-Za-z0-9]{12,}$/.test(pathname)) || // 그 페이지가 읽는 API (읽기만, 뒷자리 확인은 API 안에서)
    /^\/d\/[A-Za-z0-9]{12,}$/.test(pathname) || // 딜러용 현황 페이지 (2026-11-25): 개인 코드 + 딜러 전화 뒷자리
    (request.method === 'GET' && /^\/api\/dealer\/[A-Za-z0-9]{12,}$/.test(pathname)) ||
    /^\/s\/[A-Za-z0-9]{24}$/.test(pathname) || // 직원용 예약 페이지 (2026-11-27): 비밀번호에서 만든 코드 + STAFF_PIN
    (request.method === 'GET' && /^\/api\/staff\/[A-Za-z0-9]{24}$/.test(pathname)) ||
    (request.method === 'GET' && pathname === '/api/staff/manifest')
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
