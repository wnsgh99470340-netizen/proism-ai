'use client';

import { useState, useRef, useEffect } from 'react';
import ChatMessage from './ChatMessage';
import ImageUpload from './ImageUpload';
import type { UploadedImage } from './ImageUpload';
import BlogRequestForm from './BlogRequestForm';
import type { BlogRequest, BlogPrefill } from '@/config/blog-options';

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

interface ChatPanelProps {
  messages: Message[];
  onSendMessage: (message: string, images: UploadedImage[], request?: BlogRequest) => void;
  loading: boolean;
  images: UploadedImage[];
  onImagesChange: (images: UploadedImage[]) => void;
  /** CRM에서 넘어온 폼 미리 채우기 값 */
  prefill?: BlogPrefill | null;
}

export default function ChatPanel({
  messages,
  onSendMessage,
  loading,
  images,
  onImagesChange,
  prefill = null,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [formOpen, setFormOpen] = useState(true);
  useEffect(() => { if (prefill) setFormOpen(true); }, [prefill]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() && images.length === 0) return;
    onSendMessage(input.trim(), images);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };


  return (
    <div className="flex flex-col h-full">
      {/* 시공기 빠른 생성 폼 토글 (고정) */}
      <div className="shrink-0 border-b border-[var(--c-border)]">
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2 text-[11px] text-[var(--c-text-3)] hover:text-[var(--c-text-1)]"
        >
          <span>{formOpen ? '▾' : '▸'} 시공기 빠른 생성 폼</span>
          <span>{formOpen ? '접기' : '펼치기'}</span>
        </button>
      </div>

      {/* 폼 + 메시지 (한 영역에서 함께 스크롤 — 모바일에서 폼이 화면을 다 차지하지 않게) */}
      <div className="flex-1 overflow-y-auto px-3 md:px-4 pb-4">
        {formOpen && (
          <div className="-mx-3 md:-mx-4 pb-3 border-b border-[var(--c-border)] mb-4">
            <BlogRequestForm
              key={prefill ? `prefill-${prefill.source || ''}-${prefill.model || ''}` : 'blank'}
              initial={prefill}
              disabled={loading}
              onSubmit={(message, request) => {
                onSendMessage(message, images, request);
                setFormOpen(false);
              }}
            />
          </div>
        )}
        {messages.length === 0 && (
          <div className={`flex flex-col items-center justify-center text-center ${formOpen ? 'py-6' : 'h-full'}`}>
            <div className="text-4xl mb-3">◆</div>
            <h2 className="text-[var(--c-text-1)] font-semibold text-base mb-1">3M 프로이즘 AI</h2>
            <p className="text-[var(--c-text-3)] text-xs mb-6 max-w-xs">
              사진을 올리고 대화하면 네이버 블로그 글이 자동으로 완성됩니다
            </p>
            <div className="grid grid-cols-2 gap-2 max-w-sm w-full">
              {[
                'BMW M4 전체 PPF 시공기 써줘',
                '벤츠 GLC 윈도우몰딩 크롬죽이기 시공기 써줘',
                '이번 달 콘텐츠 캘린더 짜줘',
                '강남 PPF 키워드 분석해줘',
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => {
                    setInput(prompt);
                    inputRef.current?.focus();
                  }}
                  className="text-left bg-[#1a1a1f] border border-[var(--c-border)] rounded-xl px-3 py-2.5 text-xs text-[var(--c-text-2)] hover:border-[#C8A951]/50 hover:text-[var(--c-text-1)] transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <ChatMessage key={i} {...msg} />
        ))}

        {loading && (
          <div className="flex mb-4 gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#C8A951]/10 flex items-center justify-center text-sm shrink-0">
              ✍️
            </div>
            <div className="bg-[#1a1a1f] border border-[var(--c-border)] rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-[#C8A951] animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-[#C8A951] animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-[#C8A951] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 이미지 업로드 */}
      <ImageUpload
        images={images}
        onImagesChange={onImagesChange}
      />

      {/* 입력 */}
      <div className="p-3 border-t border-[var(--c-border)]">
        <div className="flex gap-2 items-end bg-[#1a1a1f] border border-[var(--c-border)] rounded-xl px-3 py-2 focus-within:border-[#C8A951]/50 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="메시지를 입력하세요..."
            rows={1}
            className="flex-1 bg-transparent text-[var(--c-text-1)] text-sm placeholder-[#71717a] resize-none outline-none min-h-[20px] max-h-[120px]"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <button
            onClick={handleSend}
            disabled={loading || (!input.trim() && images.length === 0)}
            className="shrink-0 w-9 h-9 md:w-8 md:h-8 rounded-lg bg-[#E4002B] hover:bg-[#c60026] disabled:bg-[var(--c-subtle)] disabled:text-[var(--c-text-3)] text-white flex items-center justify-center transition-colors text-sm"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
