#!/usr/bin/env python3
"""
인스타 콘텐츠 작업 실행기 (깃허브 액션) — 2026-11-11
- 정보 릴스: blog_jobs.result.reels.status == queued → 사진 내려받기 → reel_plan.py(대본 2~3개) → reel.py(각각 렌더) → Blob 업로드 → result.reels 갱신
- 말하기 영상: blog_jobs.result.talk.status == queued → 원본 내려받기 → talk.py(자막·세로·끝 카드; cues 가 있으면 그대로) → Blob 업로드 → result.talk 갱신

환경변수는 run_job.py 와 같음. 사용: python3 scripts/video/run_media.py [--job-id UUID] [--max 3]
"""
from __future__ import annotations
import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import requests

from run_job import (HERE, ROOT, ASSETS, BGM_LIST, SUPABASE_URL, SUPABASE_KEY, BLOB_TOKEN,
                     log, now_iso, sb_headers, download_file, safe_name, blob_put, count_done_videos)


def fetch(kind: str, job_id: str | None, limit: int) -> list[dict]:
    if job_id:
        r = requests.get(f'{SUPABASE_URL}/rest/v1/blog_jobs', params={'id': f'eq.{job_id}', 'select': '*'}, headers=sb_headers(), timeout=30)
    else:
        r = requests.get(f'{SUPABASE_URL}/rest/v1/blog_jobs', params={
            f'result->{kind}->>status': 'eq.queued', 'select': '*', 'order': 'created_at.asc', 'limit': str(limit)}, headers=sb_headers(), timeout=30)
    r.raise_for_status()
    return [j for j in r.json() if ((j.get('result') or {}).get(kind) or {}).get('status') in ('queued', 'rendering')]


def patch_key(job: dict, key: str, patch: dict):
    """result[key] 만 읽기-수정-쓰기"""
    r = requests.get(f'{SUPABASE_URL}/rest/v1/blog_jobs', params={'id': f"eq.{job['id']}", 'select': 'result'}, headers=sb_headers(), timeout=30)
    r.raise_for_status()
    rows = r.json()
    result = (rows[0].get('result') if rows else None) or job.get('result') or {}
    cur = dict(result.get(key) or {})
    cur.update(patch)
    result[key] = cur
    r = requests.patch(f'{SUPABASE_URL}/rest/v1/blog_jobs', params={'id': f"eq.{job['id']}"}, headers=sb_headers({'Prefer': 'return=minimal'}),
                       json={'result': result, 'updated_at': now_iso()}, timeout=30)
    r.raise_for_status()
    job['result'] = result


def pick_bgm(state: dict) -> dict:
    if state.get('bgm'):
        return state['bgm']
    idx = (count_done_videos() + 7) % max(1, len(BGM_LIST))  # 블로그 영상과 다른 곡으로 시작
    return BGM_LIST[idx]


# ---------- 정보 릴스 ----------
def run_reels(job: dict, work: Path):
    result = job.get('result') or {}
    reels = result.get('reels') or {}
    draft = result.get('draft') or {}
    target = result.get('target') or {}
    photos = [p for p in ((result.get('video') or {}).get('photos') or []) if p.get('url')]
    if not photos:
        raise RuntimeError('사진이 없습니다 (먼저 블로그 영상용 사진 폴더가 연결돼 있어야 합니다)')
    patch_key(job, 'reels', {'status': 'rendering', 'started_at': now_iso(), 'error': None})
    work.mkdir(parents=True, exist_ok=True)
    pdir = work / 'photos'
    pdir.mkdir(exist_ok=True)
    ok = 0
    for i, p in enumerate(photos, 1):
        dest = pdir / safe_name(p.get('name', f'photo_{i}.jpg'), i)
        if download_file(p['url'], dest):
            ok += 1
        else:
            dest.unlink(missing_ok=True)
    log(f'사진 {ok}/{len(photos)}장')
    if ok < 3:
        raise RuntimeError(f'사진을 {ok}장밖에 내려받지 못했습니다')
    post = {'title': draft.get('title', ''), 'body': draft.get('content', ''),
            'car': target.get('carModel') or '', 'service': target.get('serviceType') or '', 'product': target.get('product') or ''}
    (work / 'post.json').write_text(json.dumps(post, ensure_ascii=False), encoding='utf-8')

    bgm = pick_bgm(reels)
    patch_key(job, 'reels', {'bgm': bgm})
    bgm_path = work / 'bgm.mp3'
    if not download_file(bgm['url'], bgm_path):
        bgm_path = None

    count = int(reels.get('count') or 3)
    scripts_path = work / 'reels.json'
    subprocess.run([sys.executable, str(HERE / 'reel_plan.py'), '--post', str(work / 'post.json'), '--photos-dir', str(pdir),
                    '--out', str(scripts_path), '--count', str(count), '--bgm', str(bgm_path) if bgm_path else ''], check=True)
    scripts = json.loads(scripts_path.read_text(encoding='utf-8'))
    items = []
    for sc in scripts:
        items.append({'id': sc['id'], 'topic': sc.get('topic', ''), 'hook': sc['hook'], 'beats': [b['text'] for b in sc['beats']],
                      'caption': sc.get('caption', ''), 'hashtags': sc.get('hashtags', []), 'status': 'rendering', 'url': None, 'thumbnail': None})
    patch_key(job, 'reels', {'items': items, 'plan_done_at': now_iso()})

    base = f"reels/{job['id']}"
    done = 0
    for sc, it in zip(scripts, items):
        plan_path = work / f"{sc['id']}.json"
        plan_path.write_text(json.dumps(sc, ensure_ascii=False), encoding='utf-8')
        out = work / f"out_{sc['id']}"
        out.mkdir(exist_ok=True)
        try:
            t0 = time.time()
            subprocess.run([sys.executable, str(HERE / 'reel.py'), '--plan', str(plan_path), '--assets', str(ASSETS), '--out', str(out)], check=True)
            mp4 = out / '릴스.mp4'
            if not mp4.exists():
                raise RuntimeError('릴스 파일이 만들어지지 않았습니다')
            it['url'] = blob_put(mp4, f"{base}/{sc['id']}.mp4", 'video/mp4')
            thumb = out / '릴스_썸네일.jpg'
            it['thumbnail'] = blob_put(thumb, f"{base}/{sc['id']}_thumb.jpg", 'image/jpeg') if thumb.exists() else None
            rep = json.loads((out / 'report.json').read_text(encoding='utf-8')) if (out / 'report.json').exists() else {}
            it['duration'] = rep.get('duration_sec')
            it['status'] = 'done'
            done += 1
            log(f"릴스 {sc['id']} 완료 ({time.time() - t0:.0f}초)")
        except Exception as e:  # noqa: BLE001
            it['status'] = 'failed'
            it['error'] = str(e)[:200]
            log(f"릴스 {sc['id']} 실패: {e}")
        patch_key(job, 'reels', {'items': items})
    patch_key(job, 'reels', {'status': 'done' if done > 0 else 'failed', 'finished_at': now_iso(),
                             'error': None if done > 0 else '릴스를 하나도 만들지 못했습니다'})
    log(f'릴스 {done}/{len(items)}개 완료')


# ---------- 말하기 영상 ----------
def run_talk(job: dict, work: Path):
    result = job.get('result') or {}
    talk = result.get('talk') or {}
    src_url = talk.get('source_url')
    if not src_url:
        raise RuntimeError('원본 영상 주소가 없습니다')
    patch_key(job, 'talk', {'status': 'rendering', 'started_at': now_iso(), 'error': None})
    work.mkdir(parents=True, exist_ok=True)
    src = work / ('source' + Path(src_url.split('?')[0]).suffix.lower() or '.mp4')
    if not download_file(src_url, src):
        raise RuntimeError('원본 영상을 내려받지 못했습니다')
    out = work / 'out'
    out.mkdir(exist_ok=True)
    cmd = [sys.executable, str(HERE / 'talk.py'), '--input', str(src), '--assets', str(ASSETS), '--out', str(out)]
    if talk.get('cues'):
        cues_path = work / 'cues.json'
        cues_path.write_text(json.dumps({'cues': talk['cues']}, ensure_ascii=False), encoding='utf-8')
        cmd += ['--cues', str(cues_path)]
    if talk.get('model'):
        cmd += ['--model', str(talk['model'])]
    t0 = time.time()
    subprocess.run(cmd, check=True)
    log(f'말하기 영상 렌더 {time.time() - t0:.0f}초')
    mp4 = out / '말하기.mp4'
    if not mp4.exists():
        raise RuntimeError('영상 파일이 만들어지지 않았습니다')
    base = f"talk/{job['id']}"
    url = blob_put(mp4, f'{base}/talk.mp4', 'video/mp4')
    thumb = out / '말하기_썸네일.jpg'
    turl = blob_put(thumb, f'{base}/thumbnail.jpg', 'image/jpeg') if thumb.exists() else None
    cues = json.loads((out / 'cues.json').read_text(encoding='utf-8')) if (out / 'cues.json').exists() else {'cues': [], 'transcript': ''}
    rep = json.loads((out / 'report.json').read_text(encoding='utf-8')) if (out / 'report.json').exists() else {}
    patch_key(job, 'talk', {'status': 'done', 'url': url, 'thumbnail': turl, 'cues': cues.get('cues', []),
                            'transcript': cues.get('transcript', ''), 'duration': rep.get('duration_sec'),
                            'warnings': rep.get('warnings', []), 'finished_at': now_iso(), 'error': None})
    log(f'완료: {url}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--job-id', default='')
    ap.add_argument('--max', type=int, default=3)
    ap.add_argument('--workdir', default=str(ROOT / '.video-work'))
    args = ap.parse_args()
    if not (SUPABASE_URL and SUPABASE_KEY and BLOB_TOKEN):
        log('⚠️ 시크릿 미설정 — 건너뜀'); return
    failures = 0
    total = 0
    for kind, fn in (('reels', run_reels), ('talk', run_talk)):
        for job in fetch(kind, args.job_id or None, args.max):
            total += 1
            work = Path(args.workdir) / f"{kind}-{job['id']}"
            log(f"=== {kind} 작업 {job['id']} — {((job.get('result') or {}).get('draft') or {}).get('title', '')}")
            try:
                fn(job, work)
            except Exception as e:  # noqa: BLE001
                failures += 1
                msg = str(e)[:300]
                log(f'실패: {msg}')
                try:
                    patch_key(job, kind, {'status': 'failed', 'error': msg, 'finished_at': now_iso()})
                except Exception as e2:  # noqa: BLE001
                    log(f'상태 기록 실패: {e2}')
            finally:
                shutil.rmtree(work, ignore_errors=True)
    if total == 0:
        log('대기 중인 릴스·말하기 작업 없음')
    if failures and failures == total:
        sys.exit(1)


if __name__ == '__main__':
    main()
