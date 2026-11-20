/**
 * 사장님이 직접 쓴 글 — 말투 기준 (2026-11-20 사장님 "FAQ나 공지글 참고해")
 * 시공기(실장·AI 글이 섞임) 대신 FAQ·공지 글만 말투 참고로 쓴다. 제목으로 고른다(blog_posts owner 에서 제목 일치).
 * 글을 더 넣거나 빼려면 이 목록만 고치면 된다. 본문 1,500자 미만(영상 위주 글)은 뺐다.
 */
export const OWNER_VOICE_TITLES: string[] = [
  '자동차 PPF 가격 싸게 붙였다가 왜 돈을 또 쓰게 되는 걸까요?',
  '자동차 랩핑 업체 고를 때 손해 보지 않으려면 확인할 3가지',
  '최저 PPF 가격 시공업체 검색은 그만 결국에는 돈만 두 배로 듭니다',
  '컬러 PPF PWF 시공 업체 선택 주의사항, 프리미엄 차량 오너 가이드',
  '자동차 랩핑 업체 선정시 소비자가 반드시 고려해야할 것들',
  '자동차PPF 실패 없이 차량 랩핑 업체 고르는 방법 총 정리',
  '3M 랩마스터 랩핑 PPF 세미나 후기 프로이즘 서초점 일상',
  '자동차랩핑 가격에 절대 속으면 안되는 이유',
  '자동차 랩핑 가격은 숫자일 뿐, 중요한 것은 기회비용입니다.',
  '공간지앤지 프로이즘 인테리어 공사 마무리',
  '자동차PPF 차량에 적용할 때 꼭 체크해야 하는 부분',
  '왜 프로이즘은 자동차 외장 관리 솔루션으로 3M PPF 필름 시공을 추천하는가',
];

const norm = (s: string) => s.replace(/\s+/g, '').replace(/[.,!?]/g, '').toLowerCase();
export function isOwnerVoiceTitle(title: string): boolean {
  const t = norm(title);
  return OWNER_VOICE_TITLES.some(x => norm(x) === t);
}
