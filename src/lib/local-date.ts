/**
 * 서울 시간 기준 날짜 문자열(YYYY-MM-DD).
 * new Date().toISOString() 은 세계표준시(UTC)라 한국 오전 9시 전에는 전날이 나온다
 * (2026-11-12 08:03 에 홈이 11-11 로 보인 원인). 브라우저·Vercel 서버 어디서든 같은 날짜가 나오도록 여기 함수만 쓴다.
 */
const seoul = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });

export const toSeoulISO = (d: Date): string => seoul.format(d);

export const todaySeoul = (): string => toSeoulISO(new Date());

/** 날짜 문자열에 n일 더하기 */
export const addDaysISO = (iso: string, n: number): string => {
  const d = new Date(iso + 'T00:00:00+09:00');
  d.setDate(d.getDate() + n);
  return toSeoulISO(d);
};
