import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, authCookieValue, authCookieOptions } from '@/lib/auth-cookie';

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

  // 2026-11-18: 1년 유지(미들웨어가 방문 때마다 연장) + 값은 비밀번호 해시 → 비밀번호를 바꾸면 모든 기기 로그아웃
  response.cookies.set(AUTH_COOKIE_NAME, await authCookieValue(), authCookieOptions());

  return response;
}
