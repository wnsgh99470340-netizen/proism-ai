'use client';

import { useMemo, useState } from 'react';
import type { BlogJob } from '@/lib/jobs';
import type { VideoState } from '@/lib/video';

interface Props {
  jobs: BlogJob[];
  draft: { title: string; content: string } | null;
  activePostId: string | null;
  target: { carModel: string | null; serviceType: string | null; product: string | null; region: string | null } | null;
  /** 작업 목록을 다시 불러와야 할 때 */
  onJobsChanged: () => void;
}

const inputCls =
  'w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-2.5 py-2 text-xs text-[var(--c-text-1)] placeholder-[var(--c-text-4)] outline-none focus:border-[#C8A951]/60 min-h-[36px]';

function describe(v: VideoState): string {
  switch (v.status) {
    case 'queued': return v.dispatched ? '⏳ 영상 제작 대기 중 — 곧 시작합니다' : '⏳ 영상 제작 대기 중 — 10분 안에 시작합니다';
    case 'rendering': return '🎬 영상 만드는 중 — 보통 3~6분 걸립니다';
    case 'done': return `✅ 영상 완성${v.duration ? ` · ${Math.round(v.duration)}초` : ''}${v.photos_used ? ` · 사진 ${v.photos_used}장` : ''}`;
    case 'failed': return `⚠️ 영상 제작 실패 — ${v.error || '원인 미상'}`;
    default: return '';
  }
}

/** 🎬 영상 탭: 글에 붙은 영상 작업 상태·결과, 없으면 드라이브 링크로 새로 만들기 */
export default function VideoTab({ jobs, draft, activePostId, target, onJobsChanged }: Props) {
  const [photosUrl, setPhotosUrl] = useState('');
  const [vertical, setVertical] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 열린 글에 해당하는 영상 작업: draftId 일치 → 제목 일치 → (글이 없으면) 가장 최근 영상 작업
  const job = useMemo(() => {
    const withVideo = jobs.filter((j) => j.result?.video);
    if (activePostId) {
      const byId = withVideo.find((j) => j.result?.draftId === activePostId);
      if (byId) return byId;
    }
    if (draft) {
      const byTitle = withVideo.find((j) => j.result?.draft?.title === draft.title);
      if (byTitle) return byTitle;
      return null;
    }
    return withVideo[0] ?? null;
  }, [jobs, activePostId, draft]);
  const video = job?.result?.video ?? null;

  const urlOk = photosUrl.trim() === '' || /^https?:\/\/drive\.google\.com\//.test(photosUrl.trim());

  const make = async () => {
    if (!draft || !photosUrl.trim() || !urlOk) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: activePostId, title: draft.title, content: draft.content, photosUrl: photosUrl.trim(), vertical, target }),
      });
      const data = await res.json();
      if (!res.ok || data.error) setMsg(`⚠️ ${data.error || res.status}`);
      else { setMsg(`📥 사진 ${data.photos}장으로 영상 제작을 접수했습니다.`); setPhotosUrl(''); onJobsChanged(); }
    } catch { setMsg('⚠️ 네트워크 오류'); }
    setBusy(false);
  };

  const retry = async () => {
    if (!job) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/video?id=${encodeURIComponent(job.id)}`, { method: 'PATCH' });
      const data = await res.json();
      if (!res.ok || data.error) setMsg(`⚠️ ${data.error || res.status}`);
      else onJobsChanged();
    } catch { setMsg('⚠️ 네트워크 오류'); }
    setBusy(false);
  };

  const dl = (u: string) => (u.includes('?') ? `${u}&download=1` : `${u}?download=1`);

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {video && (
        <div className={`rounded-xl border p-3 text-xs ${video.status === 'done' ? 'bg-[#10B981]/10 border-[#10B981]/30' : video.status === 'failed' ? 'bg-[#EF4444]/10 border-[#EF4444]/30' : 'bg-[#C8A951]/10 border-[#C8A951]/30'}`}>
          <div className="font-medium text-[var(--c-text-1)]">{describe(video)}</div>
          {job?.result?.draft?.title && <div className="text-[11px] text-[var(--c-text-3)] mt-0.5 truncate">{job.result.draft.title}</div>}
          {video.plan?.title && (
            <div className="text-[11px] text-[var(--c-text-2)] mt-1">
              제목 카드: <b>{video.plan.title}</b>{video.plan.subtitle ? ` · ${video.plan.subtitle}` : ''}
              {video.plan.chapters && video.plan.chapters.length > 0 && <div>구간 자막: {video.plan.chapters.join(' → ')}</div>}
            </div>
          )}
          {video.bgm?.name && <div className="text-[11px] text-[var(--c-text-3)] mt-0.5">음악: {video.bgm.name.replace(/_/g, ' ')}</div>}
          {(video.status === 'failed' || video.status === 'done') && (
            <button onClick={retry} disabled={busy} className="mt-2 bg-[var(--c-subtle)] hover:bg-[var(--c-border)] text-[var(--c-text-1)] text-[11px] px-3 py-1.5 rounded-lg">
              🔁 다시 만들기
            </button>
          )}
        </div>
      )}

      {video?.status === 'done' && video.url && (
        <div className="space-y-2">
          <video controls preload="metadata" src={video.url} poster={video.contact_sheet || undefined} className="w-full rounded-xl bg-black" />
          <div className={`grid ${video.vertical_url ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
            <a href={dl(video.url)} download className="block text-center bg-[#E4002B] hover:bg-[#c60026] text-white text-xs font-semibold py-2.5 rounded-lg">⬇️ 영상 내려받기 (가로)</a>
            {video.vertical_url && (
              <a href={dl(video.vertical_url)} download className="block text-center bg-[#C8A951] hover:bg-[#b3953f] text-black text-xs font-semibold py-2.5 rounded-lg">⬇️ 세로 영상 (릴스·클립)</a>
            )}
          </div>
          <div className="text-[10px] text-[var(--c-text-3)]">내려받은 뒤 네이버 글 맨 아래(마무리 문장 앞)에 올리면 됩니다. 영상은 최근 12편까지만 보관됩니다.</div>
          {video.contact_sheet && (
            <details className="text-[11px] text-[var(--c-text-2)]">
              <summary className="cursor-pointer">장면 모아보기</summary>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={video.contact_sheet} alt="장면 모아보기" className="w-full rounded-lg mt-2" />
            </details>
          )}
          {video.excluded && video.excluded.length > 0 && (
            <details className="text-[11px] text-[var(--c-text-2)]">
              <summary className="cursor-pointer">뺀 사진 {video.excluded.length}장</summary>
              <ul className="mt-1 space-y-0.5">{video.excluded.map((e, i) => <li key={i}>• {e.name} — {e.reason}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      {video && (video.status === 'queued' || video.status === 'rendering') && (
        <div className="text-[11px] text-[var(--c-text-3)] text-center py-4">
          사진 {video.photos?.length ?? 0}장 · {video.vertical ? '가로+세로' : '가로'} · 완성되면 여기에 뜹니다. 앱을 닫아도 됩니다.
        </div>
      )}

      {!video && (
        <div className="rounded-xl border border-[var(--c-border)] p-3 space-y-2">
          <div className="text-xs font-medium text-[var(--c-text-1)]">🎬 이 글로 영상 만들기</div>
          {!draft && <div className="text-[11px] text-[var(--c-text-3)]">먼저 글을 열거나 생성하세요. 폼에서 사진 폴더 링크를 넣으면 글 완성 뒤 영상까지 자동으로 만듭니다.</div>}
          {draft && (
            <>
              <input value={photosUrl} onChange={(e) => setPhotosUrl(e.target.value)} placeholder="구글 드라이브 공유 폴더 링크 (링크가 있는 모든 사용자 보기)" className={`${inputCls} ${!urlOk ? 'border-[#E4002B]/60' : ''}`} />
              <label className="flex items-center gap-1.5 text-[11px] text-[var(--c-text-2)]">
                <input type="checkbox" checked={vertical} onChange={(e) => setVertical(e.target.checked)} className="accent-[#E4002B]" />
                세로 영상(인스타 릴스·네이버 클립용)도 함께
              </label>
              <button onClick={make} disabled={busy || !photosUrl.trim() || !urlOk} className="w-full bg-[#E4002B] hover:bg-[#c60026] disabled:bg-[var(--c-subtle)] disabled:text-[var(--c-text-3)] text-white text-xs font-semibold py-2.5 rounded-lg">
                {busy ? '접수 중…' : '🎬 영상 제작 시작'}
              </button>
            </>
          )}
        </div>
      )}
      {msg && <div className="text-[11px] text-[var(--c-text-2)]">{msg}</div>}
    </div>
  );
}
