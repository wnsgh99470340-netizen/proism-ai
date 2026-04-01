'use client';

import { useState, useCallback } from 'react';

function CopyButton({ label, getText }: { label: string; getText: () => string }) {
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API 실패 시 무시
    }
  }, [getText]);

  return (
    <button
      onClick={handleClick}
      className="bg-[#1e1e22] hover:bg-[#2a2a2e] text-[#fafaf9] text-xs py-2.5 rounded-lg transition-colors font-medium"
    >
      {copied ? '✅ 복사됨!' : label}
    </button>
  );
}

interface Draft {
  title: string;
  content: string;
  tags: string[];
  category: string;
}

interface QAViolation {
  rule: string;
  detail: string;
  penalty: number;
}

interface QAScoreItem {
  item: string;
  score: number;
  max: number;
  comment: string;
}

interface QAScore {
  total: number;
  details: string;
  violations?: QAViolation[];
  scores?: QAScoreItem[];
  improvements?: string[];
  summary?: string;
}

interface PreviewPanelProps {
  draft: Draft | null;
  images: string[];
  qaScore: QAScore | null;
  seoInsight: {
    seoScore?: number;
    keywords?: string[];
    bestTime?: string;
    tips?: string[];
    summary?: string;
  } | null;
  onCopyHtml: () => void;
  onRunQA: () => void;
  qaLoading: boolean;
}

export default function PreviewPanel({
  draft,
  images,
  qaScore,
  seoInsight,
  onCopyHtml,
  onRunQA,
  qaLoading,
}: PreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'insight'>('preview');

  const renderContent = (content: string) => {
    // [IMAGE:N] → 실제 이미지
    let rendered = content.replace(/\[IMAGE:(\d+)\]/g, (_, idx) => {
      const i = parseInt(idx) - 1;
      if (images[i]) {
        return `<div style="text-align:center;margin:16px 0;"><img src="${images[i]}" style="max-width:100%;border-radius:8px;" /></div>`;
      }
      return `<div style="text-align:center;margin:16px 0;padding:40px;background:#f5f5f5;border-radius:8px;color:#999;font-size:13px;">📷 사진 ${idx}</div>`;
    });
    // 줄바꿈
    rendered = rendered.replace(/\n/g, '<br/>');
    // 볼드
    rendered = rendered.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    return rendered;
  };

  return (
    <div className="flex flex-col h-full bg-[#111113] border-l border-[#1e1e22]">
      {/* 탭 */}
      <div className="flex border-b border-[#1e1e22] shrink-0">
        <button
          onClick={() => setActiveTab('preview')}
          className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
            activeTab === 'preview'
              ? 'text-[#fafaf9] border-b-2 border-[#C8A951]'
              : 'text-[#71717a] hover:text-[#a1a1aa]'
          }`}
        >
          📄 미리보기
        </button>
        <button
          onClick={() => setActiveTab('insight')}
          className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
            activeTab === 'insight'
              ? 'text-[#fafaf9] border-b-2 border-[#C8A951]'
              : 'text-[#71717a] hover:text-[#a1a1aa]'
          }`}
        >
          📊 인사이트
        </button>
      </div>

      {/* 미리보기 탭 */}
      {activeTab === 'preview' && (
        <div className="flex-1 overflow-y-auto">
          {draft ? (
            <div className="m-3 bg-white rounded-xl overflow-hidden shadow-lg">
              <div className="p-5">
                <div className="text-[10px] text-gray-400 mb-2">네이버 블로그 미리보기</div>
                <h2 className="text-lg font-bold text-gray-900 mb-4 leading-tight">{draft.title}</h2>
                <div
                  className="text-sm text-gray-700 leading-[1.8]"
                  dangerouslySetInnerHTML={{ __html: renderContent(draft.content) }}
                />
                {draft.tags.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-gray-100 flex flex-wrap gap-1.5">
                    {draft.tags.map((tag, i) => (
                      <span key={i} className="text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-[#71717a] text-xs p-8 text-center">
              대화를 통해 블로그 글을 작성하면<br />
              여기에 미리보기가 표시됩니다
            </div>
          )}

          {/* 버튼들 */}
          {draft && (
            <div className="p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <CopyButton
                  label="📋 제목 복사"
                  getText={() => draft.title}
                />
                <CopyButton
                  label="📋 본문 복사"
                  getText={() => draft.content}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={onCopyHtml}
                  className="bg-[#1e1e22] hover:bg-[#2a2a2e] text-[#fafaf9] text-xs py-2.5 rounded-lg transition-colors font-medium"
                >
                  📋 HTML 복사
                </button>
                <button
                  onClick={onRunQA}
                  disabled={qaLoading}
                  className="bg-[#C8A951]/10 hover:bg-[#C8A951]/20 text-[#C8A951] text-xs py-2.5 rounded-lg transition-colors font-medium disabled:opacity-50"
                >
                  {qaLoading ? '채점중...' : '✅ QA 채점'}
                </button>
                <button
                  onClick={() => window.open('https://blog.naver.com/roice_/postwrite', '_blank')}
                  className="bg-[#03C75A]/10 hover:bg-[#03C75A]/20 text-[#03C75A] text-xs py-2.5 rounded-lg transition-colors font-medium"
                >
                  ✏️ 블로그 글쓰기
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 인사이트 탭 */}
      {activeTab === 'insight' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* QA 스코어 */}
          {qaScore && (
            <div className="space-y-3">
              {/* 총점 */}
              <div className="bg-[#1a1a1f] border border-[#1e1e22] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-[#fafaf9]">QA 채점 결과</span>
                  <span
                    className={`text-2xl font-bold ${
                      qaScore.total >= 90
                        ? 'text-[#10B981]'
                        : qaScore.total >= 70
                        ? 'text-[#F59E0B]'
                        : 'text-[#EF4444]'
                    }`}
                  >
                    {qaScore.total}<span className="text-sm text-[#71717a]">/100</span>
                  </span>
                </div>
                <div className="w-full bg-[#1e1e22] rounded-full h-2.5">
                  <div
                    className="h-2.5 rounded-full transition-all duration-500"
                    style={{
                      width: `${qaScore.total}%`,
                      backgroundColor:
                        qaScore.total >= 90 ? '#10B981' : qaScore.total >= 70 ? '#F59E0B' : '#EF4444',
                    }}
                  />
                </div>
                {qaScore.summary && (
                  <div className="mt-3 text-xs text-[#C8A951] leading-relaxed">{qaScore.summary}</div>
                )}
              </div>

              {/* 위반 사항 */}
              {qaScore.violations && qaScore.violations.length > 0 && (
                <div className="bg-[#1a1a1f] border border-[#EF4444]/30 rounded-xl p-3">
                  <div className="text-xs font-medium text-[#EF4444] mb-2">위반 사항</div>
                  <div className="space-y-2">
                    {qaScore.violations.map((v, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-[#EF4444] text-xs shrink-0 mt-0.5">{v.penalty}점</span>
                        <div>
                          <span className="text-xs font-mono text-[#EF4444]/80 bg-[#EF4444]/10 px-1.5 py-0.5 rounded">
                            {v.rule}
                          </span>
                          <p className="text-xs text-[#a1a1aa] mt-1">{v.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 품질 점수 항목별 */}
              {qaScore.scores && qaScore.scores.length > 0 && (
                <div className="bg-[#1a1a1f] border border-[#1e1e22] rounded-xl p-3">
                  <div className="text-xs font-medium text-[#fafaf9] mb-3">품질 점수</div>
                  <div className="space-y-2.5">
                    {qaScore.scores.map((s, i) => (
                      <div key={i}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-mono text-[#a1a1aa]">{s.item}</span>
                          <span className={`text-xs font-bold ${
                            s.score >= 8 ? 'text-[#10B981]' : s.score >= 5 ? 'text-[#F59E0B]' : 'text-[#EF4444]'
                          }`}>
                            {s.score}/{s.max}
                          </span>
                        </div>
                        <div className="w-full bg-[#1e1e22] rounded-full h-1.5 mb-1">
                          <div
                            className="h-1.5 rounded-full transition-all duration-500"
                            style={{
                              width: `${(s.score / s.max) * 100}%`,
                              backgroundColor:
                                s.score >= 8 ? '#10B981' : s.score >= 5 ? '#F59E0B' : '#EF4444',
                            }}
                          />
                        </div>
                        <div className="text-[10px] text-[#71717a]">{s.comment}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 개선점 */}
              {qaScore.improvements && qaScore.improvements.length > 0 && (
                <div className="bg-[#1a1a1f] border border-[#C8A951]/20 rounded-xl p-3">
                  <div className="text-xs font-medium text-[#C8A951] mb-2">개선점</div>
                  <div className="space-y-1.5">
                    {qaScore.improvements.map((imp, i) => (
                      <div key={i} className="text-xs text-[#a1a1aa] flex gap-1.5">
                        <span className="text-[#C8A951] shrink-0">{i + 1}.</span>
                        {imp}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SEO 인사이트 */}
          {seoInsight ? (
            <>
              {seoInsight.seoScore !== undefined && (
                <div className="bg-[#1a1a1f] border border-[#1e1e22] rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-[#fafaf9]">🔍 SEO 점수</span>
                    <span className="text-lg font-bold text-[#03C75A]">{seoInsight.seoScore}/100</span>
                  </div>
                  <div className="w-full bg-[#1e1e22] rounded-full h-2">
                    <div
                      className="h-2 rounded-full bg-[#03C75A] transition-all duration-500"
                      style={{ width: `${seoInsight.seoScore}%` }}
                    />
                  </div>
                </div>
              )}

              {seoInsight.keywords && seoInsight.keywords.length > 0 && (
                <div className="bg-[#1a1a1f] border border-[#1e1e22] rounded-xl p-3">
                  <div className="text-xs font-medium text-[#fafaf9] mb-2">🏷️ 추천 키워드</div>
                  <div className="flex flex-wrap gap-1.5">
                    {seoInsight.keywords.map((kw, i) => (
                      <span key={i} className="text-xs bg-[#03C75A]/10 text-[#03C75A] px-2 py-0.5 rounded-full">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {seoInsight.bestTime && (
                <div className="bg-[#1a1a1f] border border-[#1e1e22] rounded-xl p-3">
                  <div className="text-xs font-medium text-[#fafaf9] mb-1">⏰ 최적 발행 시간</div>
                  <div className="text-sm text-[#C8A951]">{seoInsight.bestTime}</div>
                </div>
              )}

              {seoInsight.tips && seoInsight.tips.length > 0 && (
                <div className="bg-[#1a1a1f] border border-[#1e1e22] rounded-xl p-3">
                  <div className="text-xs font-medium text-[#fafaf9] mb-2">💡 마케팅 팁</div>
                  <div className="space-y-1">
                    {seoInsight.tips.map((tip, i) => (
                      <div key={i} className="text-xs text-[#a1a1aa] flex gap-1.5">
                        <span className="text-[#C8A951] shrink-0">•</span>
                        {tip}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-32 text-[#71717a] text-xs text-center">
              글을 작성하면 SEO/마케팅<br />인사이트가 표시됩니다
            </div>
          )}
        </div>
      )}
    </div>
  );
}
