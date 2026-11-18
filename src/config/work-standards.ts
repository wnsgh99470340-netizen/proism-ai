/**
 * 부위별 시공 기준 사전 (2026-11-18)
 *
 * 출처: 카넥트 노션 "시공 작업 참고자료"(류하솜, 2026-01) + CLAUDE.md 시공 규칙 + 사장님 발행 글.
 * 용도: 시공기를 쓸 때 그 글이 다루는 부위의 기준만 꺼내 "왜 그렇게 하는지"의 근거로 프롬프트에 넣는다.
 *
 * 규칙
 * - 랩핑·크롬죽이기 글에서만 전부 쓴다. 컬러PPF(PWF)는 pwfSafe 항목만(열·오버랩·늘림 서술 금지 규칙 유지).
 * - PPF(투명)는 이 사전을 쓰지 않는다. 노션 PPF 항목은 랩핑 글을 복사한 것이라 틀림 → 사장님 인터뷰로 따로 만든다.
 * - 탈거·분해 서술은 넣지 않는다(요청에 없는 탈거는 자동 검사가 잡음).
 * - 문장은 선언("원칙입니다")이 아니라 장면의 근거가 되도록 쓴다. 프롬프트에서도 옮겨 적지 말라고 지시한다.
 * - 어휘: 본넷·휀다·앞범퍼·뒷범퍼·도어·루프·트렁크 (사장님 어휘). 휠아치·카울 같은 금지 용어 쓰지 않음.
 */

export type StandardService = '랩핑' | '크롬죽이기' | '컬러PPF';

export interface StandardFact {
  text: string;
  /** 컬러PPF(PWF) 글에도 써도 되는 사실인가 (열·오버랩·늘림·주름 방향 같은 랩핑 전용 서술은 false) */
  pwfSafe: boolean;
}

export interface WorkStandard {
  key: string;
  /** 글에 쓰는 부위 이름 */
  part: string;
  /** 요청문·사진 확인 결과에서 이 부위를 찾는 패턴 */
  match: RegExp;
  services: StandardService[];
  facts: StandardFact[];
}

export const WORK_STANDARDS: WorkStandard[] = [
  {
    key: 'bumper', part: '앞범퍼·뒷범퍼', match: /범퍼|범버|bumper/i, services: ['랩핑', '컬러PPF'],
    facts: [
      { text: '차 외관에서 곡과 각이 제일 가파른 판이라 전체 중 가장 어렵고, 여기서 틀어지면 문제도 가장 크게 남는다', pwfSafe: true },
      { text: '주행풍·빗물·돌을 가장 먼저 맞는 자리라 끝단이 조금이라도 들떠 있으면 거기서부터 문제가 시작된다', pwfSafe: true },
      { text: '한 장으로 넘길 수 없는 자리는 필름을 나누되, 이어지는 선을 범퍼의 각이 꺾이는 선에 두어 티가 나지 않게 한다', pwfSafe: false },
      { text: '필름을 한계 가까이 늘려 붙이는 판이라 색 빠짐과 필름 터짐을 보면서 가고, 주름 방향과 당기는 방향을 맞춰야 시간이 지나도 들뜨지 않는다', pwfSafe: false },
    ],
  },
  {
    key: 'hood', part: '본넷', match: /본넷|보닛|후드|hood/i, services: ['랩핑', '컬러PPF'],
    facts: [
      { text: '넓은 판이라 두 명이 함께 올린다. 한 번에 안착시켜야 먼지 유입과 들림이 적다', pwfSafe: true },
      { text: '앞유리 쪽 끝단은 각이 가파르고 자세가 안 나와서 마감에 신경이 가장 많이 가는 자리다', pwfSafe: true },
      { text: '앞쪽에서 가장 넓고 눈에 잘 띄는 판이라 표면에 남는 자국이 그대로 보인다', pwfSafe: true },
    ],
  },
  {
    key: 'front_fender', part: '앞휀다·A필러', match: /앞\s*휀[다더]|프론트\s*휀[다더]|프론트\s*펜더|앞\s*펜더|A\s*필러|휀[다더]/i, services: ['랩핑', '컬러PPF'],
    facts: [
      { text: '앞휀다 윗부분과 A필러가 만나는 자리는 각이 여럿 모여 있어 마감이 좁고 까다롭다. 이 부분만 봐도 작업 수준이 보인다는 말이 있다', pwfSafe: true },
      { text: '헤드라이트와 만나는 곳은 고무 몰딩 안쪽으로 필름을 넣어 마감한다. 찢기거나 끼이기 쉬워 몰딩을 살짝 들고 천천히 넣는다', pwfSafe: true },
      { text: '휀다 안쪽(바퀴 쪽)에 이물질이 많이 남아 있어 세척이 부족하면 필름이 들뜬다', pwfSafe: true },
    ],
  },
  {
    key: 'rear_fender', part: '뒷휀다', match: /뒷\s*휀[다더]|쿼터\s*휀[다더]|쿼터\s*펜더|리어\s*휀[다더]|뒷\s*펜더|C\s*필러/i, services: ['랩핑', '컬러PPF'],
    facts: [
      { text: '테일램프와 C필러 고무 몰딩 쪽 마감에 신경을 쓴다. 램프 틈으로 마감 길이를 최대한 길게 빼서 순정 도장이 보이지 않게 한다', pwfSafe: true },
      { text: '색 반전이 큰 작업은 뒷도어를 열고 안쪽까지 길고 깊게 마감해야 틈과 단차 사이로 원래 색이 보이지 않는다(계단식 마감)', pwfSafe: true },
    ],
  },
  {
    key: 'door', part: '도어', match: /도어|문짝|문\s*(?:끝|안쪽|열)/, services: ['랩핑', '컬러PPF'],
    facts: [
      { text: '윈도우 몰딩 사이를 미숙하게 자르면 틈으로 순정 도장이 비친다. 몰딩 쪽 커팅이 도어 마감의 핵심이다', pwfSafe: true },
      { text: '1열·2열 도어 사이가 계단처럼 단차가 진 차는 한 장으로 계단식 마감을 한다', pwfSafe: true },
      { text: '도어 한 판은 필름 한 장으로 간다. 두 장으로 나눠 겹치지 않는다', pwfSafe: true },
      { text: '새 차는 도어 하단에 구리스나 방청유가 남아 있는 경우가 많아 탈지를 제대로 해야 필름이 붙어 있는다', pwfSafe: true },
      { text: '도어 하단은 허리를 굽혀야 해서 자세가 안 나오고, 잘 안 보이는 자리라 대충 넘기기 쉬운 곳이다. 그래서 더 시간을 들인다', pwfSafe: true },
    ],
  },
  {
    key: 'side_step', part: '사이드스텝', match: /사이드\s*스텝|사이드\s*스탭|스커트|사이드\s*실/i, services: ['랩핑', '컬러PPF'],
    facts: [
      { text: '차 가장 아래라 눕거나 허리를 깊이 굽혀 작업한다. 자세가 안 나와 마감선이 삐뚤기 쉬운 곳이다', pwfSafe: true },
      { text: '노면 이물질이 가장 많이 묻는 자리라 전처리 세척이 표면 상태를 좌우한다', pwfSafe: true },
    ],
  },
  {
    key: 'roof', part: '루프', match: /루프|지붕|선루프|파노라마/, services: ['랩핑', '컬러PPF'],
    facts: [
      { text: '판 모양은 단순하지만 선루프와 샤크안테나가 있느냐에 따라 난이도가 달라진다', pwfSafe: true },
      { text: '자외선을 가장 많이 받는 자리라 싼 필름을 쓰면 점착면이 떠서 제거가 어렵고 제거할 때 도장을 다친다', pwfSafe: true },
      { text: '루프 몰딩이 앞유리까지 이어지는 차는 한 장으로 안 되어 이어 붙이는 자리가 생긴다', pwfSafe: false },
    ],
  },
  {
    key: 'trunk', part: '트렁크', match: /트렁크|테일\s*게이트|테일게이트/, services: ['랩핑', '컬러PPF'],
    facts: [
      { text: '한 장으로 가고, 윗면과 아랫면은 따로 시공한다', pwfSafe: true },
      { text: '각이 심한 판이라 주름 방향과 반대로 자르면 나중에 주름이 올라온다', pwfSafe: false },
      { text: '뒷범퍼와 만나는 경계와 테일램프 사이 구간까지 필름 끝이 보이지 않게 정리한다', pwfSafe: true },
    ],
  },
  {
    key: 'shark', part: '샤크안테나', match: /샤크\s*안테나|안테나/, services: ['랩핑'],
    facts: [
      { text: '작지만 곡이 심해 잘못 붙이면 가장 잘 들뜨는 부품이다. 작은 부품에 랩핑 기술이 가장 많이 들어간다', pwfSafe: false },
    ],
  },
  {
    key: 'door_catch', part: '도어캐치', match: /도어\s*캐치|손잡이|도어\s*핸들/, services: ['랩핑', '컬러PPF'],
    facts: [
      { text: '큰 판보다 작은 부품에서 들뜸과 색 빠짐이 더 자주 생긴다. 곡이 심해 주름이 잡히는 자리의 마감이 모자라면 시간이 지나 올라온다', pwfSafe: false },
      { text: '손잡이 주변은 겉에서 마감선이 보이지 않도록 접히는 면을 따라 필름을 넘긴다', pwfSafe: true },
    ],
  },
  {
    key: 'mirror', part: '사이드미러 커버', match: /사이드\s*미러|미러\s*커버/, services: ['랩핑', '컬러PPF'],
    facts: [
      { text: '되도록 한 장으로 해결하고, 한 장으로 무리가 가는 자리만 나눠 간다', pwfSafe: false },
      { text: '겉에서 보이는 면과 아래쪽 접히는 면의 마감선을 같은 기준으로 맞춘다', pwfSafe: true },
    ],
  },
  {
    key: 'spoiler', part: '스포일러', match: /스포일러/, services: ['랩핑'],
    facts: [
      { text: '자외선을 많이 받는 부품이라 무리하게 늘리거나 마감부에 강한 텐션을 주면 수축과 수명 단축의 원인이 된다', pwfSafe: false },
    ],
  },
  {
    key: 'chrome', part: '크롬 몰딩', match: /크롬|몰딩|그릴|엠블럼|윈도우\s*라인|창틀/, services: ['크롬죽이기'],
    facts: [
      { text: '3M 2080 글로스블랙으로 몰딩을 감싼다. 떼지 않고 작업하며 손잡이만 분리한다', pwfSafe: false },
      { text: '긴 라인은 처음부터 끝까지 같은 간격으로 끝단을 정리해야 멀리서 봤을 때 선이 흔들리지 않는다', pwfSafe: false },
      { text: '꺾이는 구간은 열로 텐션을 조절해 필름이 되돌아오지 않게 잡는다', pwfSafe: false },
      { text: '유리와 만나는 경계는 끝단을 고무 안쪽으로 넣어 밖에서 크롬이 비치지 않게 한다', pwfSafe: false },
      { text: '한 장으로 안 되는 자리는 겹치는 선을 꺾이는 곳에 두어 티가 나지 않게 마감한다', pwfSafe: false },
      { text: '의뢰한 부위만 다룬다. 윈도우몰딩 의뢰면 그릴·범퍼 이야기는 섞지 않는다', pwfSafe: false },
    ],
  },
];

/** 시공 종류 문자열 → 사전을 쓰는 서비스. PPF(투명)·썬팅·신차패키지는 null */
export function standardServiceOf(serviceType: string): StandardService | null {
  const s = serviceType || '';
  if (/크롬/.test(s)) return '크롬죽이기';
  if (/컬러\s*PPF|PWF/i.test(s)) return '컬러PPF';
  if (/랩핑/.test(s)) return '랩핑';
  return null;
}

const DEFAULT_FULL = ['bumper', 'hood', 'front_fender', 'door'];
const MAX_PARTS = 5;

/**
 * 이번 글에 넣을 부위 기준 고르기.
 * userText(요청문+폼 범위)와 사진 확인 결과의 "보이는 부위" 줄에서 부위를 찾고, 전체 시공이거나 못 찾으면 큰 판 4개를 기본으로.
 */
export function pickWorkStandards(serviceType: string, userText: string, researchContext: string): WorkStandard[] {
  const service = standardServiceOf(serviceType);
  if (!service) return [];
  const panelsLine = (researchContext.match(/보이는 부위:\s*([^\n]+)/) || [])[1] || '';
  const hint = `${userText}\n${panelsLine}`;
  const usable = WORK_STANDARDS.filter(s => s.services.includes(service));
  const forService = (s: WorkStandard): WorkStandard | null => {
    const facts = service === '컬러PPF' ? s.facts.filter(f => f.pwfSafe) : s.facts;
    return facts.length ? { ...s, facts } : null;
  };
  let picked = usable.filter(s => s.match.test(hint));
  if (service === '크롬죽이기') {
    const chrome = usable.find(s => s.key === 'chrome');
    if (chrome && !picked.some(s => s.key === 'chrome')) picked.unshift(chrome);
    // 크롬죽이기는 몰딩 기준이 핵심. 손잡이·미러가 요청에 있을 때만 그것도
    picked = picked.filter(s => s.key === 'chrome' || /손잡이|미러/.test(userText));
  } else if (picked.length < 2 || /전체|풀\s*랩핑|full/i.test(userText)) {
    for (const k of DEFAULT_FULL) {
      const s = usable.find(x => x.key === k);
      if (s && !picked.some(p => p.key === k)) picked.push(s);
    }
  }
  return picked.map(forService).filter((s): s is WorkStandard => !!s).slice(0, MAX_PARTS);
}

/** 프롬프트 블록. 목록을 옮겨 적지 말고 장면의 근거로만 쓰게 한다 */
export function workStandardsPrompt(service: StandardService | null, picked: WorkStandard[]): string {
  if (!service || picked.length === 0) return '';
  const lines = picked.map(s => `- ${s.part}: ${s.facts.map(f => f.text).join(' / ')}`);
  const pwfNote = service === '컬러PPF' ? ' PWF는 건식이라는 것 외에 열·늘림·겹침 서술은 쓰지 않는다.' : '';
  return `\n\n[부위별 작업 기준 — 장면의 근거로만]\n아래는 이 글에서 다룰 부위의 작업 기준이다. 목록을 옮겨 적거나 부위마다 전부 설명하지 말고, 그 부위를 쓰는 문단에서 "왜 그렇게 하는지"의 근거로 한두 문장만 녹인다(2~3곳이면 충분). "원칙입니다·저희는 ~합니다·노하우·우리만" 같은 선언과 다른 매장 비교는 쓰지 않는다. 적힌 것 밖의 숫자·탈거·분해 서술은 만들지 않는다.${pwfNote}\n${lines.join('\n')}`;
}
