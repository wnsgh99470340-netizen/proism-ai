/**
 * 웹 푸시 알림 (VAPID) — 홈 화면에 설치한 앱으로 "글 완성" 알림을 보낸다
 * 구독 정보는 Supabase push_subscriptions 에 저장. 키는 NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
 */
import webpush, { type PushSubscription } from 'web-push';
import { supabase } from './supabase';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

function configured(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:poi_1357@naver.com', pub, priv);
  return true;
}

export async function savePushSubscription(sub: PushSubscription, userAgent: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({ endpoint: sub.endpoint, subscription: sub, user_agent: userAgent.slice(0, 300) }, { onConflict: 'endpoint' });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function removePushSubscription(endpoint: string): Promise<boolean> {
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  return !error;
}

export async function countPushSubscriptions(): Promise<number> {
  try {
    const { count, error } = await supabase.from('push_subscriptions').select('endpoint', { count: 'exact', head: true });
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

/** 등록된 모든 기기에 알림 전송. 만료된 구독(404/410)은 삭제 */
export async function sendPushToAll(payload: PushPayload): Promise<{ sent: number; removed: number }> {
  if (!configured()) return { sent: 0, removed: 0 };
  let rows: { endpoint: string; subscription: PushSubscription }[] = [];
  try {
    const { data, error } = await supabase.from('push_subscriptions').select('endpoint, subscription');
    if (error || !data) return { sent: 0, removed: 0 };
    rows = data as typeof rows;
  } catch {
    return { sent: 0, removed: 0 };
  }

  let sent = 0;
  let removed = 0;
  await Promise.all(rows.map(async (row) => {
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify(payload), { TTL: 60 * 60 * 6 });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await removePushSubscription(row.endpoint);
        removed++;
      } else {
        console.warn('[push] send failed:', status, e instanceof Error ? e.message : e);
      }
    }
  }));
  return { sent, removed };
}
