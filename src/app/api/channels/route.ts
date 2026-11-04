import { NextRequest } from 'next/server';
import { callClaude } from '@/lib/claude-client';
import { BUSINESS_CONTEXT } from '@/config/prompts';

export const maxDuration = 300;

/**
 * 시공기 한 편 → 인스타그램 버전 + 네이버 카페 "대표이야기" 버전
 * 원칙: 블로그 본문에 있는 사실만 쓴다. 새 사실·수치·제품·부위를 추가하면 안 된다.
 */
const CHANNELS_PROMPT = `${BUSINESS_CONTEXT}

당신은 위 매장의 블로그 시공기를 다른 채널용으로 다시 쓰는 편집자입니다.
가장 중요한 원칙: **아래 블로그 본문에 없는 사실은 한 글자도 추가하지 않습니다.** 차량 정보, 제품, 부위, 작업 내용, 수치는 본문에 있는 것만 씁니다. 본문에 없으면 빼세요. 대표 경력 연수 금지, 고객 말 따옴표 인용 금지, 이모지는 인스타 해시태그 줄 외에는 쓰지 않습니다.

두 가지를 만듭니다.

## 1. 인스타그램 (피드 캡션)
- 첫 줄: 스크롤을 멈추게 하는 한 줄 (차종+시공 결과 느낌). 광고 문구 금지
- 본문: 300~500자. 블로그에서 가장 인상 깊은 부위 1곳과 제품 1개만 골라 짧게. 줄바꿈 자주
- 마지막 줄: 문의 안내 한 줄 (010-7287-7140, 서초)
- 해시태그: 10~15개, 별도 배열. 차종·시공·지역·3M 제품 조합 (예: #BMWM2PPF #서초PPF #3MPRO200)
- 사진 추천: 블로그의 [사진 N] 중 인스타 첫 장으로 쓸 번호 1개와 이유 한 줄

## 2. 네이버 카페 "대표이야기"
- 카페(cafe.naver.com/3mproism) 회원에게 대표가 직접 말하듯 쓰는 짧은 에세이. 블로그보다 사적이고 솔직한 톤
- 제목: 이 시공에서 배운 점·판단 하나를 담은 문장형 제목 (예: "M2 앞범퍼를 두 번에 나눠 잡은 이유")
- 본문 800~1,200자. 구조: 그날 상황 한두 줄 → 그 차에서 내린 판단 하나와 이유 → 고객에게 해주고 싶은 말 → 짧은 마무리
- 블로그 문장을 그대로 복사하지 말고 다시 말하기. 해시태그·사진 태그 없음. 제품 스펙 나열 금지

## 출력 (JSON만, 다른 텍스트 금지)
{
  "instagram": { "caption": "본문 전체(첫 줄 포함, 해시태그 제외)", "hashtags": ["#태그1", "#태그2"], "coverPhoto": "사진 N — 이유" },
  "cafe": { "title": "제목", "body": "본문" }
}`;

export async function POST(request: NextRequest) {
  try {
    const { title, content, serviceType = '', carModel = '' } = await request.json() as {
      title: string; content: string; serviceType?: string; carModel?: string;
    };
    if (!title || !content) return Response.json({ error: '제목과 본문이 필요합니다.' }, { status: 400 });

    const plain = content.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').trim();
    const userMsg = `[차종] ${carModel || '(본문 참고)'} / [시공] ${serviceType || '(본문 참고)'}

[블로그 제목]
${title}

[블로그 본문]
${plain}`;

    const reply = await callClaude(CHANNELS_PROMPT, [{ role: 'user', content: userMsg }], 6000, 'claude-opus-5-5');
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return Response.json({ error: '채널 변환 응답 파싱 실패' }, { status: 500 });
    const parsed = JSON.parse(jsonMatch[0]) as {
      instagram?: { caption?: string; hashtags?: string[]; coverPhoto?: string };
      cafe?: { title?: string; body?: string };
    };

    return Response.json({
      channels: {
        instagram: {
          caption: parsed.instagram?.caption || '',
          hashtags: Array.isArray(parsed.instagram?.hashtags) ? parsed.instagram!.hashtags : [],
          coverPhoto: parsed.instagram?.coverPhoto || '',
        },
        cafe: { title: parsed.cafe?.title || '', body: parsed.cafe?.body || '' },
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '알 수 없는 오류';
    return Response.json({ error: msg }, { status: 500 });
  }
}
