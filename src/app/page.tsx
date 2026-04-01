'use client';

import { useState, useCallback } from 'react';
import TopBar from '@/components/TopBar';
import ChatPanel from '@/components/ChatPanel';
import PreviewPanel from '@/components/PreviewPanel';
import HelpModal from '@/components/HelpModal';
import type { UploadedImage } from '@/components/ImageUpload';

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

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
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

  const handleSendMessage = useCallback(
    async (message: string, uploadedImages: UploadedImage[]) => {
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

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            history,
            images: imageRefs,
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
            // 자동 SEO 분석
            fetchSeoInsight(parsedDraft.title, parsedDraft.content, parsedDraft.tags);
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
    [messages]
  );

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
    <div className="h-screen flex flex-col bg-[#09090b]">
      <TopBar activeEmployeeId={activeEmployeeId} onHelpClick={() => setHelpOpen(true)} />

      <div className="flex-1 flex min-h-0">
        {/* 대화 패널 (60%) */}
        <div className="w-[60%] flex flex-col min-h-0">
          <ChatPanel
            messages={messages}
            onSendMessage={handleSendMessage}
            loading={loading}
            images={images}
            onImagesChange={setImages}
          />
        </div>

        {/* 미리보기 + 인사이트 (40%) */}
        <div className="w-[40%] min-h-0">
          <PreviewPanel
            draft={draft}
            images={images.map((img) => img.url)}
            qaScore={qaScore}
            seoInsight={seoInsight}
            onCopyHtml={handleCopyHtml}
            onRunQA={handleRunQA}
            qaLoading={qaLoading}
          />
        </div>
      </div>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
