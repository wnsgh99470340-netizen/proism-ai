import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * Supabase 무료 플랜은 1주일 동안 요청이 없으면 프로젝트가 자동 일시정지된다.
 * Vercel Cron(vercel.json)이 매일 한 번 이 엔드포인트를 호출해 가벼운 조회를 날려 깨어 있게 한다.
 * Vercel은 CRON_SECRET 환경변수가 있으면 Authorization: Bearer <CRON_SECRET> 헤더를 붙여 호출한다.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const { count, error } = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true });

  if (error) {
    console.error('[cron/keepalive] supabase error:', error.message);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  return Response.json({
    ok: true,
    customers: count,
    ms: Date.now() - startedAt,
    at: new Date().toISOString(),
  });
}
