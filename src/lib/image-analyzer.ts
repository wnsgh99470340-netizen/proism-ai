import { analyzeImageWithClaude } from './claude-client';

const ANALYSIS_PROMPT = `이 사진을 분석해줘. 자동차 PPF/썬팅/랩핑 시공 관련 사진이야.

다음 정보를 JSON 형태로 답해줘:
{
  "vehicle": "차종 (알 수 있으면 구체적으로, 모르면 '확인 불가')",
  "stage": "시공 단계 (검수/전처리/세척/시공중/마감/완성 중 하나)",
  "description": "사진에 보이는 내용 1~2줄 설명",
  "suggestion": "블로그 글에서 이 사진을 어디에 넣으면 좋을지 구체적 제안",
  "recommendedPosition": "도입/검수/전처리/본시공/마감/완성 중 하나",
  "caption": "이 사진에 어울리는 블로그 캡션 1줄"
}

JSON만 출력해. 다른 텍스트 없이.`;

export interface ImageAnalysis {
  vehicle: string;
  stage: string;
  description: string;
  suggestion: string;
  recommendedPosition: string;
  caption: string;
}

export async function analyzeImage(
  base64Data: string,
  mediaType: string
): Promise<ImageAnalysis> {
  const result = await analyzeImageWithClaude(base64Data, mediaType, ANALYSIS_PROMPT);

  try {
    // JSON 블록만 추출
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // 파싱 실패 시 기본값
  }

  return {
    vehicle: '확인 불가',
    stage: '확인 불가',
    description: result.slice(0, 200),
    suggestion: '본문 중간에 배치하면 좋겠습니다.',
    recommendedPosition: '본시공',
    caption: '',
  };
}

export function sortImagesByStage(
  analyses: { index: number; analysis: ImageAnalysis }[]
): number[] {
  const stageOrder: Record<string, number> = {
    도입: 0,
    검수: 1,
    전처리: 2,
    세척: 2,
    시공중: 3,
    본시공: 3,
    마감: 4,
    완성: 5,
  };

  return analyses
    .sort((a, b) => {
      const orderA = stageOrder[a.analysis.recommendedPosition] ?? 3;
      const orderB = stageOrder[b.analysis.recommendedPosition] ?? 3;
      return orderA - orderB;
    })
    .map((a) => a.index);
}
