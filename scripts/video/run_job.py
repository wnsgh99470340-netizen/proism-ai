#!/usr/bin/env python3
"""
영상 작업 실행기 (깃허브 액션에서 돌아감) — 2026-11-11
blog_jobs.result.video 가 queued 인 작업을 찾아: 사진 내려받기 → plan.py → render.py → Vercel Blob 업로드 → 상태 기록

환경변수: SUPABASE_URL, SUPABASE_ANON_KEY, BLOB_READ_WRITE_TOKEN, ANTHROPIC_API_KEY
사용: python3 scripts/video/run_job.py [--job-id UUID] [--max 3]
"""
from __future__ import annotations
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
ASSETS = ROOT / 'assets' / 'video'
BGM_LIST = json.loads((HERE / 'bgm.json').read_text(encoding='utf-8'))
KEEP_VIDEOS = 12  # Blob 에 남겨 둘 최근 영상 수 (무료 용량 1GB)

SUPABASE_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
SUPABASE_KEY = os.environ.get('SUPABASE_ANON_KEY', '')
BLOB_TOKEN = os.environ.get('BLOB_READ_WRITE_TOKEN', '')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'


def log(msg):
    print(msg, flush=True)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ---------- Supabase (PostgREST) ----------
def sb_headers(extra=None):
    h = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}', 'Content-Type': 'application/json'}
    if extra:
        h.update(extra)
    return h


def fetch_jobs(job_id: str | None, limit: int) -> list[dict]:
    if job_id:
        r = requests.get(f'{SUPABASE_URL}/rest/v1/blog_jobs', params={'id': f'eq.{job_id}', 'select': '*'}, headers=sb_headers(), timeout=30)
    else:
        r = requests.get(f'{SUPABASE_URL}/rest/v1/blog_jobs', params={
            'result->video->>status': 'eq.queued', 'select': '*', 'order': 'created_at.asc', 'limit': str(limit),
        }, headers=sb_headers(), timeout=30)
    r.raise_for_status()
    return r.json()


def count_done_videos() -> int:
    r = requests.get(f'{SUPABASE_URL}/rest/v1/blog_jobs', params={'result->video->>status': 'eq.done', 'select': 'id'},
                     headers=sb_headers({'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0'}), timeout=30)
    cr = r.headers.get('Content-Range', '')
    m = re.search(r'/(\d+)$', cr)
    return int(m.group(1)) if m else 0


def patch_video(job: dict, video_patch: dict):
    """result.video 만 갱신 (읽기-수정-쓰기)"""
    r = requests.get(f'{SUPABASE_URL}/rest/v1/blog_jobs', params={'id': f"eq.{job['id']}", 'select': 'result'}, headers=sb_headers(), timeout=30)
    r.raise_for_status()
    rows = r.json()
    result = (rows[0].get('result') if rows else None) or job.get('result') or {}
    video = dict(result.get('video') or {})
    video.update(video_patch)
    result['video'] = video
    r = requests.patch(f'{SUPABASE_URL}/rest/v1/blog_jobs', params={'id': f"eq.{job['id']}"}, headers=sb_headers({'Prefer': 'return=minimal'}),
                       json={'result': result, 'updated_at': now_iso()}, timeout=30)
    r.raise_for_status()
    job['result'] = result


# ---------- 사진 내려받기 ----------
def download_file(url: str, dest: Path) -> bool:
    headers = {'User-Agent': UA}
    if 'pstatic.net' in url:
        headers['Referer'] = 'https://blog.naver.com/'
    try:
        with requests.get(url, headers=headers, stream=True, timeout=120, allow_redirects=True) as r:
            if r.status_code != 200:
                log(f'  내려받기 실패 {r.status_code}: {dest.name}')
                return False
            ctype = r.headers.get('Content-Type', '')
            if 'text/html' in ctype and 'drive.google.com' in url:
                # 큰 파일의 바이러스 검사 안내 페이지 → confirm 토큰으로 재시도
                html = r.text
                m = re.search(r'name="uuid" value="([^"]+)"', html)
                fid = re.search(r'id=([A-Za-z0-9_-]+)', url)
                if m and fid:
                    url2 = f'https://drive.usercontent.google.com/download?id={fid.group(1)}&export=download&confirm=t&uuid={m.group(1)}'
                    return download_file(url2, dest)
                log(f'  드라이브가 파일 대신 안내 페이지를 돌려줌: {dest.name}')
                return False
            with open(dest, 'wb') as f:
                for chunk in r.iter_content(1 << 16):
                    f.write(chunk)
        return dest.stat().st_size > 1000
    except Exception as e:  # noqa: BLE001
        log(f'  내려받기 오류: {dest.name} ({e})')
        return False


def safe_name(name: str, i: int) -> str:
    base = re.sub(r'[^A-Za-z0-9._-]+', '_', name) or f'file_{i}'
    return f'{i:03d}_{base}'


# ---------- Vercel Blob ----------
def blob_put(path: Path, pathname: str, content_type: str) -> str:
    with open(path, 'rb') as f:
        r = requests.put(f'https://blob.vercel-storage.com/{pathname}', data=f, headers={
            'authorization': f'Bearer {BLOB_TOKEN}', 'x-api-version': '7', 'x-content-type': content_type,
            'x-add-random-suffix': '0', 'x-allow-overwrite': '1', 'x-cache-control-max-age': '31536000',
        }, timeout=600)
    r.raise_for_status()
    return r.json()['url']


def blob_cleanup(keep: int):
    """videos/ 아래 작업 폴더를 최근 keep 개만 남기고 지운다"""
    try:
        r = requests.get('https://blob.vercel-storage.com/', params={'prefix': 'videos/', 'limit': '1000'},
                         headers={'authorization': f'Bearer {BLOB_TOKEN}', 'x-api-version': '7'}, timeout=60)
        r.raise_for_status()
        blobs = r.json().get('blobs', [])
        groups: dict[str, dict] = {}
        for b in blobs:
            parts = b['pathname'].split('/')
            if len(parts) < 3:
                continue
            g = groups.setdefault(parts[1], {'t': b.get('uploadedAt', ''), 'urls': []})
            g['urls'].append(b['url'])
            g['t'] = max(g['t'], b.get('uploadedAt', ''))
        ordered = sorted(groups.items(), key=lambda kv: kv[1]['t'], reverse=True)
        old = [u for _, g in ordered[keep:] for u in g['urls']]
        if old:
            requests.post('https://blob.vercel-storage.com/delete', json={'urls': old},
                          headers={'authorization': f'Bearer {BLOB_TOKEN}', 'x-api-version': '7', 'content-type': 'application/json'}, timeout=60)
            log(f'오래된 영상 {len(ordered) - keep}건 정리')
    except Exception as e:  # noqa: BLE001
        log(f'정리 건너뜀: {e}')


# ---------- 작업 하나 ----------
def run_one(job: dict, work: Path) -> None:
    result = job.get('result') or {}
    video = result.get('video') or {}
    draft = result.get('draft') or {}
    target = result.get('target') or {}
    photos = [p for p in (video.get('photos') or []) if p.get('url')]
    if not photos:
        raise RuntimeError('사진 목록이 비어 있습니다')

    patch_video(job, {'status': 'rendering', 'started_at': now_iso(), 'error': None})
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
    log(f'사진 {ok}/{len(photos)}장 내려받음')
    if ok < 3:
        raise RuntimeError(f'사진을 {ok}장밖에 내려받지 못했습니다. 드라이브 공유 설정(링크가 있는 모든 사용자)을 확인해 주세요')

    post = {
        'title': draft.get('title', ''), 'body': draft.get('content', ''),
        'car': target.get('carModel') or '', 'service': target.get('serviceType') or '', 'product': target.get('product') or '',
    }
    (work / 'post.json').write_text(json.dumps(post, ensure_ascii=False), encoding='utf-8')

    # BGM: 완성된 영상 수에 따라 돌아가며 선택 (재작업은 같은 곡 유지)
    bgm = video.get('bgm')
    if not bgm:
        idx = count_done_videos() % max(1, len(BGM_LIST))
        bgm = BGM_LIST[idx]
    patch_video(job, {'bgm': bgm})
    bgm_path = work / 'bgm.mp3'
    if not download_file(bgm['url'], bgm_path):
        log('BGM 내려받기 실패 → 무음으로 진행')
        bgm_path = None

    vertical = bool(video.get('vertical'))
    plan_path = work / 'plan.json'
    cmd = [sys.executable, str(HERE / 'plan.py'), '--post', str(work / 'post.json'), '--photos-dir', str(pdir), '--out', str(plan_path),
           '--bgm', str(bgm_path) if bgm_path else '']
    if vertical:
        cmd.append('--vertical')
    subprocess.run(cmd, check=True)
    plan = json.loads(plan_path.read_text(encoding='utf-8'))
    patch_video(job, {'status': 'rendering', 'plan': summarize_plan(plan)})

    out = work / 'out'
    out.mkdir(exist_ok=True)
    cmd = [sys.executable, str(HERE / 'render.py'), '--plan', str(plan_path), '--assets', str(ASSETS), '--out', str(out)]
    if vertical:
        cmd.append('--vertical')
    t0 = time.time()
    subprocess.run(cmd, check=True)
    log(f'렌더링 {time.time() - t0:.0f}초')

    report = {}
    if (out / 'report.json').exists():
        report = json.loads((out / 'report.json').read_text(encoding='utf-8'))

    base = f"videos/{job['id']}"
    mp4 = out / '영상.mp4'
    if not mp4.exists():
        raise RuntimeError('영상 파일이 만들어지지 않았습니다')
    url = blob_put(mp4, f'{base}/video.mp4', 'video/mp4')
    vurl = None
    if vertical and (out / '영상_세로.mp4').exists():
        vurl = blob_put(out / '영상_세로.mp4', f'{base}/video_vertical.mp4', 'video/mp4')
    sheet = blob_put(out / 'contact_sheet.jpg', f'{base}/contact_sheet.jpg', 'image/jpeg') if (out / 'contact_sheet.jpg').exists() else None
    thumb = blob_put(out / '영상_썸네일.jpg', f'{base}/thumbnail.jpg', 'image/jpeg') if (out / '영상_썸네일.jpg').exists() else None
    blob_put(plan_path, f'{base}/plan.json', 'application/json')

    patch_video(job, {
        'status': 'done', 'url': url, 'vertical_url': vurl, 'contact_sheet': sheet, 'thumbnail': thumb,
        'duration': report.get('duration_sec'), 'photos_used': report.get('photos_used'),
        'excluded': (report.get('excluded') or [])[:20], 'finished_at': now_iso(), 'error': None,
    })
    log(f'완료: {url}')


def summarize_plan(plan: dict) -> dict:
    return {
        'title': plan.get('title'), 'subtitle': plan.get('subtitle'),
        'chapters': [p['chapter'] for p in plan.get('photos', []) if p.get('chapter')],
        'photos': len([p for p in plan.get('photos', []) if p.get('kind', 'photo') == 'photo']),
        'clips': len([p for p in plan.get('photos', []) if p.get('kind') == 'video']),
        'excluded': plan.get('excluded', [])[:20],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--job-id', default='')
    ap.add_argument('--max', type=int, default=3)
    ap.add_argument('--workdir', default=str(ROOT / '.video-work'))
    args = ap.parse_args()
    if not (SUPABASE_URL and SUPABASE_KEY and BLOB_TOKEN):
        # 깃허브 시크릿이 아직 없으면 조용히 끝낸다 (10분 스케줄이 실패 알림을 쏟아내지 않도록)
        log('⚠️ 시크릿 미설정: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / BLOB_READ_WRITE_TOKEN / ANTHROPIC_API_KEY 를 저장소 Settings → Secrets 에 넣어 주세요'); return

    jobs = fetch_jobs(args.job_id or None, args.max)
    jobs = [j for j in jobs if ((j.get('result') or {}).get('video') or {}).get('status') in ('queued', 'rendering')]
    if not jobs:
        log('대기 중인 영상 작업 없음'); return
    failures = 0
    for job in jobs:
        work = Path(args.workdir) / job['id']
        log(f"=== 작업 {job['id']} — {((job.get('result') or {}).get('draft') or {}).get('title', '')}")
        try:
            run_one(job, work)
        except Exception as e:  # noqa: BLE001
            failures += 1
            msg = str(e)[:300]
            log(f'실패: {msg}')
            try:
                patch_video(job, {'status': 'failed', 'error': msg, 'finished_at': now_iso()})
            except Exception as e2:  # noqa: BLE001
                log(f'상태 기록 실패: {e2}')
        finally:
            shutil.rmtree(work, ignore_errors=True)
    blob_cleanup(KEEP_VIDEOS)
    if failures and failures == len(jobs):
        sys.exit(1)


if __name__ == '__main__':
    main()
