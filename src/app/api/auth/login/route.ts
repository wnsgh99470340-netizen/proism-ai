import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_MAX_AGE } from '@/lib/auth-cookie';

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const correctPassword = process.env.CRM_PASSWORD;

  if (!correctPassword) {
    return NextResponse.json(
      { error: 'CRM_PASSWORD 환경변수가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  if (password !== correctPassword) {
    return NextResponse.json(
      { error: '비밀번호가 올바르지 않습니다.' },
      { status: 401 }
    );
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set('crm_auth', 'authenticated', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // 2026-11-18 사장님 "인증된 기기는 비밀번호 다시 안 넣게": 1년 유지. 미들웨어가 방문할 때마다 기간을 다시 늘려 쓰는 동안은 안 풀림
    maxAge: AUTH_COOKIE_MAX_AGE,
  });

  return response;
}
