/**
 * 프로이즘이 다른 이유 — 차별점 사실표 (2026-11-16)
 * 배경: 월요일 회의에서 "블로그를 우리만의 차별화(3M 인스톨러·3M 본사 협업·왜 전문적인가)로 어필하자"는 요청.
 * 참고 블로그(부산 팀 좋은소리)는 자격 나열이 아니라 고정 서명 한 줄 + 환경·과정의 이유 + 사후 책임 공지 + 인연 이야기로 전문성을 전달함.
 * 출처: 2025-08-13 글로벌에픽 개점 기사(사장님 보도자료) + CLAUDE.md 확정 사실.
 *
 * 규칙
 * - status 'confirmed' 만 글 생성 프롬프트에 들어간다. 'check' 는 사장님이 "지금도 맞다"고 확인하면 confirmed 로 바꾼다
 * - 글마다 1~2개만 골라 작업 설명 안에 녹인다(선언·나열 금지). 자격 줄·경력 연수·"제가 직접 합니다"는 여전히 금지
 * - 숫자·고유명사는 fact 문장 그대로만 쓴다
 */
/** confirmed = 글에 자동 주입 / check = 사장님 확인 전 / reference = 사실이지만 참고만(사장님 지시 없이는 글에 안 씀) */
export type DiffStatus = 'confirmed' | 'check' | 'reference';

export interface Differentiator {
  key: string;
  label: string;
  /** 글에 그대로 옮겨도 되는 사실 문장 */
  fact: string;
  /** 어떤 글에서 자연스러운지 */
  fitsIn: string;
  status: DiffStatus;
  source: string;
}

/** 모든 글의 자기소개 한 줄 (자격 줄은 따로 두지 않고 서명에 3M 정체성을 넣는다) */
export const SIGNATURE_LINE = '3M 프리퍼드 인스톨러 매장, 3M 프로이즘 강남서초점 진준호입니다';

export const DIFFERENTIATORS: Differentiator[] = [
  {
    key: 'preferred',
    label: '3M 공인 프리퍼드 인스톨러 매장',
    fact: '3M 프로이즘 강남서초점은 3M이 공인한 프리퍼드 인스톨러 매장이다 (자격은 "3M 프리퍼드 인스톨러"로만 쓰고 랩핑·PPF·썬팅 어느 트랙인지, 랩마스터 같은 랩핑 전용 인증은 쓰지 않는다)',
    fitsIn: '제품(3M 필름) 이야기가 나오는 자리, 왜 3M 정품·3M 기준으로 작업하는지 설명할 때',
    status: 'confirmed',
    source: 'CLAUDE.md 대표 자격 / 2025-08 개점 기사',
  },
  {
    key: 'one_stop',
    label: '신차패키지 전 공정 한곳에서, 같은 품질 기준',
    fact: '썬팅·PPF·컬러PPF·랩핑·크롬죽이기·생활보호·실내 PPF·유리막코팅을 한 매장에서 같은 품질 기준으로 진행한다',
    fitsIn: '신차패키지 글, 여러 시공을 같이 한 글',
    status: 'confirmed',
    source: '2025-08 개점 기사 / 서비스 목록',
  },
  {
    key: 'aftercare',
    label: 'QC 2주 + 6개월 메인터넌스',
    fact: '시공 2주 뒤 QC로 다시 점검하고, 이후 6개월마다 메인터넌스(필름 위 전용 코팅제 도포·끝단 점검)로 관리한다',
    fitsIn: '관리 안내 자리. "출고로 끝나지 않는다"는 흐름',
    status: 'confirmed',
    source: 'CLAUDE.md 시공 규칙 / 2025-08 개점 기사',
  },
  {
    key: 'process_ppf',
    label: 'PPF 외부는 판시공 핸드커팅, 끝단 안쪽 마감, 오버랩 없음',
    fact: 'PPF 외부 패널은 컴퓨터 재단 대신 차에 대고 판시공 핸드커팅으로 올리고 끝단을 안쪽으로 말아 마감하며, 오버랩을 두지 않는다',
    fitsIn: 'PPF·컬러PPF 글의 작업 설명',
    status: 'confirmed',
    source: 'CLAUDE.md 시공 규칙',
  },
  {
    key: 'inspection',
    label: '신차검수를 먼저',
    fact: '신차패키지는 도장 두께 측정·진단장비·배터리 점검을 먼저 하고, 작업 중에는 메모리 세이버를 연결해 둔다',
    fitsIn: '신차패키지·신차검수 글',
    status: 'confirmed',
    source: '2026-11-14 5시리즈 최종본(사장님 확인)',
  },
  // ---- 2026-11-16 사장님 확인("다 맞는 것 같은데") + 공개 자료 조사(docs/3M-차별점-조사-2026-11-16.md) ----
  {
    key: 'brand_3m',
    label: '3M과 협업해 만든 브랜드, 자체 3M 교육 과정',
    fact: '3M 프로이즘(운영사 카넥트)은 글로벌 기업 3M과 협업해 출범한 브랜드로, 3M 공인 트레이너가 운영하는 자체 교육 과정(3M 필름 트레이닝 센터 SOP 기준)에서 사람을 기르고, 모든 패키지 작업에 같은 품질 기준을 적용한다',
    fitsIn: '3M 제품·기준 이야기, "왜 3M 프로이즘인가"',
    status: 'confirmed',
    source: '2025-11-03 이넷뉴스(하남점 개점) / 2025-08 글로벌에픽',
  },
  {
    key: 'trainer_coowner',
    label: '3M 공인 트레이너가 운영하는 교육(이름 없이)',
    fact: '3M 프로이즘의 교육 과정은 3M 공인 트레이너(3M Authorized Trainer, 3M 프리퍼드 인스톨러 교육·인증 시험 감독 자격)가 운영한다',
    fitsIn: '작업 기준·교육 이야기. 한 줄만, 사람 이름·경력 연수·"직접 시공" 표현 없이(글은 진준호 1인칭, 2026-11-16 사장님)',
    status: 'confirmed',
    source: '2025-11-03 이넷뉴스 / 2026-11-16 사장님(공동대표 확인)',
  },
  {
    key: 'trained_only',
    label: '3M 교육 과정을 마친 사람만 작업',
    fact: '시공에는 3M 프로이즘 자체 교육 과정(3M 필름 트레이닝 센터 SOP 기준)을 마친 사람만 들어가고, 숙련도가 낮은 교육생은 참여하지 않는다',
    fitsIn: '작업 과정 설명. 작업자 소개가 아니라 기준 설명으로',
    status: 'confirmed',
    source: '2025-08·11 기사 / 2026-11-16 사장님 확인',
  },
  {
    key: 'dedicated_chat',
    label: '차량 1대당 전담 담당 + 전용 채팅으로 실시간 공유',
    fact: '차량마다 전담 담당자가 붙고, 작업 상황을 전용 채팅 채널로 차주에게 실시간 공유한다',
    fitsIn: '작업 과정 설명, 상담 문턱 낮추는 자리',
    status: 'confirmed',
    source: '2025-08 개점 기사 / 2026-11-16 사장님 확인',
  },
  {
    key: 'membership',
    label: '3M PROIZM 멤버십 (운영 안 함 — 글에 쓰지 않음)',
    fact: '(2026-11-16 사장님: 멤버십은 두 대표 모두 생각해 본 적이 없음. 보도자료에만 있던 문구. 실제로 만들기 전까지 글에 쓰지 않는다)',
    fitsIn: '사용 안 함',
    status: 'check',
    source: '2025-08 개점 기사에만 있음 / 2026-11-16 사장님 "한 번도 생각해 본 적 없어"',
  },
  {
    key: 'logistics',
    label: '탁송 + 시공 기간 대차',
    fact: '작업 전 탁송 서비스를 지원하고, 시공 기간 중 차량이 필요한 분께는 대차를 제공한다',
    fitsIn: '3박 4일 전체 PPF 글의 입고 이야기',
    status: 'confirmed',
    source: '2025-08·11 기사 / 2026-11-16 사장님 확인',
  },
  {
    key: 'warranty',
    label: '3M 정품 전자 보증서 발급',
    fact: '3M 공식 시공점이라 시공 뒤 3M 정품 전자 보증서를 발급하고, 보증 문제가 생기면 매장에 먼저 연락하면 전자 보증서와 영수증으로 3M 보증 절차를 진행한다',
    fitsIn: '제품 이야기, 관리 안내 (보증 "기간" 숫자는 사장님이 알려준 것만, 3M 고객센터 번호는 쓰지 않음)',
    status: 'confirmed',
    source: '3M 코리아 FAQ·시리즈150 제품 페이지 / 2026-11-16 사장님 "발급해줘"',
  },
  {
    key: 'product_understanding',
    label: '제품을 이해하고 시공하는 교육',
    fact: '3M 교육은 붙이는 법만이 아니라 제품을 이해하는 교육이다. 필름마다 한계 텐션이 있고 시공 과정에서 내구성이 떨어지는 요소가 있는데, 그것을 알고 작업하는 것과 모르고 작업하는 것은 몇 년 뒤 결과가 다르다',
    fitsIn: '작업 설명에서 "왜 이렇게 하는지"를 말할 때. 선언이 아니라 그 작업 장면에 붙여서',
    status: 'confirmed',
    source: '2026-11-16 류하솜 대표(본사 협업의 뜻: 제품 정보·한계 텐션·내구성 저하 요소를 숙지하고 시공)',
  },
  {
    key: 'why_3m',
    label: '왜 3M인가',
    fact: '잘 붙이는 것을 넘어 오래 타도 그대로인 품질을 원했고, 고객이 시공을 오랫동안 잘 쓰길 바라서 3M을 골랐다',
    fitsIn: '제품 선택 이유 도입, 마무리 한 줄. 한 번만',
    status: 'confirmed',
    source: '2026-11-16 류하솜 대표',
  },
  // ---- 사장님 목소리 (2026-11-16 진준호 대표 답) — 1인칭으로, 선언이 아니라 장면·판단에 붙여서. 글마다 하나 이하
  {
    key: 'owner_voice_film',
    label: '교육에서 바뀐 생각: 필름이 다 거기서 거기인 줄 알았다',
    fact: '3M 교육을 받기 전에는 필름이 다 거기서 거기겠지 생각했다. 받고 나서는 필름마다 다르다는 걸 알게 됐고, 그 뒤로는 제품을 알고 붙이는 쪽으로 바뀌었다',
    fitsIn: '제품 이야기 도입, 왜 3M인가 옆에. 과거형 한두 줄로',
    status: 'confirmed',
    source: '2026-11-16 사장님',
  },
  {
    key: 'owner_voice_standard',
    label: '양보하지 않는 세 가지: 안쪽 마감·이물질·필름 표면 상태',
    fact: '작업에서 끝까지 양보하지 않는 것은 세 가지다. 끝단 안쪽 마감, 필름 아래 이물질, 필름 표면 상태',
    fitsIn: '작업 설명 중 끝단·전처리·완성 확인 장면에 붙여서. 나열보다 그 장면에서 왜 멈춰서 다시 보는지로',
    status: 'confirmed',
    source: '2026-11-16 사장님',
  },
  {
    key: 'owner_voice_responsibility',
    label: '맡겨야 하는 이유: 대응부터 출고까지 책임',
    fact: '고객 대응부터 입고, 작업, 출고까지 한 사람이 책임지고, 만족하실 수 있게 끝까지 한다',
    fitsIn: '마무리 상담 문턱 앞 한 줄, 전담 담당 이야기 옆. "최선을 다한다" 같은 선언 대신 흐름 속 한 줄로',
    status: 'confirmed',
    source: '2026-11-16 사장님',
  },
  // ---- 참고만 (2026-11-16 사장님 "이건 참고만 해"): 기둥 글이나 사장님 지시가 있을 때만 쓴다 ----
  {
    key: 'wrapmaster_network',
    label: '3M 랩마스터 네트워크',
    fact: '3M과 진행하는 협업 중 하나로 전국에서 3M 랩마스터를 선발해 "3M 프로이즘" 이름을 쓰게 하는 네트워크가 있다',
    fitsIn: '기둥 글(왜 3M 프로이즘인가)에서만',
    status: 'reference',
    source: '2026-11-16 사장님',
  },
  {
    key: 'first_store',
    label: '강남서초점이 3M 프로이즘의 첫 매장',
    fact: '본점은 하남이지만, 3M 프로이즘은 류하솜·진준호 공동대표가 강남서초점에서 제일 처음 시작했다',
    fitsIn: '기둥 글, 매장 소개 글에서만',
    status: 'reference',
    source: '2026-11-16 사장님',
  },
];

export const confirmedDifferentiators = () => DIFFERENTIATORS.filter(d => d.status === 'confirmed');

/** 이번 글에 쓸 차별점 1~2개 고르기 (시공 종류에 맞는 것 우선, 나머지는 무작위) */
export function pickDifferentiators(serviceType: string, previousKeys: string[] = []): Differentiator[] {
  const pool = confirmedDifferentiators();
  const fits = (d: Differentiator) =>
    (/신차/.test(serviceType) && /신차|여러 시공/.test(d.fitsIn)) ||
    (/PPF|PWF/.test(serviceType) && /PPF/.test(d.fitsIn));
  const preferred = pool.filter(d => fits(d) && !previousKeys.includes(d.key));
  const rest = pool.filter(d => !preferred.includes(d) && !previousKeys.includes(d.key));
  const shuffle = <T,>(a: T[]) => [...a].sort(() => Math.random() - 0.5);
  return [...shuffle(preferred), ...shuffle(rest), ...shuffle(pool)].filter((d, i, arr) => arr.indexOf(d) === i).slice(0, 2);
}

export function differentiatorPrompt(picked: Differentiator[]): string {
  if (picked.length === 0) return '';
  const lines = picked.map(d => `- ${d.label}: ${d.fact} (${d.fitsIn})`);
  return `\n\n[프로이즘이 다른 이유 — 이번 글에 녹일 사실]\n자기소개는 "${SIGNATURE_LINE}" 한 줄로 쓴다(자격 줄·경력 연수·"제가 직접" 금지).\n아래 사실 중 글 흐름에 맞는 것을 1~2곳에서 작업 설명 안에 녹인다. "저희는 ~합니다"식 선언·나열로 모아 쓰지 않고, 왜 그렇게 하는지와 함께 한 문단 안에서 말한다. 적힌 문장 밖의 숫자·고유명사는 만들지 않는다.\n${lines.join('\n')}`;
}
