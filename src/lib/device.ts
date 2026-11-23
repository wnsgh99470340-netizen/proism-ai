/** 기기 판별·복사 같은 브라우저 잔손질 (2026-11-23 갤럭시 점검) */

/** 폰·태블릿인가 (갤럭시·아이폰). 맥·PC 는 false */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * 글자 복사. navigator.clipboard 가 없는 브라우저(삼성 인터넷 구버전 등)에서도 죽지 않게 textarea 로 폴백.
 * 성공 여부를 돌려주니 alert 문구는 호출한 쪽에서.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* 아래 폴백 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

/**
 * 글을 카톡으로 보내기. 폰이면 기기 공유창을 띄워 카카오톡(또는 문자·메일)을 고르게 한다 — 카카오 SDK 공유는 삼성 인터넷 홈 화면 앱에서 안 열렸음(2026-11-23).
 * 공유창을 띄웠으면 true(그 뒤 "보냈나요?"는 호출한 쪽에서), 못 띄우면 false(호출한 쪽이 SDK·복사로 폴백).
 */
export async function shareTextOnPhone(text: string): Promise<boolean> {
  if (!isMobileDevice() || typeof navigator === 'undefined' || !('share' in navigator)) return false;
  try { await navigator.share({ text }); return true; }
  catch (e) { return e instanceof Error && e.name === 'AbortError'; } // 사용자가 공유창을 닫은 것도 "띄우긴 했다"
}
