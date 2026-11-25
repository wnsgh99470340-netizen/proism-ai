/**
 * 도입 아이디어 사전 (2026-11-25).
 * 출처: 3M 프로이즘 블로그 3개(roice_·poi_1357·effort--, 전부 하남 운영) 1,775편 크롤링에서 추린 도입 방식.
 * 사장님 결정(2026-11-25 "너의 생각대로"): 말투 참고 풀은 roice_ 사장님 글만 유지하고, 하남 두 블로그는
 * 구조·도입 아이디어로만 쓴다. 프롬프트에 자동 주입하지 않는다 — 폼에서 사장님이 하나 고르면 그 한 줄만 요청문에 붙는다.
 * 예문은 그 블로그들의 실제 첫 줄을 짧게 옮긴 것(과장 표현은 뺌). 모르는 건 쓰지 않는다·과장하지 않는다 규칙은 그대로.
 */
export interface OpeningIdea {
  key: string;
  /** 칩에 보이는 이름 */
  label: string;
  /** 현장 메모에 무엇을 적으면 이 도입이 되는지 */
  hint: string;
  /** 세 블로그의 실제 도입 예(짧게) */
  example: string;
}

export const OPENING_IDEAS: OpeningIdea[] = [
  { key: 'reason', label: '손님이 온 이유', hint: '손님이 처음 뭘 고민했고 어떤 말로 문의했는지', example: '흰색 그대로도 깔끔한데 차주님은 어딘가 2% 부족한 스포티함이 아쉬우셨습니다 (poi_1357)' },
  { key: 'revisit', label: '다시 온 차', hint: '전에 한 작업이 몇 년 지났고 이번에 뭘 하러 왔는지', example: '4년 전 루프스킨과 크롬죽이기를 받으신 차가 관리 주기가 돼 다시 들어왔습니다 (poi_1357)' },
  { key: 'dealer', label: '어디서 넘어왔나', hint: '딜러·동호회·소개 등 어떻게 우리에게 왔는지', example: '딜러분께 썬팅을 받고 나온 신차를 저희가 이어받았습니다 (roice_)' },
  { key: 'car', label: '오늘 차 한 줄', hint: '차종·세대·색을 한 줄로, 그 뒤 바로 작업으로', example: '오늘 작업한 차는 BMW M440i 컨버터블, 포르티마오 블루입니다 (roice_)' },
  { key: 'spec', label: '시공 내역부터', hint: '필름·농도·범위를 첫 줄에 적고 설명은 뒤에', example: '기아 EV3 GT라인 / 3M 크리스탈라인 전면 40 측후면 20 (roice_)' },
  { key: 'question', label: '질문 하나', hint: '손님들이 실제로 자주 묻는 말 하나로 시작', example: '이거 꼭 PPF 필요한 거야? — 스팅어 차주분이 처음 하신 말입니다 (poi_1357)' },
  { key: 'misread', label: '흔한 오해 바로잡기', hint: '손님들이 잘못 알고 오는 것 하나와 실제는 어떤지', example: '루프스킨은 꾸미기만을 위한 선택일까요? 제거 뒤 상태를 보면 다릅니다 (poi_1357)' },
  { key: 'hard', label: '이 차에서 어려운 곳', hint: '이 차종에서 시간이 많이 간 부위와 왜 그런지', example: '레인지로버 썬팅은 유리 곡과 분해 때문에 웬만한 차보다 손이 많이 갑니다 (effort--)' },
  { key: 'removal', label: '벗겨 보니', hint: '기존 필름을 제거하며 본 상태, 그래서 이번에 어떻게 했는지', example: 'PPF를 벗겨 보니 왜 좋은 제품이어야 하는지 바로 보였습니다 (poi_1357)' },
  { key: 'season', label: '요즘 매장 풍경', hint: '이 시기에 어떤 차·어떤 작업이 많이 오는지 한 줄 뒤 오늘 차로', example: '요즘 신차 출고 뒤 신차패키지와 전체 PPF를 함께 알아보시는 분이 많아졌습니다 (roice_)' },
  { key: 'done', label: '출고 장면부터', hint: '끝나고 손님이 차를 봤을 때 있었던 일부터, 작업은 그 뒤에', example: '출고 날 손님이 먼저 본 곳은 도어 끝단이었습니다 — 거기서부터 이야기합니다' },
  { key: 'event', label: '매장 소식·후기', hint: '세미나·교육·행사 뒤 느낀 것(시공기 아닌 글)', example: '3M 랩마스터 세미나에 다녀온 후기를 공유합니다 (roice_)' },
];

/** 폼에 보여 줄 무작위 N개 */
export function pickOpeningIdeas(n = 3, exclude: string[] = []): OpeningIdea[] {
  const pool = OPENING_IDEAS.filter(o => !exclude.includes(o.key));
  const out: OpeningIdea[] = [];
  const used = new Set<number>();
  while (out.length < Math.min(n, pool.length)) {
    const i = Math.floor(Math.random() * pool.length);
    if (used.has(i)) continue;
    used.add(i); out.push(pool[i]);
  }
  return out;
}
