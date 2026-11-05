import { NextRequest } from 'next/server';
import { savePushSubscription, removePushSubscription, countPushSubscriptions, sendPushToAll } from '@/lib/push';

/** GET /api/push — 등록된 기기 수 */
export async function GET() {
  return Response.json({ count: await countPushSubscriptions(), enabled: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) });
}

/** POST /api/push { subscription } — 이 기기 등록. { test: true } 면 테스트 알림 발송 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body?.test) {
      const r = await sendPushToAll({ title: '3M 프로이즘', body: '알림이 정상 연결되었습니다. 글이 완성되면 이렇게 알려드립니다.', url: '/', tag: 'test' });
      return Response.json({ ok: true, ...r });
    }
    const sub = body?.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return Response.json({ error: '구독 정보가 올바르지 않습니다.' }, { status: 400 });
    }
    const r = await savePushSubscription(sub, request.headers.get('user-agent') || '');
    if (!r.ok) return Response.json({ error: `저장 실패: ${r.error} (Supabase에 push_subscriptions 테이블이 있는지 확인)` }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '알 수 없는 오류' }, { status: 500 });
  }
}

/** DELETE /api/push { endpoint } — 이 기기 해제 */
export async function DELETE(request: NextRequest) {
  try {
    const { endpoint } = await request.json();
    if (!endpoint) return Response.json({ error: 'endpoint가 필요합니다.' }, { status: 400 });
    return Response.json({ ok: await removePushSubscription(endpoint) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '알 수 없는 오류' }, { status: 500 });
  }
}
