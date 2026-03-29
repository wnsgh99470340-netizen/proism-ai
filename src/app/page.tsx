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
  analysis?: {
    vehicle: string;
    stage: string;
    description: string;
    suggestion: string;
    caption: string;
  } | null;
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
  const [qaScore, setQaScore] = useState<{ total: number; details: string } | null>(null);
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

      // 이미지 분석 결과가 있으면 자동 메시지 추가
      const analyzedImages = uploadedImages.filter((img) => img.analysis);
      if (analyzedImages.length > 0 && !message) {
        const analysisMessages: Message[] = analyzedImages.map((img) => ({
          role: 'assistant' as const,
          content: `📷 사진을 분석했습니다.\n\n🔍 분석 결과:\n• 차종: ${img.analysis!.vehicle}\n• 장면: ${img.analysis!.description}\n• 시공 단계: ${img.analysis!.stage}\n\n💡 ${img.analysis!.suggestion}\n\n이 사진을 어떻게 활용할까요?\n1. 시공기 본문에 삽입\n2. 다른 위치에 배치\n3. 이 사진에 대한 캡션 작성`,
          employeeName: '비주얼 디렉터',
          employeeEmoji: '🎨',
          employeeColor: '#EC4899',
          analysis: img.analysis,
        }));
        setMessages((prev) => [...prev, ...analysisMessages]);
        setActiveEmployeeId('visual-dir');
        setLoading(false);
        setImages([]); // 전송 후 이미지 목록 초기화
        return;
      }

      try {
        // 이미지 base64 변환
        const imageData = [];
        for (const img of uploadedImages) {
          if (img.file) {
            const buffer = await img.file.arrayBuffer();
            const base64 = btoa(
              new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
            );
            imageData.push({
              data: base64,
              mediaType: img.file.type || 'image/jpeg',
            });
          }
        }

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
            images: imageData,
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
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: data.reply,
              employeeName: data.activeEmployee?.name,
              employeeEmoji: data.activeEmployee?.emoji,
              employeeColor: data.activeEmployee?.color,
            },
          ]);

          if (data.activeEmployee) {
            setActiveEmployeeId(data.activeEmployee.id);
          }

          if (data.draft) {
            setDraft(data.draft);
            // 자동 SEO 분석
            fetchSeoInsight(data.draft.title, data.draft.content, data.draft.tags);
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
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `다음 블로그 글의 QA 스코어링을 해줘. 100점 만점으로 채점하고 개선점을 알려줘.\n\n제목: ${draft.title}\n\n본문:\n${draft.content}\n\n태그: ${draft.tags.join(', ')}`,
          history: [],
          images: [],
        }),
      });
      const data = await res.json();
      if (data.reply) {
        // 점수 추출
        const scoreMatch = data.reply.match(/(\d{1,3})\s*[/\/점]/);
        const total = scoreMatch ? Math.min(parseInt(scoreMatch[1]), 100) : 75;
        setQaScore({ total, details: data.reply });
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
