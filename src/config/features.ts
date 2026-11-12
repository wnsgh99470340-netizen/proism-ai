/**
 * 기능 스위치 (2026-11-12)
 * - INSTAGRAM_VIDEO_PAUSED: 인스타용 영상(정보 릴스·말하기 영상)을 전부 멈춘다. 블로그 영상은 계속 만든다.
 *   2026-11-12 사장님: "일단 지금은 블로그 업로드 영상은 만들고 인스타 영상은 다 중단시켜"
 *   다시 켜려면 false 로 바꾸고 .github/workflows/render-video.yml 의 run_media.py 줄 주석을 푼다.
 */
export const INSTAGRAM_VIDEO_PAUSED = true;
export const INSTAGRAM_PAUSED_NOTE = '인스타 영상(정보 릴스·말하기 영상)은 지금 멈춰 둔 상태입니다. 블로그 영상만 만듭니다.';
