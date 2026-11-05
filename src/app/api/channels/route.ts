import { NextRequest } from 'next/server';
import { generateChannels } from '@/lib/channels';

export const maxDuration = 300;

/** 시공기 → 인스타 캡션 + 카페 대표이야기 (본문 사실만 사용) */
export async function POST(request: NextRequest) {
  try {
    const { title, content, serviceType = '', carModel = '' } = await request.json() as {
      title: string; content: string; serviceType?: string; carModel?: string;
    };
    if (!title || !content) return Response.json({ error: '제목과 본문이 필요합니다.' }, { status: 400 });
    const channels = await generateChannels(title, content, serviceType, carModel);
    return Response.json({ channels });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '알 수 없는 오류';
    return Response.json({ error: msg }, { status: 500 });
  }
}
