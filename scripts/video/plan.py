#!/usr/bin/env python3
"""
영상 계획 세우기 (Claude 비전) — 2026-11-11
입력: 블로그 글(제목·본문) + 사진 파일들 → 출력: render.py 가 읽는 plan.json

- 사진 20~25장 안팎을 고르고(흐림·중복·무관한 사진 제외), 완성 사진으로 열고 닫는다
- 사진 성격(hero/process/detail)에 따라 표시 길이를 다르게 준다
- 본문 사실만으로 제목 카드·구간 자막 3~5개를 만든다 (제품명·농도 추측 금지, "보닛"→"본넷", "전개" 금지)
- 연락처 카드 문구는 고정

사용:
  python3 plan.py --post post.json --photos-dir ./photos --out plan.json [--model claude-sonnet-5-5] [--vertical] [--bgm URL]
  post.json = {"title": "...", "body": "...(plain text)", "car": "...", "service": "...", "product": "..."}
"""
from __future__ import annotations
import argparse
import base64
import io
import json
import os
import re
import sys
from pathlib import Path

from PIL import Image, ImageOps

IMAGE_EXT = {'.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'}
VIDEO_EXT = {'.mp4', '.mov', '.m4v'}
MAX_PHOTOS_TO_SHOW = 80
CONTACT = ['상담 문의 010-7287-7140', '서울 서초구 서초중앙로8길 82 1동 1층 1호', '3M 프로이즘 강남서초점']


def log(msg):
    print(msg, flush=True)


def load_thumb(path: Path, max_side=1024) -> tuple[str, str] | None:
    """사진을 분석용으로 축소해 base64 로. 실패하면 None"""
    try:
        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im).convert('RGB')
            im.thumbnail((max_side, max_side))
            buf = io.BytesIO()
            im.save(buf, format='JPEG', quality=80, optimize=True)
            return base64.b64encode(buf.getvalue()).decode('ascii'), 'image/jpeg'
    except Exception as e:  # noqa: BLE001
        log(f'  사진 열기 실패: {path.name} ({e})')
        return None


def plain_body(body: str) -> str:
    t = re.sub(r'<br\s*/?>', '\n', body, flags=re.I)
    t = re.sub(r'</p>', '\n', t, flags=re.I)
    t = re.sub(r'<[^>]+>', '', t)
    t = re.sub(r'\[사진\s*\d+\]', '', t)
    t = re.sub(r'\n{3,}', '\n\n', t)
    return t.strip()


SYSTEM = """당신은 자동차 PPF·랩핑 전문점(3M 프로이즘 강남서초점)의 블로그 시공기 영상을 구성하는 편집자입니다.
블로그 본문과 시공 사진들을 보고, 사진 슬라이드 영상의 계획을 JSON 으로만 출력합니다.

규칙
- 사진은 18~26장을 고릅니다(사진이 그보다 적으면 쓸 수 있는 건 다 씁니다). 흐리거나 흔들린 사진, 거의 같은 구도의 중복, 시공과 무관한 사진(영수증·화면 캡처·사람 얼굴 위주)은 제외하고 이유를 적습니다.
- 첫 장과 마지막 장은 완성 사진(hero)으로 합니다. 중간은 작업 흐름 순서(입고·전처리 → 시공 → 마감 → 완성)로 정리하되, 파일명 순서를 참고만 합니다.
- role: hero(완성·전경, 2.6초) / process(작업 중, 1.8~2.0초) / detail(부위 클로즈업, 1.6초). hold 는 그 값 근처에서 정합니다.
- chapter(구간 자막)는 3~5개만, 각각 14자 이내, 본문에 실제로 나온 작업 내용으로만 씁니다. 그 구간이 시작되는 사진에만 적고 나머지는 null. 예: "도장면 클리닝 후 시공", "루프랙 탈거 후 시공", "도어 안쪽 마감", "사틴블랙 완성".
- title 은 "브랜드 차량명 시공명" (예: "기아 올뉴카니발 전체 랩핑"), subtitle 은 본문에 나온 제품명(예: "3M 2080 사틴블랙"). 본문에 제품명이 없으면 subtitle 은 빈 문자열.
- 본문에 없는 제품명·농도·시공 범위를 지어내지 않습니다. "보닛" 대신 "본넷"이라고 쓰고, 필름 작업을 "전개"라고 쓰지 않습니다. PPF·컬러PPF 글에서는 "열 성형"·"오버랩" 표현을 쓰지 않습니다.
- 출력은 JSON 하나만. 설명 문장 금지.

출력 형식
{"title": "...", "subtitle": "...",
 "photos": [{"index": 3, "role": "hero", "hold": 2.6, "chapter": null}, ...],
 "excluded": [{"index": 7, "reason": "흔들림"}],
 "notes": "한 줄 메모(선택)"}
index 는 제가 붙여 보낸 번호입니다."""


def ask_claude(model: str, post: dict, items: list[dict]) -> dict:
    import anthropic  # 지연 import: 렌더만 할 때는 필요 없음

    client = anthropic.Anthropic()
    content = []
    for it in items:
        content.append({'type': 'text', 'text': f"[사진 {it['index']}] {it['name']}"})
        content.append({'type': 'image', 'source': {'type': 'base64', 'media_type': it['media_type'], 'data': it['data']}})
    content.append({'type': 'text', 'text': (
        f"블로그 제목: {post.get('title','')}\n차량: {post.get('car','')} / 시공: {post.get('service','')} / 제품: {post.get('product','')}\n\n"
        f"본문:\n{plain_body(post.get('body',''))[:6000]}\n\n위 사진 {len(items)}장으로 영상 계획 JSON 을 출력하세요."
    )})
    with client.messages.stream(model=model, max_tokens=4000, system=SYSTEM, messages=[{'role': 'user', 'content': content}]) as stream:
        msg = stream.get_final_message()
    text = ''.join(b.text for b in msg.content if getattr(b, 'type', '') == 'text')
    m = re.search(r'\{[\s\S]*\}', text)
    if not m:
        raise RuntimeError('계획 JSON 을 받지 못했습니다: ' + text[:300])
    return json.loads(m.group(0))


def fallback_plan(items: list[dict]) -> dict:
    """Claude 호출 실패 시: 파일명 순으로 최대 24장, 첫·끝 hero"""
    idx = [it['index'] for it in items]
    if len(idx) > 24:
        step = len(idx) / 24
        idx = [idx[int(i * step)] for i in range(24)]
    photos = []
    for n, i in enumerate(idx):
        role = 'hero' if n in (0, len(idx) - 1) else 'process'
        photos.append({'index': i, 'role': role, 'hold': 2.6 if role == 'hero' else 1.9, 'chapter': None})
    return {'title': '', 'subtitle': '', 'photos': photos, 'excluded': [], 'notes': 'Claude 계획 실패 → 파일명 순 기본 구성'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--post', required=True)
    ap.add_argument('--photos-dir', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--model', default=os.environ.get('VIDEO_PLAN_MODEL', 'claude-sonnet-5-5'))
    ap.add_argument('--bgm', default='')
    ap.add_argument('--vertical', action='store_true')
    args = ap.parse_args()

    post = json.loads(Path(args.post).read_text(encoding='utf-8'))
    pdir = Path(args.photos_dir)
    files = sorted([p for p in pdir.iterdir() if p.is_file()], key=lambda p: p.name.lower())
    photos = [p for p in files if p.suffix.lower() in IMAGE_EXT]
    clips = [p for p in files if p.suffix.lower() in VIDEO_EXT]
    if not photos:
        log('사진이 없습니다'); sys.exit(2)

    # 너무 많으면 고르게 샘플링해서 보여준다 (Claude 이미지 한도·비용)
    shown = photos
    if len(photos) > MAX_PHOTOS_TO_SHOW:
        step = len(photos) / MAX_PHOTOS_TO_SHOW
        shown = [photos[int(i * step)] for i in range(MAX_PHOTOS_TO_SHOW)]
    items = []
    for i, p in enumerate(shown, 1):
        t = load_thumb(p)
        if t:
            items.append({'index': i, 'name': p.name, 'path': str(p), 'data': t[0], 'media_type': t[1]})
    log(f'사진 {len(photos)}장 (분석 {len(items)}장), 영상 클립 {len(clips)}개')

    try:
        plan = ask_claude(args.model, post, items)
        log('Claude 계획 완료')
    except Exception as e:  # noqa: BLE001
        log(f'Claude 계획 실패: {e}')
        plan = fallback_plan(items)

    by_index = {it['index']: it for it in items}
    chosen = []
    for ph in plan.get('photos', []):
        it = by_index.get(int(ph.get('index', -1)))
        if not it:
            continue
        role = ph.get('role') if ph.get('role') in ('hero', 'process', 'detail') else 'process'
        hold = float(ph.get('hold') or {'hero': 2.6, 'process': 1.9, 'detail': 1.6}[role])
        hold = max(1.2, min(3.5, hold))
        chapter = ph.get('chapter') or None
        if chapter:
            chapter = str(chapter).strip()[:20].replace('보닛', '본넷')
        chosen.append({'src': it['path'], 'name': it['name'], 'kind': 'photo', 'role': role, 'hold': round(hold, 2), 'chapter': chapter})
    if len(chosen) < 3:
        plan = fallback_plan(items)
        chosen = [{'src': by_index[p['index']]['path'], 'name': by_index[p['index']]['name'], 'kind': 'photo', 'role': p['role'], 'hold': p['hold'], 'chapter': None} for p in plan['photos']]

    # 짧은 영상 클립이 있으면 첫 hero 다음에 최대 3개 끼워 넣는다 (6초 이내로 자름)
    if clips:
        inserts = [{'src': str(c), 'name': c.name, 'kind': 'video', 'trim': [0, 6], 'chapter': None} for c in clips[:3]]
        chosen = chosen[:1] + inserts + chosen[1:]

    excluded = []
    for ex in plan.get('excluded', []):
        it = by_index.get(int(ex.get('index', -1)))
        if it:
            excluded.append({'name': it['name'], 'reason': str(ex.get('reason', ''))[:40]})

    title = (plan.get('title') or '').strip() or f"{post.get('car','')} {post.get('service','')}".strip()
    subtitle = (plan.get('subtitle') or '').strip()
    out = {
        'title': title.replace('보닛', '본넷'),
        'subtitle': subtitle,
        'photos': chosen,
        'excluded': excluded,
        'contact': CONTACT,
        'bgm': args.bgm,
        'vertical': bool(args.vertical),
        'notes': plan.get('notes', ''),
    }
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    chapters = [p['chapter'] for p in chosen if p.get('chapter')]
    log(f"사용 {len(chosen)}장 / 제외 {len(excluded)}장 / 자막 {len(chapters)}개: {' · '.join(chapters)}")
    log(f"제목 카드: {out['title']} / {out['subtitle']}")


if __name__ == '__main__':
    main()
