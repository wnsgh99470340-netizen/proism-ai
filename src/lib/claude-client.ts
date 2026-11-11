interface MessageContent {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

interface Message {
  role: 'user' | 'assistant';
  content: string | MessageContent[];
}

export async function callClaude(
  systemPrompt: string,
  messages: Message[],
  maxTokens = 4096,
  model = 'claude-sonnet-4-6'
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다. .env.local 파일을 확인해주세요.');
  }

  // Opus 5 계열은 안전 분류기 거부 시 서버가 대체 모델로 이어 쓰도록 fallbacks 를 붙인다
  const useFallback = /^claude-(opus-5|fable)/.test(model);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...(useFallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
      ...(useFallback ? { fallbacks: 'default' } : {}),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API 오류: ${response.status} - ${error}`);
  }

  const data = await response.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('Claude가 요청을 거부했습니다. ' + (data.stop_details?.explanation || ''));
  }
  // thinking 블록이 앞에 올 수 있으므로 text 블록만 이어붙인다
  return (data.content as { type: string; text?: string }[])
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('');
}

/** 사진 여러 장을 한 번에 보고 답한다 (글 작성 전 사진 확인용, 2026-11-12) */
export async function analyzeImagesWithClaude(
  images: { data: string; mediaType: string }[],
  prompt: string,
  maxTokens = 1500,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          ...images.map((im, i) => [
            { type: 'text', text: `[사진 ${i + 1}]` },
            { type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } },
          ]).flat(),
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });
  if (!response.ok) throw new Error(`Claude Vision API 오류: ${response.status} - ${await response.text()}`);
  const data = await response.json();
  return data.content?.[0]?.text || '';
}

export async function analyzeImageWithClaude(
  base64Data: string,
  mediaType: string,
  prompt: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude Vision API 오류: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.content[0]?.text || '';
}

/* ───────────────────────────────────────────────────────────────
 * 웹 검색 리서치 (Anthropic 서버측 web_search 도구 사용)
 * - 별도 검색 API 키 불필요. Claude가 직접 검색하고 요약을 돌려줌
 * - 서버측 도구 루프가 10회를 넘으면 pause_turn 으로 멈추므로 이어서 재요청
 * ─────────────────────────────────────────────────────────────── */

interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface MessagesResponse {
  content: ContentBlock[];
  stop_reason: string;
  stop_details?: { category?: string | null; explanation?: string } | null;
  usage?: { server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } };
}

export interface ResearchResult {
  text: string;
  searchCount: number;
  fetchCount: number;
}

export async function researchWithWebSearch(
  systemPrompt: string,
  userPrompt: string,
  options: {
    maxSearches?: number;
    maxContinuations?: number;
    model?: string;
    /** 대화에 포함된 URL 본문을 읽는 web_fetch 도구 허용 (도메인 제한) */
    fetch?: { maxUses: number; allowedDomains: string[] };
  } = {}
): Promise<ResearchResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
  }

  const {
    maxSearches = 10,
    maxContinuations = 3,
    model = 'claude-opus-5-5',
    fetch: fetchOpt,
  } = options;

  const tools: Record<string, unknown>[] = [
    {
      type: 'web_search_20260209',
      name: 'web_search',
      max_uses: maxSearches,
      user_location: { type: 'approximate', country: 'KR', timezone: 'Asia/Seoul' },
    },
  ];
  if (fetchOpt) {
    tools.push({
      type: 'web_fetch_20260209',
      name: 'web_fetch',
      max_uses: fetchOpt.maxUses,
      allowed_domains: fetchOpt.allowedDomains,
      max_content_tokens: 20000,
    });
  }

  const messages: { role: 'user' | 'assistant'; content: string | ContentBlock[] }[] = [
    { role: 'user', content: userPrompt },
  ];

  let searchCount = 0;
  let fetchCount = 0;
  let finalText = '';

  for (let attempt = 0; attempt <= maxContinuations; attempt++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        system: systemPrompt,
        messages,
        tools,
        output_config: { effort: 'medium' },
        fallbacks: 'default',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude 리서치 API 오류: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as MessagesResponse;

    if (data.stop_reason === 'refusal') {
      const why = data.stop_details?.explanation || data.stop_details?.category || '';
      throw new Error(`Claude 리서치 요청이 거부되었습니다. ${why}`.trim());
    }

    searchCount += data.usage?.server_tool_use?.web_search_requests
      ?? data.content.filter(b => b.type === 'server_tool_use' && b.name === 'web_search').length;
    fetchCount += data.usage?.server_tool_use?.web_fetch_requests ?? 0;

    // 웹 검색 인용이 붙은 text 블록은 문장 중간에서 나뉘므로 줄바꿈 없이 이어붙인다
    finalText += data.content
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text as string)
      .join('');

    if (data.stop_reason !== 'pause_turn') break;

    // 서버측 도구 루프가 중단된 경우: 응답을 그대로 붙여 이어서 요청
    messages.push({ role: 'assistant', content: data.content });
  }

  return { text: finalText.trim(), searchCount, fetchCount };
}
