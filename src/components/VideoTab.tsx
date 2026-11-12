'use client';

import { useMemo, useRef, useState } from 'react';
import { INSTAGRAM_VIDEO_PAUSED, INSTAGRAM_PAUSED_NOTE } from '@/config/features';
import { upload } from '@vercel/blob/client';
import type { BlogJob } from '@/lib/jobs';
import type { VideoState, ReelsState, TalkState, TalkCue } from '@/lib/video';

interface Props {
  jobs: BlogJob[];
  draft: { title: string; content: string } | null;
  activePostId: string | null;
  target: { carModel: string | null; serviceType: string | null; product: string | null; region: string | null } | null;
  /** 작업 목록을 다시 불러와야 할 때 */
  onJobsChanged: () => void;
}

const inputCls =
  'w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-2.5 py-2 text-xs text-[var(--c-text-1)] placeholder-[var(--c-text-4)] outline-none focus:border-gold/60 min-h-[36px]';
const btnPrimary = 'bg-brand hover:bg-brand-dark disabled:bg-[var(--c-subtle)] disabled:text-[var(--c-text-3)] text-white text-xs font-semibold py-2.5 rounded-lg';
const btnSub = 'bg-[var(--c-subtle)] hover:bg-[var(--c-border)] text-[var(--c-text-1)] text-[11px] px-3 py-1.5 rounded-lg';
const dl = (u: string) => (u.includes('?') ? `${u}&download=1` : `${u}?download=1`);

function describe(v: VideoState): string {
  switch (v.status) {
    case 'queued': return v.dispatched ? '⏳ 영상 제작 대기 중 — 곧 시작합니다' : '⏳ 영상 제작 대기 중 — 10분 안에 시작합니다';
    case 'rendering': return '🎬 영상 만드는 중 — 보통 3~6분 걸립니다';
    case 'done': return `✅ 영상 완성${v.duration ? ` · ${Math.round(v.duration)}초` : ''}${v.photos_used ? ` · 사진 ${v.photos_used}장` : ''}${v.reused_from ? ' · 같은 사진 폴더로 만든 영상 재사용' : ''}`;
    case 'failed': return `⚠️ 영상 제작 실패 — ${v.error || '원인 미상'}`;
    default: return '';
  }
}

function statusTone(st: string | undefined) {
  if (st === 'done') return 'bg-ok/10 border-ok/30';
  if (st === 'failed') return 'bg-danger/10 border-danger/30';
  return 'bg-gold/10 border-gold/30';
}

async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); return true; } catch { return false; }
}

/** 🎬 영상 탭: 블로그 영상 / 정보 릴스 / 말하기 영상 */
export default function VideoTab({ jobs, draft, activePostId, target, onJobsChanged }: Props) {
  const [photosUrl, setPhotosUrl] = useState('');
  const [vertical, setVertical] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 열린 글에 해당하는 영상 작업: draftId 일치 → 제목 일치 → (글이 없으면) 가장 최근 영상 작업
  const job = useMemo(() => {
    const withVideo = jobs.filter((j) => j.result?.video || j.result?.reels);
    if (activePostId) {
      const byId = withVideo.find((j) => j.result?.draftId === activePostId);
      if (byId) return byId;
    }
    if (draft) {
      const byTitle = withVideo.find((j) => j.result?.draft?.title === draft.title);
      if (byTitle) return byTitle;
      return null;
    }
    return withVideo.find((j) => !j.result?.talk) ?? null;
  }, [jobs, activePostId, draft]);
  const video = job?.result?.video ?? null;
  const reels = job?.result?.reels ?? null;
  const talkJobs = useMemo(() => jobs.filter((j) => j.result?.talk).slice(0, 6), [jobs]);

  const urlOk = photosUrl.trim() === '' || /^https?:\/\/drive\.google\.com\//.test(photosUrl.trim());

  const post = async (url: string, body: unknown, okMsg?: string, method = 'POST') => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok || data.error) { setMsg(`⚠️ ${data.error || res.status}`); setBusy(false); return null; }
      if (okMsg) setMsg(okMsg);
      onJobsChanged();
      setBusy(false);
      return data;
    } catch { setMsg('⚠️ 네트워크 오류'); setBusy(false); return null; }
  };

  const makeVideo = async () => {
    if (!draft || !photosUrl.trim() || !urlOk) return;
    const d = await post('/api/video', { draftId: activePostId, title: draft.title, content: draft.content, photosUrl: photosUrl.trim(), vertical, target });
    if (d) { setMsg(`📥 사진 ${d.photos}장으로 영상 제작을 접수했습니다.`); setPhotosUrl(''); }
  };
  const retryVideo = () => job && post(`/api/video?id=${encodeURIComponent(job.id)}`, undefined, undefined, 'PATCH');
  const makeReels = async () => {
    if (!job) return;
    const needUrl = !(video?.photos?.length);
    if (needUrl && (!photosUrl.trim() || !urlOk)) { setMsg('⚠️ 이 글에 연결된 사진이 없습니다. 아래에 구글 드라이브 폴더 링크를 넣고 다시 눌러 주세요.'); return; }
    const d = await post('/api/reels', { jobId: job.id, count: 3, photosUrl: needUrl ? photosUrl.trim() : undefined });
    if (d) setMsg('📥 릴스 대본 3개를 뽑아 전부 만듭니다. 5~8분 걸립니다.');
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
      {/* ── 블로그용 영상 ── */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-[var(--c-text-1)]">🎬 블로그 영상 <span className="font-normal text-[var(--c-text-3)]">(글 맨 아래에 올리는 가로 영상)</span></h4>
        {video && (
          <div className={`rounded-xl border p-3 text-xs ${statusTone(video.status)}`}>
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
              <button onClick={retryVideo} disabled={busy} className={`mt-2 ${btnSub}`}>🔁 다시 만들기</button>
            )}
          </div>
        )}
        {video?.status === 'done' && video.url && (
          <div className="space-y-2">
            <video controls preload="metadata" src={video.url} poster={video.thumbnail || video.contact_sheet || undefined} className="w-full rounded-xl bg-black" />
            <div className={`grid ${video.vertical_url ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
              <a href={dl(video.url)} download className={`block text-center ${btnPrimary}`}>⬇️ 영상 내려받기 (가로)</a>
              {video.vertical_url && <a href={dl(video.vertical_url)} download className="block text-center bg-gold hover:bg-gold/90 text-white text-xs font-semibold py-2.5 rounded-lg">⬇️ 세로 영상</a>}
            </div>
            {video.thumbnail && <a href={dl(video.thumbnail)} download className={`block text-center ${btnSub}`}>🖼️ 썸네일 이미지 내려받기</a>}
            <div className="text-[10px] text-[var(--c-text-3)]">첫 장면이 완성 사진+제목이라 네이버 썸네일이 자동으로 그 장면이 됩니다. 영상은 최근 12편까지만 보관됩니다.</div>
            {video.contact_sheet && (
              <details className="text-[11px] text-[var(--c-text-2)]"><summary className="cursor-pointer">장면 모아보기</summary>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={video.contact_sheet} alt="장면 모아보기" className="w-full rounded-lg mt-2" /></details>
            )}
            {video.excluded && video.excluded.length > 0 && (
              <details className="text-[11px] text-[var(--c-text-2)]"><summary className="cursor-pointer">뺀 사진 {video.excluded.length}장</summary>
                <ul className="mt-1 space-y-0.5">{video.excluded.map((e, i) => <li key={i}>• {e.name} — {e.reason}</li>)}</ul></details>
            )}
          </div>
        )}
        {video && (video.status === 'queued' || video.status === 'rendering') && (
          <div className="text-[11px] text-[var(--c-text-3)] text-center py-2">사진 {video.photos?.length ?? 0}장 · {video.vertical ? '가로+세로' : '가로'} · 완성되면 여기에 뜹니다. 앱을 닫아도 됩니다.</div>
        )}
        {!video && (
          <div className="rounded-xl border border-[var(--c-border)] p-3 space-y-2">
            {!draft && <div className="text-[11px] text-[var(--c-text-3)]">먼저 글을 열거나 생성하세요. 폼에서 사진 폴더 링크를 넣으면 글 완성 뒤 영상까지 자동으로 만듭니다.</div>}
            {draft && (
              <>
                <input value={photosUrl} onChange={(e) => setPhotosUrl(e.target.value)} placeholder="구글 드라이브 공유 폴더 링크 (링크가 있는 모든 사용자 보기)" className={`${inputCls} ${!urlOk ? 'border-brand/60' : ''}`} />
                <label className="flex items-center gap-1.5 text-[11px] text-[var(--c-text-2)]">
                  <input type="checkbox" checked={vertical} onChange={(e) => setVertical(e.target.checked)} className="accent-brand" /> 세로 영상도 함께
                </label>
                <button onClick={makeVideo} disabled={busy || !photosUrl.trim() || !urlOk} className={`w-full ${btnPrimary}`}>{busy ? '접수 중…' : '🎬 블로그 영상 만들기'}</button>
              </>
            )}
          </div>
        )}
      </section>

      {INSTAGRAM_VIDEO_PAUSED ? (
        <section className="rounded-xl border border-[var(--c-border)] p-3 text-[11px] text-[var(--c-text-3)]">⏸ {INSTAGRAM_PAUSED_NOTE}</section>
      ) : (<>
      {/* ── 정보 릴스 ── */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-[var(--c-text-1)]">🎞️ 정보 릴스 <span className="font-normal text-[var(--c-text-3)]">(인스타용 세로 20~30초, 글에서 대본 3개 자동)</span></h4>
        {job && !reels && (
          <div className="rounded-xl border border-[var(--c-border)] p-3 space-y-2">
            <div className="text-[11px] text-[var(--c-text-2)]">이 글의 내용과 사진으로 "흔한 오해 / 왜 이 선택 / 관리법" 같은 주제의 릴스 3개를 만듭니다. 캡션과 해시태그도 같이 나옵니다.</div>
            {!(video?.photos?.length) && (
              <input value={photosUrl} onChange={(e) => setPhotosUrl(e.target.value)} placeholder="사진 폴더 링크(구글 드라이브) — 이 글에 연결된 사진이 없을 때만" className={`${inputCls} ${!urlOk ? 'border-brand/60' : ''}`} />
            )}
            <button onClick={makeReels} disabled={busy} className={`w-full ${btnPrimary}`}>{busy ? '접수 중…' : '🎞️ 정보 릴스 3개 만들기'}</button>
          </div>
        )}
        {!job && <div className="text-[11px] text-[var(--c-text-3)]">글을 열면 그 글로 릴스를 만들 수 있습니다.</div>}
        {reels && <ReelsBlock reels={reels} busy={busy} onRetry={makeReels} />}
      </section>

      {/* ── 말하기 영상 ── */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-[var(--c-text-1)]">🎤 말하기 영상 <span className="font-normal text-[var(--c-text-3)]">(폰으로 찍은 30초 → 자막·세로·연락처 카드)</span></h4>
        <TalkUpload onCreated={() => { setMsg('📥 올렸습니다. 음성을 받아 적고 자막을 붙이는 데 5~8분 걸립니다.'); onJobsChanged(); }} onError={(m) => setMsg(`⚠️ ${m}`)} />
        {talkJobs.map((j) => <TalkBlock key={j.id} job={j} onChanged={onJobsChanged} />)}
      </section>

      </>)}

      {msg && <div className="text-[11px] text-[var(--c-text-2)]">{msg}</div>}
    </div>
  );
}

function ReelsBlock({ reels, busy, onRetry }: { reels: ReelsState; busy: boolean; onRetry: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const items = reels.items ?? [];
  const head =
    reels.status === 'queued' ? (reels.dispatched ? '⏳ 릴스 대기 중 — 곧 시작합니다' : '⏳ 릴스 대기 중 — 10분 안에 시작합니다')
    : reels.status === 'rendering' ? `🎞️ 릴스 만드는 중${items.length ? ` — ${items.filter((i) => i.status === 'done').length}/${items.length}개 완료` : ' — 대본 뽑는 중'}`
    : reels.status === 'done' ? `✅ 릴스 ${items.filter((i) => i.status === 'done').length}개 완성`
    : `⚠️ 릴스 실패 — ${reels.error || '원인 미상'}`;
  return (
    <div className="space-y-2">
      <div className={`rounded-xl border p-3 text-xs ${statusTone(reels.status)}`}>
        <div className="font-medium text-[var(--c-text-1)]">{head}</div>
        {reels.bgm?.name && <div className="text-[11px] text-[var(--c-text-3)] mt-0.5">음악: {reels.bgm.name.replace(/_/g, ' ')}</div>}
        {(reels.status === 'failed' || reels.status === 'done') && <button onClick={onRetry} disabled={busy} className={`mt-2 ${btnSub}`}>🔁 대본부터 다시 만들기</button>}
      </div>
      {items.map((it) => (
        <div key={it.id} className="rounded-xl border border-[var(--c-border)] p-3 space-y-2">
          <div className="text-[11px] text-gold font-medium">{it.topic || it.id}{it.duration ? ` · ${Math.round(it.duration)}초` : ''}{it.status === 'rendering' ? ' · 만드는 중…' : it.status === 'failed' ? ` · 실패: ${it.error || ''}` : ''}</div>
          <div className="text-sm font-semibold text-[var(--c-text-1)] whitespace-pre-line leading-snug">{it.hook}</div>
          {it.beats && it.beats.length > 0 && (
            <ol className="text-[11px] text-[var(--c-text-2)] space-y-0.5 list-decimal pl-4">{it.beats.map((b, i) => <li key={i}>{b.replace(/\n/g, ' ')}</li>)}</ol>
          )}
          {it.status === 'done' && it.url && (
            <div className="flex gap-3 items-start">
              <video controls preload="metadata" src={it.url} poster={it.thumbnail || undefined} className="w-36 shrink-0 rounded-lg bg-black aspect-[9/16]" />
              <div className="flex-1 space-y-2 min-w-0">
                <a href={dl(it.url)} download className={`block text-center ${btnPrimary}`}>⬇️ 릴스 내려받기</a>
                {it.caption && (
                  <button onClick={async () => { if (await copyText(`${it.caption}\n\n${(it.hashtags || []).join(' ')}`)) { setCopied(it.id); setTimeout(() => setCopied(null), 1500); } }} className={`w-full ${btnSub}`}>
                    {copied === it.id ? '✅ 복사됨' : '📋 캡션+해시태그 복사'}
                  </button>
                )}
                {it.caption && <div className="text-[10px] text-[var(--c-text-3)] whitespace-pre-line leading-relaxed line-clamp-5">{it.caption}</div>}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TalkUpload({ onCreated, onError }: { onCreated: () => void; onError: (m: string) => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!/^video\//.test(file.type)) { onError('동영상 파일만 올릴 수 있습니다.'); return; }
    if (file.size > 500 * 1024 * 1024) { onError('500MB 이하 영상만 올릴 수 있습니다.'); return; }
    setProgress(0);
    try {
      const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_') || 'clip.mp4';
      const blob = await upload(`uploads/talk/${Date.now()}_${safe}`, file, {
        access: 'public',
        handleUploadUrl: '/api/upload/blob',
        onUploadProgress: (p) => setProgress(Math.round(p.percentage)),
      });
      const res = await fetch('/api/talk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: blob.url, name: file.name }) });
      const data = await res.json();
      if (!res.ok || data.error) onError(data.error || String(res.status)); else onCreated();
    } catch (e) {
      onError(e instanceof Error ? e.message : '업로드 실패');
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  return (
    <div className="rounded-xl border border-[var(--c-border)] p-3 space-y-2">
      <div className="text-[11px] text-[var(--c-text-2)]">작업 중인 차 앞에서 한마디 하신 영상(세로 권장, 가로도 됨)을 올리면 자막을 붙이고 세로 규격으로 맞춰 돌려드립니다. 자막 오타는 아래에서 고쳐 다시 만들 수 있습니다.</div>
      <input ref={fileRef} type="file" accept="video/*" capture="environment" onChange={(e) => pick(e.target.files?.[0])} disabled={progress !== null}
        className="block w-full text-[11px] text-[var(--c-text-2)] file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-brand-dark" />
      {progress !== null && (
        <div className="h-2 w-full rounded bg-[var(--c-subtle)] overflow-hidden"><div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} /></div>
      )}
    </div>
  );
}

function TalkBlock({ job, onChanged }: { job: BlogJob; onChanged: () => void }) {
  const talk = job.result?.talk as TalkState;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const head =
    talk.status === 'queued' ? (talk.dispatched ? '⏳ 대기 중 — 곧 시작합니다' : '⏳ 대기 중 — 10분 안에 시작합니다')
    : talk.status === 'rendering' ? '🎤 음성 받아 적고 자막 붙이는 중 (5~8분)'
    : talk.status === 'done' ? `✅ 완성${talk.duration ? ` · ${Math.round(talk.duration)}초` : ''} · 자막 ${talk.cues?.length ?? 0}개`
    : `⚠️ 실패 — ${talk.error || '원인 미상'}`;
  const startEdit = () => { setText((talk.cues || []).map((c) => c.text).join('\n')); setEditing(true); };
  const rerender = async (withCues: boolean) => {
    setBusy(true);
    let cues: TalkCue[] | undefined;
    if (withCues) {
      const lines = text.split('\n').map((l) => l.trim());
      cues = (talk.cues || []).map((c, i) => ({ ...c, text: lines[i] ?? c.text })).filter((c) => c.text);
    }
    await fetch(`/api/talk?id=${encodeURIComponent(job.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withCues ? { cues } : {}) });
    setBusy(false); setEditing(false); onChanged();
  };
  return (
    <div className={`rounded-xl border p-3 text-xs space-y-2 ${statusTone(talk.status)}`}>
      <div className="font-medium text-[var(--c-text-1)]">{head}</div>
      <div className="text-[11px] text-[var(--c-text-3)] truncate">{talk.source_name || job.message}</div>
      {talk.status === 'done' && talk.url && (
        <div className="flex gap-3 items-start">
          <video controls preload="metadata" src={talk.url} poster={talk.thumbnail || undefined} className="w-36 shrink-0 rounded-lg bg-black aspect-[9/16]" />
          <div className="flex-1 space-y-2 min-w-0">
            <a href={dl(talk.url)} download className={`block text-center ${btnPrimary}`}>⬇️ 내려받기</a>
            <button onClick={startEdit} className={`w-full ${btnSub}`}>✏️ 자막 고치기</button>
            {talk.transcript && !editing && <div className="text-[10px] text-[var(--c-text-3)] leading-relaxed line-clamp-4">{talk.transcript}</div>}
          </div>
        </div>
      )}
      {editing && (
        <div className="space-y-2">
          <div className="text-[10px] text-[var(--c-text-3)]">한 줄이 자막 하나입니다. 줄 수는 그대로 두고 글자만 고쳐 주세요. 시간은 유지됩니다.</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(12, Math.max(4, (talk.cues?.length ?? 4) + 1))} className={`${inputCls} font-mono`} />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => rerender(true)} disabled={busy} className={btnPrimary}>{busy ? '접수 중…' : '🔁 고친 자막으로 다시 만들기'}</button>
            <button onClick={() => setEditing(false)} disabled={busy} className={btnSub}>취소</button>
          </div>
        </div>
      )}
      {talk.status === 'failed' && <button onClick={() => rerender(false)} disabled={busy} className={btnSub}>🔁 다시 시도</button>}
      {talk.warnings && talk.warnings.length > 0 && <div className="text-[10px] text-[var(--c-text-3)]">{talk.warnings.join(' · ')}</div>}
    </div>
  );
}
