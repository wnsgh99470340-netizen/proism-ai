/**
 * 로그인 쿠키 (2026-11-18)
 * - 기간: 1년. 미들웨어가 방문 때마다 다시 늘리므로 쓰는 기기에서는 사실상 안 풀린다
 * - 값: 비밀번호(CRM_PASSWORD)에서 만든 해시. 비밀번호를 바꾸면 값이 달라져 모든 기기가 한 번에 로그아웃된다
 *   (예전 고정값 'authenticated' 는 더 이상 통하지 않음)
 * Edge(미들웨어)·Node 양쪽에서 쓰려고 Web Crypto 만 사용
 */
export const AUTH_COOKIE_NAME = 'crm_auth';
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

let cached: { pw: string; value: string } | null = null;

export async function authCookieValue(): Promise<string> {
  const pw = process.env.CRM_PASSWORD || '';
  if (cached && cached.pw === pw) return cached.value;
  const data = new TextEncoder().encode(`proism-crm-v1:${pw}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const value = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  cached = { pw, value };
  return value;
}

export async function isAuthCookieValid(value: string | undefined): Promise<boolean> {
  if (!value || !process.env.CRM_PASSWORD) return false;
  return value === (await authCookieValue());
}

export const authCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: AUTH_COOKIE_MAX_AGE,
});
