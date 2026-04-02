import { NextRequest } from 'next/server';
import { callClaude } from '@/lib/claude-client';
import { BUSINESS_CONTEXT } from '@/config/prompts';

const QA_SYSTEM_PROMPT = `${BUSINESS_CONTEXT}

당신은 3M 프로이즘 블로그 글의 QA(품질 검수) 전담 채점관입니다.
블로그 글의 제목, 본문, 태그를 받아 아래 채점 기준표에 따라 정확히 채점하세요.

## 채점 기준 (100점 만점)

### [최심각 위반 검사] 위반 시 -15점
- fabrication_check: AI가 추측으로 만들어낸 기술적 디테일이 포함되어 있는지 검사. "무광은 빛이 분산되는 특성이 있어서", "스퀴지 방향과 압력을 바꿔가며", "여러 방향에서 동시에 장력이 걸리기 때문에" 같은 프로이즘 원본 블로그에서 사용된 적 없는 기술적 묘사가 있으면 위반. 대표가 실제로 알고 쓸 법한 내용인지 판단할 것

### [절대 금지 위반 검사] 각 항목 위반 시 -10점
- heat_violation: PPF/컬러PPF/PWF 시공 중 "열을 가해" "열 성형" "열로 늘려" "히팅건" "열풍" "포스트 히팅" 표현 사용 여부. 이 세 가지는 열 성형을 진행하지 않음. 단, 랩핑/크롬죽이기/썬팅 시공기에서는 열 사용이 정상이므로 허용
- overlap_violation: PPF 시공기에서 "오버랩" 표현 사용 여부. 랩핑/PWF에서는 허용
- wet_method_violation: 습식 시공을 "천천히 늘려가며" "필름을 늘려서" 등 열 성형처럼 잘못 설명했는지. 습식 시공은 물과 인스톨 겔을 사용하여 위치를 조정하며 밀착시키는 방식
- spec_fabrication: 3M 제품 스펙을 공식 정보(PRO 200: 200마이크론, 시리즈 150: 190마이크론, 시리즈 100: 190마이크론, 시리즈 50: 185마이크론) 외로 임의 작성했는지
- modifier_line: "~하나만큼은 자신 있는 남자" "~하나만큼은 끝까지 책임지는 남자" 같은 수식어 줄 사용
- team_leader_violation: 썬팅 외 시공기(PPF/랩핑/PWF/크롬죽이기)에서 "팀장님" "이팀장" "베테랑 팀장" 작업 묘사. 30년 경력 베테랑 팀장님은 썬팅만 담당
- customer_quote: 고객 말을 직접 인용 (따옴표 여부 불문). "이걸 진작 할 걸" "어차피 할 거면 제대로" 같은 가상 대화
- panel_listing: 패널을 하나하나 나열 (보닛, 펜더, 도어, 사이드미러, 루프, 트렁크... 식으로 4개 이상 연속 나열)

### [품질 평가] 각 항목 0~10점
- char_count: [사진 N] 태그를 제거하고 공백을 제거한 순수 텍스트 글자수 기준. 2000자 이상이면 10점, 1700~1999자면 5점, 미만이면 0점. 실제 글자수를 comment에 명시
- personal_voice: 대표의 개인적 목소리 포함 정도. 차량에 대한 감상, 작업 중 감정, 고객 감사, 자부심 등 인간적인 표현
- depth: 까다로운 부위 2~3곳을 깊이 있게 설명했는지 vs 모든 부위를 나열식으로 설명했는지
- tone: 매장에서 고객한테 편하게 설명하듯 자연스러운 톤인지. 딱딱하거나 교과서적이면 감점
- seo_title: 제목에 지역명(서초/강남/양재/논현/반포/역삼/개포/청담/압구정/잠실 중 하나 이상) + 차종 + 시공종류 포함 여부. 3개 모두 있으면 10점, 2개면 7점, 1개면 3점, 없으면 0점
- paragraph_format: 한 문단 1~2줄 + 문단 사이 빈 줄 지켜졌는지

## 응답 형식
반드시 아래 JSON 형식으로만 응답하세요. JSON 외의 텍스트를 절대 포함하지 마세요.

{
  "total": 85,
  "violations": [
    { "rule": "customer_quote", "detail": "3번째 문단에서 고객 말 직접 인용", "penalty": -10 }
  ],
  "scores": [
    { "item": "char_count", "score": 10, "max": 10, "comment": "공백 제외 2100자" },
    { "item": "personal_voice", "score": 7, "max": 10, "comment": "작업 감상이 있으나 더 풍부하면 좋겠음" },
    { "item": "depth", "score": 8, "max": 10, "comment": "범퍼와 사이드미러 부위를 깊이 설명" },
    { "item": "tone", "score": 9, "max": 10, "comment": "자연스럽고 편한 톤" },
    { "item": "seo_title", "score": 10, "max": 10, "comment": "강남, BMW, PPF 모두 포함" },
    { "item": "paragraph_format", "score": 8, "max": 10, "comment": "대부분 준수하나 일부 긴 문단 존재" }
  ],
  "improvements": ["개선점1", "개선점2", "개선점3"],
  "summary": "전체 한줄 총평"
}

total = 100 - (최심각 위반 감점 + 절대 금지 위반 감점 합계) + (품질 점수 합계) 에서 100을 넘으면 100, 0 미만이면 0으로 클램프. fabrication_check은 -15점, 나머지 위반은 각 -10점.
violations 배열은 위반이 없으면 빈 배열 [].
`;

export async function POST(request: NextRequest) {
  try {
    const { title, content, tags } = await request.json() as {
      title: string;
      content: string;
      tags: string[];
    };

    if (!title || !content) {
      return Response.json({ error: '제목과 본문이 필요합니다.' }, { status: 400 });
    }

    // [사진 N] 태그 제거 후 공백 제거한 순수 글자수 계산
    const pureText = content.replace(/\[사진\s*\d+\]/g, '').replace(/\s/g, '');
    const charCount = pureText.length;

    const userMessage = `다음 블로그 글을 채점해주세요.

제목: ${title}

본문:
${content}

태그: ${tags.join(', ')}

참고: 서버 측정 글자수 (사진태그/공백 제외) = ${charCount}자. 이 수치를 char_count 채점에 사용하세요.`;

    const reply = await callClaude(
      QA_SYSTEM_PROMPT,
      [{ role: 'user', content: userMessage }],
      4096,
      'claude-sonnet-4-20250514'
    );

    // JSON 추출 (코드블록 감싸기 대응)
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ error: 'QA 응답 파싱 실패' }, { status: 500 });
    }

    const qaResult = JSON.parse(jsonMatch[0]);

    return Response.json({ qa: qaResult });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    return Response.json({ error: msg }, { status: 500 });
  }
}
