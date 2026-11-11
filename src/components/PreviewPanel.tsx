'use client';

import { useState, useCallback } from 'react';
import PostLibrary from './PostLibrary';
import SavedPosts from './SavedPosts';
import type { BlogPost } from '@/lib/posts';
import type { BlogJob } from '@/lib/jobs';
import VideoTab from './VideoTab';
import { htmlToPlainText } from '@/lib/draft-format';

/** 텍스트(+선택적으로 HTML)를 클립보드에 복사. HTML을 함께 넣으면 네이버 에디터 등 서식 지원 곳에서는 문단이 유지되고, 메모장 등에서는 일반 텍스트로 붙음 */
async function copyToClipboard(text: string, html?: string) {
  if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return;
    } catch {
      // 아래 텍스트 복사로 폴백
    }
  }
  await navigator.clipboard.writeText(text);
}

function CopyButton({ label, getText, getHtml }: { label: string; getText: () => string; getHtml?: () => string }) {
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(async () => {
    try {
      await copyToClipboard(getText(), getHtml?.());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API 실패 시 무시
    }
  }, [getText, getHtml]);

  return (
    <button
      onClick={handleClick}
      className="bg-[var(--c-subtle)] hover:bg-[var(--c-hover)] text-[var(--c-text-1)] text-xs py-2.5 rounded-lg transition-colors font-medium"
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

export interface Checks {
  violations: { rule: string; detail: string }[];
  facts: { rule: string; detail: string }[];
  format: string[];
}

export interface Channels {
  instagram: { caption: string; hashtags: string[]; coverPhoto: string };
  cafe: { title: string; body: string };
}

interface PreviewPanelProps {
  draft: Draft | null;
  checks: Checks | null;
  channels: Channels | null;
  channelsLoading: boolean;
  onSaveFinal: (title: string, body: string, feedback: string) => Promise<string | null>;
  onSaveOwner: (title: string, body: string) => Promise<string | null>;
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
  /** 저장된 글 목록 */
  postsRefreshKey: number;
  activePostId: string | null;
  onOpenPost: (post: BlogPost) => void;
  /** 불러온 글에 대해 인스타·카페 버전을 다시 만들 때 */
  onMakeChannels: () => void;
  /** 백그라운드 생성 작업 */
  jobs: BlogJob[];
  onRetryJob: (id: string) => void;
  onDeleteJob: (id: string) => void;
  /** 저장된 글 목록을 다시 불러와야 할 때 */
  onPostsChanged: () => void;
  /** 영상 작업을 접수·재시도한 뒤 작업 목록을 다시 불러올 때 */
  onJobsChanged: () => void;
  /** 열린 글의 차량·시공 정보 (영상 전용 작업에 넘김) */
  draftTarget: { carModel: string | null; serviceType: string | null; product: string | null; region: string | null } | null;
}

export default function PreviewPanel({
  draft,
  checks,
  channels,
  channelsLoading,
  onSaveFinal,
  onSaveOwner,
  images,
  qaScore,
  seoInsight,
  onCopyHtml,
  onRunQA,
  qaLoading,
  postsRefreshKey,
  activePostId,
  onOpenPost,
  onMakeChannels,
  jobs,
  onRetryJob,
  onDeleteJob,
  onPostsChanged,
  onJobsChanged,
  draftTarget,
}: PreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'instagram' | 'cafe' | 'video' | 'insight'>('preview');
  const videoBusy = jobs.some((j) => j.result?.video && (j.result.video.status === 'queued' || j.result.video.status === 'rendering'));
  const draftPlain = draft ? draft.content.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').trim() : '';
  const tabCls = (key: typeof activeTab) =>
    `flex-1 py-2.5 text-xs font-medium transition-colors ${activeTab === key ? 'text-[var(--c-text-1)] border-b-2 border-gold' : 'text-[var(--c-text-3)] hover:text-[var(--c-text-2)]'}`;

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
    <div className="flex flex-col h-full bg-[var(--c-card)] md:border-l border-[var(--c-border)]">
      {/* 탭 */}
      <div className="flex border-b border-[var(--c-border)] shrink-0">
        <button onClick={() => setActiveTab('preview')} className={tabCls('preview')}>📄 블로그</button>
        <button onClick={() => setActiveTab('instagram')} className={tabCls('instagram')}>📸 인스타{channelsLoading ? ' …' : ''}</button>
        <button onClick={() => setActiveTab('cafe')} className={tabCls('cafe')}>☕ 카페{channelsLoading ? ' …' : ''}</button>
        <button onClick={() => setActiveTab('video')} className={tabCls('video')}>🎬 영상{videoBusy ? ' …' : ''}</button>
        <button onClick={() => setActiveTab('insight')} className={tabCls('insight')}>📊 인사이트</button>
      </div>

      {/* 영상 탭 */}
      {activeTab === 'video' && (
        <VideoTab jobs={jobs} draft={draft ? { title: draft.title, content: draft.content } : null} activePostId={activePostId} target={draftTarget} onJobsChanged={onJobsChanged} />
      )}

      {/* 미리보기 탭 */}
      {activeTab === 'preview' && (
        <div className="flex-1 overflow-y-auto">
          <SavedPosts refreshKey={postsRefreshKey} activeId={activePostId} onOpen={onOpenPost} jobs={jobs} onRetryJob={onRetryJob} onDeleteJob={onDeleteJob} />
          {draft && checks && (
            <div className={`mx-3 mt-3 rounded-xl border p-3 ${checks.facts.length + checks.violations.length === 0 ? 'bg-ok/10 border-ok/30' : 'bg-danger/10 border-danger/30'}`}>
              <div className={`text-xs font-medium mb-1 ${checks.facts.length + checks.violations.length === 0 ? 'text-ok' : 'text-danger'}`}>
                {checks.facts.length + checks.violations.length === 0
                  ? '✅ 자동 팩트체크 통과 — 제품·시공 규칙 위반 없음'
                  : `⚠️ 자동 팩트체크 ${checks.facts.length + checks.violations.length}건 확인 필요`}
              </div>
              {[...checks.facts, ...checks.violations].map((c, i) => (
                <div key={i} className="text-[11px] text-[var(--c-text-2)] leading-relaxed">• {c.detail}</div>
              ))}
              {checks.format.map((f, i) => (
                <div key={`f${i}`} className="text-[11px] text-[var(--c-text-3)] leading-relaxed">• 형식: {f}</div>
              ))}
            </div>
          )}
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
            <div className="flex items-center justify-center text-[var(--c-text-3)] text-xs p-8 text-center">
              대화나 위 폼으로 블로그 글을 만들거나<br />
              저장된 글을 누르면 여기에 미리보기가 표시됩니다
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
                  getText={() => htmlToPlainText(draft.content)}
                  getHtml={() => draft.content}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={onCopyHtml}
                  className="bg-[var(--c-subtle)] hover:bg-[var(--c-hover)] text-[var(--c-text-1)] text-xs py-2.5 rounded-lg transition-colors font-medium"
                >
                  📋 HTML 복사
                </button>
                <button
                  onClick={onRunQA}
                  disabled={qaLoading}
                  className="bg-gold/10 hover:bg-gold/20 text-gold text-xs py-2.5 rounded-lg transition-colors font-medium disabled:opacity-50"
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

          <PostLibrary
            draftTitle={draft?.title || ''}
            draftBody={draftPlain}
            onSaveFinal={onSaveFinal}
            onSaveOwner={onSaveOwner}
            onImported={onPostsChanged}
          />
        </div>
      )}

      {/* 인스타 탭 */}
      {activeTab === 'instagram' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {channelsLoading && <div className="text-xs text-[var(--c-text-3)] text-center py-8">인스타·카페 버전을 만드는 중입니다…</div>}
          {!channelsLoading && !channels && (
            <div className="text-xs text-[var(--c-text-3)] text-center py-8 space-y-3">
              <div>블로그 글이 완성되면 인스타 버전이 자동으로 생성됩니다</div>
              {draft && (
                <button onClick={onMakeChannels} className="bg-gold/10 hover:bg-gold/20 text-gold text-xs px-4 py-2 rounded-lg font-medium">
                  📸 이 글로 인스타·카페 버전 만들기
                </button>
              )}
            </div>
          )}
          {channels && (
            <>
              <div className="bg-white rounded-xl p-4 shadow-lg">
                <div className="text-[10px] text-gray-400 mb-2">인스타그램 캡션 미리보기</div>
                <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{channels.instagram.caption}</div>
                <div className="mt-3 text-xs text-blue-500 leading-relaxed">{channels.instagram.hashtags.join(' ')}</div>
              </div>
              {channels.instagram.coverPhoto && (
                <div className="bg-[var(--c-page)] border border-[var(--c-border)] rounded-xl p-3 text-[11px] text-[var(--c-text-2)]">📷 첫 장 추천: {channels.instagram.coverPhoto}</div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <CopyButton label="📋 캡션 복사" getText={() => channels.instagram.caption} />
                <CopyButton label="📋 캡션+해시태그 복사" getText={() => `${channels.instagram.caption}\n\n${channels.instagram.hashtags.join(' ')}`} />
              </div>
            </>
          )}
        </div>
      )}

      {/* 카페 탭 */}
      {activeTab === 'cafe' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {channelsLoading && <div className="text-xs text-[var(--c-text-3)] text-center py-8">인스타·카페 버전을 만드는 중입니다…</div>}
          {!channelsLoading && !channels && (
            <div className="text-xs text-[var(--c-text-3)] text-center py-8 space-y-3">
              <div>블로그 글이 완성되면 카페 대표이야기 버전이 자동으로 생성됩니다</div>
              {draft && (
                <button onClick={onMakeChannels} className="bg-gold/10 hover:bg-gold/20 text-gold text-xs px-4 py-2 rounded-lg font-medium">
                  ☕ 이 글로 인스타·카페 버전 만들기
                </button>
              )}
            </div>
          )}
          {channels && (
            <>
              <div className="bg-white rounded-xl p-4 shadow-lg">
                <div className="text-[10px] text-gray-400 mb-2">네이버 카페 대표이야기 미리보기</div>
                <h3 className="text-base font-bold text-gray-900 mb-3">{channels.cafe.title}</h3>
                <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{channels.cafe.body}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <CopyButton label="📋 제목 복사" getText={() => channels.cafe.title} />
                <CopyButton label="📋 본문 복사" getText={() => channels.cafe.body} />
              </div>
              <button
                onClick={() => window.open('https://cafe.naver.com/3mproism', '_blank')}
                className="w-full bg-[#03C75A]/10 hover:bg-[#03C75A]/20 text-[#03C75A] text-xs py-2.5 rounded-lg font-medium"
              >
                ☕ 카페 열기
              </button>
            </>
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
              <div className="bg-[var(--c-page)] border border-[var(--c-border)] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-[var(--c-text-1)]">QA 채점 결과</span>
                  <span
                    className={`text-2xl font-bold ${
                      qaScore.total >= 90
                        ? 'text-ok'
                        : qaScore.total >= 70
                        ? 'text-warn'
                        : 'text-danger'
                    }`}
                  >
                    {qaScore.total}<span className="text-sm text-[var(--c-text-3)]">/100</span>
                  </span>
                </div>
                <div className="w-full bg-[var(--c-subtle)] rounded-full h-2.5">
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
                  <div className="mt-3 text-xs text-gold leading-relaxed">{qaScore.summary}</div>
                )}
              </div>

              {/* 위반 사항 */}
              {qaScore.violations && qaScore.violations.length > 0 && (
                <div className="bg-[var(--c-page)] border border-danger/30 rounded-xl p-3">
                  <div className="text-xs font-medium text-danger mb-2">위반 사항</div>
                  <div className="space-y-2">
                    {qaScore.violations.map((v, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-danger text-xs shrink-0 mt-0.5">{v.penalty}점</span>
                        <div>
                          <span className="text-xs font-mono text-danger/80 bg-danger/10 px-1.5 py-0.5 rounded">
                            {v.rule}
                          </span>
                          <p className="text-xs text-[var(--c-text-2)] mt-1">{v.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 품질 점수 항목별 */}
              {qaScore.scores && qaScore.scores.length > 0 && (
                <div className="bg-[var(--c-page)] border border-[var(--c-border)] rounded-xl p-3">
                  <div className="text-xs font-medium text-[var(--c-text-1)] mb-3">품질 점수</div>
                  <div className="space-y-2.5">
                    {qaScore.scores.map((s, i) => (
                      <div key={i}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-mono text-[var(--c-text-2)]">{s.item}</span>
                          <span className={`text-xs font-bold ${
                            s.score >= 8 ? 'text-ok' : s.score >= 5 ? 'text-warn' : 'text-danger'
                          }`}>
                            {s.score}/{s.max}
                          </span>
                        </div>
                        <div className="w-full bg-[var(--c-subtle)] rounded-full h-1.5 mb-1">
                          <div
                            className="h-1.5 rounded-full transition-all duration-500"
                            style={{
                              width: `${(s.score / s.max) * 100}%`,
                              backgroundColor:
                                s.score >= 8 ? '#10B981' : s.score >= 5 ? '#F59E0B' : '#EF4444',
                            }}
                          />
                        </div>
                        <div className="text-[10px] text-[var(--c-text-3)]">{s.comment}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 개선점 */}
              {qaScore.improvements && qaScore.improvements.length > 0 && (
                <div className="bg-[var(--c-page)] border border-gold/20 rounded-xl p-3">
                  <div className="text-xs font-medium text-gold mb-2">개선점</div>
                  <div className="space-y-1.5">
                    {qaScore.improvements.map((imp, i) => (
                      <div key={i} className="text-xs text-[var(--c-text-2)] flex gap-1.5">
                        <span className="text-gold shrink-0">{i + 1}.</span>
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
                <div className="bg-[var(--c-page)] border border-[var(--c-border)] rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-[var(--c-text-1)]">🔍 SEO 점수</span>
                    <span className="text-lg font-bold text-[#03C75A]">{seoInsight.seoScore}/100</span>
                  </div>
                  <div className="w-full bg-[var(--c-subtle)] rounded-full h-2">
                    <div
                      className="h-2 rounded-full bg-[#03C75A] transition-all duration-500"
                      style={{ width: `${seoInsight.seoScore}%` }}
                    />
                  </div>
                </div>
              )}

              {seoInsight.keywords && seoInsight.keywords.length > 0 && (
                <div className="bg-[var(--c-page)] border border-[var(--c-border)] rounded-xl p-3">
                  <div className="text-xs font-medium text-[var(--c-text-1)] mb-2">🏷️ 추천 키워드</div>
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
                <div className="bg-[var(--c-page)] border border-[var(--c-border)] rounded-xl p-3">
                  <div className="text-xs font-medium text-[var(--c-text-1)] mb-1">⏰ 최적 발행 시간</div>
                  <div className="text-sm text-gold">{seoInsight.bestTime}</div>
                </div>
              )}

              {seoInsight.tips && seoInsight.tips.length > 0 && (
                <div className="bg-[var(--c-page)] border border-[var(--c-border)] rounded-xl p-3">
                  <div className="text-xs font-medium text-[var(--c-text-1)] mb-2">💡 마케팅 팁</div>
                  <div className="space-y-1">
                    {seoInsight.tips.map((tip, i) => (
                      <div key={i} className="text-xs text-[var(--c-text-2)] flex gap-1.5">
                        <span className="text-gold shrink-0">•</span>
                        {tip}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-32 text-[var(--c-text-3)] text-xs text-center">
              글을 작성하면 SEO/마케팅<br />인사이트가 표시됩니다
            </div>
          )}
        </div>
      )}
    </div>
  );
}
