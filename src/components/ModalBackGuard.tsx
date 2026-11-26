'use client';
import { useEffect } from 'react';

/**
 * 모달을 뒤로가기로 닫기 (2026-11-26 사장님 "모달도 뒤로가기로 닫히게").
 * 앱의 모달은 전부 `.fixed.inset-0` 배경 위에 그려지고, 그 배경을 누르면 닫힌다. 그 약속을 그대로 쓴다:
 *  - 모달이 열리면(배경 수가 늘면) 브라우저 기록에 빈 항목 하나를 넣는다
 *  - 뒤로가기(popstate)가 오면 맨 위 모달의 배경을 클릭해 닫는다 → 화면이 바뀌지 않고 모달만 닫힌다
 *  - 닫기 버튼으로 닫았으면 우리가 넣은 항목을 history.back() 으로 거둬, 다음 뒤로가기가 두 번 눌리지 않게 한다
 * 모달을 새로 만들 때 배경 div 에 `fixed inset-0` + 배경 onClick=닫기 를 지키면 따로 할 일이 없다.
 */
const SEL = '.fixed.inset-0';
const KEY = '__modalGuard';

export default function ModalBackGuard() {
  useEffect(() => {
    let count = document.querySelectorAll(SEL).length;
    let poppedAt = 0;        // 뒤로가기로 닫힌 직후 (이때 줄어든 건 back() 하지 않음)
    let selfBack = false;    // 우리가 부른 history.back() 의 popstate 는 무시
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onPop = () => {
      if (selfBack) { selfBack = false; return; }
      const overlays = document.querySelectorAll<HTMLElement>(SEL);
      if (overlays.length === 0) return;
      poppedAt = Date.now();
      overlays[overlays.length - 1].click(); // 맨 위 모달의 배경 클릭 = 닫기
    };
    window.addEventListener('popstate', onPop);

    const sync = () => {
      const now = document.querySelectorAll(SEL).length;
      if (now > count) {
        // 열림: 늘어난 만큼 기록 추가 (주소·Next 상태는 그대로 두고 표식만)
        for (let i = count; i < now; i++) window.history.pushState({ ...(window.history.state || {}), [KEY]: true }, '');
      } else if (now < count) {
        // 닫힘: 뒤로가기로 닫힌 게 아니면 우리가 넣은 항목을 거둔다
        if (Date.now() - poppedAt > 600 && window.history.state && window.history.state[KEY]) {
          selfBack = true;
          window.history.back();
        }
      }
      count = now;
    };
    const mo = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(sync, 30); // 닫히자마자 다른 모달이 열리는 경우(상담 추가 → 고객 추가)를 한 번에 본다
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { window.removeEventListener('popstate', onPop); mo.disconnect(); if (timer) clearTimeout(timer); };
  }, []);
  return null;
}
