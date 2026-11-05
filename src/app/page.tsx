'use client';

import { useState, useCallback } from 'react';
import TopBar from '@/components/TopBar';
import ChatPanel from '@/components/ChatPanel';
import PreviewPanel, { type Checks, type Channels } from '@/components/PreviewPanel';
import HelpModal from '@/components/HelpModal';
import type { UploadedImage } from '@/components/ImageUpload';
import type { BlogRequest } from '@/config/blog-options';
import type { BlogPost } from '@/lib/posts';
import { buildDraftFromText } from '@/lib/draft-format';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  employeeName?: string;
  employeeEmoji?: string;
  employeeColor?: string;
  images?: string[];
}

interface Draft {
  title: string;
  content: string;
  tags: string[];
  category: string;
}

// 서버(/api/chat)의 isBlogWriteRequest 와 동일한 키워드
const BLOG_REQUEST_KEYWORDS = ['블로그', '글 써', '글 작성', '써줘', '써 줘', '시공기', '포스팅', '작업기', '초안', '원고'];

const RESEARCH_PENDING_MESSAGE: Message = {
  role: 'assistant',
  content: '🔎 차량 구조와 같은 차종 시공 사례를 웹에서 검색하고 있습니다. 1~3분 정도 걸립니다.',
  employeeName: '사전 조사',
  employeeEmoji: '🔎',
  employeeColor: '#06B6D4',
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [checks, setChecks] = useState<Checks | null>(null);
  const [channels, setChannels] = useState<Channels | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [draftMeta, setDraftMeta] = useState<{ draftId: string | null; carModel: string | null; serviceType: string | null; product: string | null; region: string | null } | null>(null);
  const [activeEmployeeId, setActiveEmployeeId] = useState<string | undefined>();
  const [qaScore, setQaScore] = useState<{
    total: number;
    details: string;
    violations?: { rule: string; detail: string; penalty: number }[];
    scores?: { item: string; score: number; max: number; comment: string }[];
    improvements?: string[];
    summary?: string;
  } | null>(null);
  const [qaLoading, setQaLoading] = useState(false);
  const [seoInsight, setSeoInsight] = useState<{
    seoScore?: number;
    keywords?: string[];
    bestTime?: string;
    tips?: string[];
    summary?: string;
  } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  // 저장된 글 목록 갱신 트리거 (저장될 때마다 +1)
  const [postsRefreshKey, setPostsRefreshKey] = useState(0);
  // 모바일(md 미만)에서는 대화/미리보기를 탭으로 전환
  const [mobileView, setMobileView] = useState<'chat' | 'preview'>('chat');

  const updateResearchMessage = useCallback((content: string | null) => {
    setMessages((prev) => {
      let idx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].employeeName === RESEARCH_PENDING_MESSAGE.employeeName) { idx = i; break; }
      }
      if (idx === -1) return prev;
      if (content === null) return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
      const copy = [...prev];
      copy[idx] = { ...copy[idx], content };
      return copy;
    });
  }, []);

  const handleSendMessage = useCallback(
    async (message: string, uploadedImages: UploadedImage[], request?: BlogRequest) => {
      // 사용자 메시지 추가
      const userMsg: Message = {
        role: 'user',
        content: message,
        images: uploadedImages.map((img) => img.url),
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      // 이미지만 보내고 메시지가 없으면 안내 메시지 표시
      if (uploadedImages.length > 0 && !message) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant' as const,
            content: `사진 ${uploadedImages.length}장이 업로드되었습니다. 글 작성을 요청하시면 사진을 분석하여 블로그 글에 배치합니다.`,
            employeeName: '비주얼 디렉터',
            employeeEmoji: '🎨',
            employeeColor: '#EC4899',
          },
        ]);
        setLoading(false);
        setImages([]); // 전송 후 이미지 목록 초기화
        return;
      }

      try {
        // 이미지 URL/filename만 전달 (base64 전송 제거 — 서버에서 디스크 읽음)
        const imageRefs = uploadedImages.map((img) => ({
          url: img.url,
          filename: img.filename,
        }));

        const history = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        // 시공기 작성 요청이면 먼저 /api/research 로 차량 구조 + 시공 사례를 웹 검색
        // (검색이 수 분 걸릴 수 있어 글 작성 요청과 함수 실행시간을 분리)
        let research: { context: string; summary: string } | null = null;
        const isBlogRequest = Boolean(request) || BLOG_REQUEST_KEYWORDS.some((k) => message.includes(k));
        if (isBlogRequest) {
          setMessages((prev) => [...prev, RESEARCH_PENDING_MESSAGE]);
          try {
            const rRes = await fetch('/api/research', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message, request: request ?? null }),
            });
            const rData = await rRes.json();
            if (rData.research) {
              research = rData.research;
              updateResearchMessage(`🔎 ${rData.research.summary}`);
            } else {
              updateResearchMessage(null);
            }
          } catch {
            updateResearchMessage('🔎 사전 조사에 실패해 기존 지식으로 작성합니다.');
          }
        }

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            history,
            images: imageRefs,
            research,
            request: request ?? null,
          }),
        });

        const data = await res.json();

        if (data.error) {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: `⚠️ ${data.error}`,
              employeeName: '시스템',
              employeeEmoji: '⚠️',
              employeeColor: '#EF4444',
            },
          ]);
        } else {
          const displayReply = data.reply;
          const parsedDraft = data.draft;

          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: displayReply,
              employeeName: data.activeEmployee?.name,
              employeeEmoji: data.activeEmployee?.emoji,
              employeeColor: data.activeEmployee?.color,
            },
          ]);

          if (data.activeEmployee) {
            setActiveEmployeeId(data.activeEmployee.id);
          }

          if (parsedDraft) {
            setDraft(parsedDraft);
            setChecks(data.checks ?? null);
            setDraftMeta({
              draftId: data.draftId ?? null,
              carModel: data.target?.carModel ?? null,
              serviceType: data.target?.serviceType ?? null,
              product: data.target?.product ?? null,
              region: data.target?.region ?? null,
            });
            if (data.draftId) setPostsRefreshKey((k) => k + 1);
            setMobileView('preview');
            // 자동 SEO 분석
            fetchSeoInsight(parsedDraft.title, parsedDraft.content, parsedDraft.tags);
            // 인스타·카페 버전 동시 생성
            fetchChannels(parsedDraft.title, parsedDraft.content, data.target?.serviceType, data.target?.carModel);
          }
        }
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: '⚠️ 네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
            employeeName: '시스템',
            employeeEmoji: '⚠️',
            employeeColor: '#EF4444',
          },
        ]);
      }

      setLoading(false);
      setImages([]); // 전송 후 이미지 목록 초기화
    },
    [messages, updateResearchMessage]
  );

  const fetchChannels = async (title: string, content: string, serviceType?: string | null, carModel?: string | null) => {
    setChannels(null);
    setChannelsLoading(true);
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, serviceType: serviceType || '', carModel: carModel || '' }),
      });
      const data = await res.json();
      if (data.channels) setChannels(data.channels);
    } catch {
      // 채널 변환 실패는 블로그 글에 영향 없음
    } finally {
      setChannelsLoading(false);
    }
  };

  const savePost = async (payload: Record<string, unknown>): Promise<string | null> => {
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.error) setPostsRefreshKey((k) => k + 1);
      return data.error ? String(data.error) : null;
    } catch (e) {
      return e instanceof Error ? e.message : '네트워크 오류';
    }
  };

  /** 저장된 글을 눌러 미리보기에 다시 띄우기 */
  const handleOpenPost = (post: BlogPost) => {
    const d = buildDraftFromText(post.title, post.body);
    setDraft(d);
    setChecks(null);
    setChannels(null);
    setChannelsLoading(false);
    setQaScore(null);
    setSeoInsight(null);
    setDraftMeta({
      draftId: post.kind === 'draft' ? post.id : (post.draft_id ?? null),
      carModel: post.car_model ?? null,
      serviceType: post.service_type ?? null,
      product: post.product ?? null,
      region: post.region ?? null,
    });
    setMobileView('preview');
    const kindLabel = post.kind === 'final' ? '최종본' : post.kind === 'owner' ? '내 글' : '초안';
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: `📂 저장된 ${kindLabel}을 불러왔습니다: ${post.title}\n오른쪽 미리보기에서 확인하세요. 인스타·카페 버전이 필요하면 해당 탭에서 만들 수 있습니다.`,
        employeeName: '저장된 글',
        employeeEmoji: '📂',
        employeeColor: '#C8A951',
      },
    ]);
  };

  const handleMakeChannels = () => {
    if (!draft) return;
    const plain = draft.content.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').trim();
    fetchChannels(draft.title, plain, draftMeta?.serviceType, draftMeta?.carModel);
  };

  const handleSaveFinal = (title: string, body: string, feedback: string) =>
    savePost({
      kind: 'final', title, body, feedback,
      draft_id: draftMeta?.draftId ?? null,
      car_model: draftMeta?.carModel ?? null,
      service_type: draftMeta?.serviceType ?? null,
      product: draftMeta?.product ?? null,
      region: draftMeta?.region ?? null,
    });

  const handleSaveOwner = (title: string, body: string) => savePost({ kind: 'owner', title, body });

  const fetchSeoInsight = async (title: string, content: string, tags: string[]) => {
    try {
      const res = await fetch('/api/marketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `다음 블로그 글의 SEO를 분석해줘.\n제목: ${title}\n본문 앞부분: ${content.slice(0, 500)}\n태그: ${tags.join(', ')}`,
        }),
      });
      const data = await res.json();
      if (data.insight) {
        setSeoInsight(data.insight);
      }
    } catch {
      // SEO 분석 실패는 무시
    }
  };

  const handleCopyHtml = async () => {
    if (!draft) return;
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title,
          content: draft.content,
          tags: draft.tags,
          images: images.map((img) => img.url),
        }),
      });
      const data = await res.json();
      if (data.html) {
        await navigator.clipboard.writeText(data.html);
        alert('HTML이 클립보드에 복사되었습니다!\n\n네이버 블로그 에디터에서 HTML 모드로 전환 후 붙여넣기 하세요.');
      }
    } catch {
      alert('복사에 실패했습니다.');
    }
  };

  const handleRunQA = async () => {
    if (!draft) return;
    setQaLoading(true);
    try {
      const res = await fetch('/api/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title,
          content: draft.content,
          tags: draft.tags,
        }),
      });
      const data = await res.json();
      if (data.qa) {
        const qa = data.qa;
        // violations 텍스트 조합
        const violationLines = qa.violations.length > 0
          ? qa.violations.map((v: { rule: string; detail: string; penalty: number }) =>
              `[${v.rule}] ${v.detail} (${v.penalty}점)`
            ).join('\n')
          : '';
        // scores 텍스트 조합
        const scoreLines = qa.scores.map((s: { item: string; score: number; max: number; comment: string }) =>
          `${s.item}: ${s.score}/${s.max} — ${s.comment}`
        ).join('\n');
        // improvements 텍스트
        const improvementLines = qa.improvements.map((imp: string, i: number) =>
          `${i + 1}. ${imp}`
        ).join('\n');

        const details = [
          violationLines ? `⛔ 위반 사항:\n${violationLines}` : '',
          `📊 품질 점수:\n${scoreLines}`,
          `💡 개선점:\n${improvementLines}`,
          `📝 총평: ${qa.summary}`,
        ].filter(Boolean).join('\n\n');

        setQaScore({ total: qa.total, details, violations: qa.violations, scores: qa.scores, improvements: qa.improvements, summary: qa.summary });
      }
    } catch {
      // QA 실패 무시
    }
    setQaLoading(false);
  };

  return (
    <div className="h-dvh flex flex-col bg-[var(--c-page)]">
      <TopBar activeEmployeeId={activeEmployeeId} onHelpClick={() => setHelpOpen(true)} />

      <div className="flex-1 flex min-h-0">
        {/* 대화 패널: 데스크톱 60%, 태블릿 50%, 모바일은 탭으로 전환 */}
        <div className={`w-full md:w-1/2 lg:w-[60%] flex-col min-h-0 ${mobileView === 'chat' ? 'flex' : 'hidden md:flex'}`}>
          <ChatPanel
            messages={messages}
            onSendMessage={handleSendMessage}
            loading={loading}
            images={images}
            onImagesChange={setImages}
          />
        </div>

        {/* 미리보기 + 인사이트 */}
        <div className={`w-full md:w-1/2 lg:w-[40%] min-h-0 ${mobileView === 'preview' ? 'block' : 'hidden md:block'}`}>
          <PreviewPanel
            draft={draft}
            checks={checks}
            channels={channels}
            channelsLoading={channelsLoading}
            onSaveFinal={handleSaveFinal}
            onSaveOwner={handleSaveOwner}
            images={images.map((img) => img.url)}
            qaScore={qaScore}
            seoInsight={seoInsight}
            onCopyHtml={handleCopyHtml}
            onRunQA={handleRunQA}
            qaLoading={qaLoading}
            postsRefreshKey={postsRefreshKey}
            activePostId={draftMeta?.draftId ?? null}
            onOpenPost={handleOpenPost}
            onMakeChannels={handleMakeChannels}
          />
        </div>
      </div>

      {/* 모바일 하단 탭 (md 이상에서는 숨김) */}
      <div className="md:hidden shrink-0 border-t border-[var(--c-border)] bg-[var(--c-card)] grid grid-cols-2 pb-[env(safe-area-inset-bottom)]">
        <button
          onClick={() => setMobileView('chat')}
          className={`py-3 text-sm font-medium transition-colors ${mobileView === 'chat' ? 'text-[#C8A951] border-t-2 border-[#C8A951] -mt-px' : 'text-[var(--c-text-3)]'}`}
        >
          💬 대화{loading ? ' …' : ''}
        </button>
        <button
          onClick={() => setMobileView('preview')}
          className={`py-3 text-sm font-medium transition-colors relative ${mobileView === 'preview' ? 'text-[#C8A951] border-t-2 border-[#C8A951] -mt-px' : 'text-[var(--c-text-3)]'}`}
        >
          📄 미리보기
          {draft && mobileView !== 'preview' && (
            <span className="absolute top-2.5 ml-1 w-2 h-2 rounded-full bg-[#E4002B]" />
          )}
        </button>
      </div>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
