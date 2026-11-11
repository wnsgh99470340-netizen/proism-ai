'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BlogPost } from '@/lib/posts';
import type { BlogJob } from '@/lib/jobs';

interface Props {
  /** 값이 바뀌면 목록을 다시 불러온다 (저장 직후 등) */
  refreshKey: number;
  activeId: string | null;
  onOpen: (post: BlogPost) => void;
  /** 백그라운드 생성 작업 (진행 중·실패만 표시) */
  jobs: BlogJob[];
  onRetryJob: (id: string) => void;
  onDeleteJob: (id: string) => void;
}

const JOB_STATUS_LABEL: Record<string, string> = {
  queued: '⏳ 접수됨 · 곧 시작',
  researching: '🔎 차량 구조·시공 사례 조사 중',
  writing: '✍️ 글 작성 중',
  channels: '📸 인스타·카페 버전 만드는 중',
  failed: '⚠️ 실패',
};

export function jobLabel(job: BlogJob): string {
  const r = job.request;
  if (r) return [r.region, r.brand, r.model, r.serviceLabel, r.range].filter(Boolean).join(' ');
  return job.message.length > 40 ? `${job.message.slice(0, 40)}…` : job.message;
}

function elapsed(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? '방금' : `${m}분`;
}

const KIND_LABEL: Record<string, { text: string; cls: string }> = {
  draft: { text: '초안', cls: 'bg-[#06B6D4]/15 text-[#06B6D4]' },
  final: { text: '최종본', cls: 'bg-ok/15 text-ok' },
  owner: { text: '내 글', cls: 'bg-gold/15 text-gold' },
};

function fmtDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 저장된 글 목록 (Supabase blog_posts)
 * - 사이트에 들어오면 자동으로 불러오고, 누르면 미리보기에 다시 띄운다
 */
export default function SavedPosts({ refreshKey, activeId, onOpen, jobs, onRetryJob, onDeleteJob }: Props) {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/posts?limit=40');
      const data = await res.json();
      setPosts(Array.isArray(data.posts) ? data.posts : []);
    } catch {
      setError('목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const remove = async (post: BlogPost) => {
    if (!confirm(`"${post.title}" 글을 삭제할까요?`)) return;
    try {
      await fetch(`/api/posts?id=${encodeURIComponent(post.id)}`, { method: 'DELETE' });
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
    } catch {
      alert('삭제에 실패했습니다.');
    }
  };

  const visibleJobs = jobs.filter((j) => j.status !== 'done');

  return (
    <>
    {visibleJobs.length > 0 && (
      <div className="mx-3 mt-3 bg-[var(--c-page)] border border-gold/40 rounded-xl overflow-hidden">
        <div className="px-3 py-2 text-xs font-medium text-[var(--c-text-1)]">⚙️ 생성 중인 글</div>
        <div className="border-t border-[var(--c-border)]">
          {visibleJobs.map((j) => (
            <div key={j.id} className="px-3 py-2 border-b border-[var(--c-border)]/60 last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--c-text-1)] truncate flex-1">{jobLabel(j)}</span>
                <span className="text-[10px] text-[var(--c-text-3)] shrink-0">{elapsed(j.created_at)} 경과</span>
                {j.status === 'failed' ? (
                  <>
                    <button onClick={() => onRetryJob(j.id)} className="text-[10px] text-gold hover:underline shrink-0">다시 시도</button>
                    <button onClick={() => onDeleteJob(j.id)} className="text-[var(--c-text-4)] hover:text-danger text-xs px-1 shrink-0" title="삭제">✕</button>
                  </>
                ) : (
                  <span className="w-2 h-2 rounded-full bg-gold animate-pulse shrink-0" />
                )}
              </div>
              <div className={`text-[11px] mt-0.5 ${j.status === 'failed' ? 'text-danger' : 'text-[var(--c-text-2)]'}`}>
                {JOB_STATUS_LABEL[j.status] || j.status}
                {j.status === 'failed' && j.error ? ` — ${j.error.slice(0, 120)}` : ''}
              </div>
              {j.status !== 'failed' && (
                <div className="text-[10px] text-[var(--c-text-3)] mt-0.5">앱을 닫아도 서버에서 계속 진행됩니다. 보통 4~6분 걸립니다.</div>
              )}
            </div>
          ))}
        </div>
      </div>
    )}
    <div className="mx-3 mt-3 bg-[var(--c-page)] border border-[var(--c-border)] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-medium text-[var(--c-text-1)] hover:text-gold"
        >
          {open ? '▾' : '▸'} 📂 저장된 글 {loading ? '' : `(${posts.length})`}
        </button>
        <button onClick={load} disabled={loading} className="text-[10px] text-[var(--c-text-3)] hover:text-[var(--c-text-1)] disabled:opacity-50">
          {loading ? '불러오는 중…' : '↻ 새로고침'}
        </button>
      </div>

      {open && (
        <div className="max-h-56 overflow-y-auto border-t border-[var(--c-border)]">
          {error && <div className="px-3 py-3 text-[11px] text-danger">{error}</div>}
          {!error && !loading && posts.length === 0 && (
            <div className="px-3 py-4 text-[11px] text-[var(--c-text-3)] text-center">
              아직 저장된 글이 없습니다. 글을 만들면 여기에 자동으로 쌓입니다.
            </div>
          )}
          {posts.map((p) => {
            const k = KIND_LABEL[p.kind] ?? KIND_LABEL.draft;
            const isActive = p.id === activeId;
            return (
              <div
                key={p.id}
                className={`flex items-center gap-2 px-3 py-2 border-b border-[var(--c-border)]/60 last:border-b-0 ${isActive ? 'bg-gold/10' : 'hover:bg-[var(--c-hover)]'}`}
              >
                <button onClick={() => onOpen(p)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${k.cls}`}>{k.text}</span>
                    <span className="text-[10px] text-[var(--c-text-3)] shrink-0">{fmtDate(p.created_at)}</span>
                    <span className="text-xs text-[var(--c-text-1)] truncate">{p.title}</span>
                  </div>
                  {(p.car_model || p.service_type) && (
                    <div className="text-[10px] text-[var(--c-text-3)] mt-0.5 truncate">
                      {[p.car_model, p.service_type, p.product].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </button>
                <button
                  onClick={() => remove(p)}
                  title="삭제"
                  className="text-[var(--c-text-4)] hover:text-danger text-xs px-1 shrink-0"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </>
  );
}
