import { staffToken, staffPageUrl } from '@/lib/staff-page';

export const runtime = 'nodejs';

/** GET /api/staff/link — 직원용 예약 페이지 주소 (로그인 쿠키 필요: 미들웨어가 /api/* 를 막음) */
export async function GET() {
  const token = staffToken();
  if (!token) return Response.json({ error: 'CRM_PASSWORD 가 없습니다' }, { status: 503 });
  return Response.json({ url: staffPageUrl(token), pinSet: (process.env.STAFF_PIN || '').replace(/\D/g, '').length === 4 });
}
