import { NextRequest, NextResponse } from 'next/server';

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
    // maxAge 미설정 → 세션 쿠키 (브라우저 닫으면 삭제)
  });

  return response;
}
