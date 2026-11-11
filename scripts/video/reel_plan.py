#!/usr/bin/env python3
"""
정보 릴스 대본 만들기 (Claude) — 2026-11-11
블로그 글(제목·본문) + 사진들 → 인스타 릴스용 대본 2~3개 (reel.py 가 읽는 plan JSON 배열)

- 첫 줄(hook)은 질문이나 반전 한 줄, 그 다음 3~5개 비트(핵심 문장), 마지막 상담 한 줄
- 본문에 있는 사실만. 제품 스펙·농도·가격 추측 금지. 작업자·경력 언급 금지
- 사진은 비트마다 어울리는 것을 고른다 (완성 사진은 hook·마지막에)

사용:
  python3 reel_plan.py --post post.json --photos-dir ./photos --out reels.json [--count 3] [--bgm URL]
  post.json = {"title": "...", "body": "...", "car": "...", "service": "...", "product": "..."}
출력: [{"id": "r1", "topic": "...", "hook": "...", "hook_src": "...", "beats": [...], "cta": {...}, "caption": "...", "hashtags": [...]}]
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sys
from pathlib import Path

from plan import load_thumb, plain_body, IMAGE_EXT, log  # 같은 폴더의 plan.py 재사용

CTA_DEFAULT = {"line2": "3M 프로이즘 강남서초점", "line3": "010-7287-7140"}
MAX_PHOTOS = 40

SYSTEM = """당신은 자동차 PPF·랩핑·썬팅 전문점(3M 프로이즘 강남서초점)의 인스타그램 릴스 작가입니다.
블로그 시공기 한 편과 사진들을 보고, 20~30초짜리 "정보 릴스" 대본을 여러 개 만듭니다. 반드시 save_reels 도구를 호출해 결과를 넘깁니다(설명 문장 금지).

릴스 한 개의 구조
- hook: 첫 1초에 멈추게 하는 한두 줄(최대 2줄, 줄당 12자 이내). 질문·반전·숫자. 예: "테슬라 후면 썬팅\\n반만 하면 생기는 일"
- beats: 3~5개. 각 text 는 2~3줄, 줄당 12자 이내, 한 비트에 한 가지 사실만. 줄바꿈은 \\n 으로 직접 넣는다. hold 는 글자 수에 맞춰 2.4~4.0초
- cta: line1 은 상담을 떠올리게 하는 한 줄(14자 이내, 예: "테슬라 썬팅 상담", "어디까지 할지 같이 정해요")
- caption: 인스타 본문 3~5줄(모바일 줄바꿈, 마침표 생략), 마지막 줄에 "상담 010-7287-7140"
- hashtags: 8~12개, 지역(강남·서초·역삼 등)+차종+시공 조합, # 포함

규칙
- 본문에 실제로 있는 내용만 쓴다. 제품 스펙·농도·가격·보증 기간을 지어내지 않는다. 본문에 없는 제품명 금지
- 작업자(팀장님·경력·1인 시공·출장 등)는 절대 언급하지 않는다. "저희"·"프로이즘" 1인칭 가게 시점
- "보닛" 대신 "본넷". PPF·컬러PPF 글이면 "열 성형"·"오버랩" 표현 금지
- 릴스마다 주제를 다르게: (1) 흔한 오해·실수, (2) 왜 이 선택인지, (3) 관리법·주의점, (4) 비포→애프터 중 글에 근거가 있는 것만
- 사진은 제가 번호를 붙여 보냅니다. hook_photo 와 각 beat 의 photo 는 그 번호로 고릅니다. hook 과 마지막 beat 는 완성 사진, 중간은 설명에 맞는 작업 사진. 같은 사진을 연속으로 쓰지 않는다
- 이모지·과장("압도적·최고·1위") 금지

출력 형식
[{"id": "r1", "topic": "흔한 오해", "hook": "...", "hook_photo": 3,
  "beats": [{"text": "...", "photo": 5, "hold": 3.0}, ...],
  "cta_line1": "...", "caption": "...", "hashtags": ["#강남썬팅", ...]}, ...]"""


def ask_claude(model: str, post: dict, items: list, count: int) -> list:
    import anthropic

    client = anthropic.Anthropic()
    content = []
    for it in items:
        content.append({'type': 'text', 'text': f"[사진 {it['index']}] {it['name']}"})
        content.append({'type': 'image', 'source': {'type': 'base64', 'media_type': it['media_type'], 'data': it['data']}})
    content.append({'type': 'text', 'text': (
        f"블로그 제목: {post.get('title','')}\n차량: {post.get('car','')} / 시공: {post.get('service','')} / 제품: {post.get('product','')}\n\n"
        f"본문:\n{plain_body(post.get('body',''))[:7000]}\n\n릴스 대본 {count}개를 JSON 배열로 출력하세요."
    )})
    # 구조화 출력: 도구 호출 스키마로 받아 JSON 파싱 오류(따옴표 등)를 피한다
    tool = {
        'name': 'save_reels',
        'description': '릴스 대본 배열을 저장한다',
        'input_schema': {
            'type': 'object',
            'properties': {
                'reels': {
                    'type': 'array',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'id': {'type': 'string'},
                            'topic': {'type': 'string'},
                            'hook': {'type': 'string', 'description': '최대 2줄, 줄바꿈은 \\n'},
                            'hook_photo': {'type': 'integer'},
                            'beats': {
                                'type': 'array',
                                'items': {
                                    'type': 'object',
                                    'properties': {
                                        'text': {'type': 'string'},
                                        'photo': {'type': 'integer'},
                                        'hold': {'type': 'number'},
                                    },
                                    'required': ['text', 'photo', 'hold'],
                                },
                            },
                            'cta_line1': {'type': 'string'},
                            'caption': {'type': 'string'},
                            'hashtags': {'type': 'array', 'items': {'type': 'string'}},
                        },
                        'required': ['id', 'topic', 'hook', 'hook_photo', 'beats', 'cta_line1', 'caption', 'hashtags'],
                    },
                }
            },
            'required': ['reels'],
        },
    }
    with client.messages.stream(model=model, max_tokens=6000, system=SYSTEM, messages=[{'role': 'user', 'content': content}],
                                tools=[tool], tool_choice={'type': 'auto'}) as stream:
        msg = stream.get_final_message()
    for b in msg.content:
        if getattr(b, 'type', '') == 'tool_use' and b.name == 'save_reels':
            return list(b.input.get('reels', []))
    # 도구를 안 쓰고 텍스트로 답한 경우: JSON 배열을 찾아 파싱 (따옴표 깨짐은 한 번 보정)
    text = ''.join(b.text for b in msg.content if getattr(b, 'type', '') == 'text')
    m = re.search(r'\[[\s\S]*\]', text)
    if not m:
        raise RuntimeError('대본 JSON 을 받지 못했습니다: ' + text[:300])
    raw = m.group(0)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        fixed = re.sub(r'(?<=[가-힣A-Za-z0-9 ])"(?=[가-힣A-Za-z0-9 ])', "'", raw)
        return json.loads(fixed)


def clean_line(s: str, max_lines: int, max_chars: int) -> str:
    lines = [l.strip() for l in str(s or '').replace('\\n', '\n').split('\n') if l.strip()]
    out = []
    for l in lines:
        l = l.replace('보닛', '본넷')
        while len(l) > max_chars + 4 and len(out) < max_lines - 1:
            cut = l.rfind(' ', 0, max_chars + 1)
            if cut <= 0:
                cut = max_chars
            out.append(l[:cut].strip())
            l = l[cut:].strip()
        out.append(l)
    return '\n'.join(out[:max_lines])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--post', required=True)
    ap.add_argument('--photos-dir', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--count', type=int, default=3)
    ap.add_argument('--bgm', default='')
    ap.add_argument('--model', default=os.environ.get('VIDEO_PLAN_MODEL', 'claude-sonnet-5-5'))
    args = ap.parse_args()

    post = json.loads(Path(args.post).read_text(encoding='utf-8'))
    pdir = Path(args.photos_dir)
    photos = sorted([p for p in pdir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXT], key=lambda p: p.name.lower())
    if not photos:
        log('사진이 없습니다'); sys.exit(2)
    shown = photos
    if len(photos) > MAX_PHOTOS:
        step = len(photos) / MAX_PHOTOS
        shown = [photos[int(i * step)] for i in range(MAX_PHOTOS)]
    items = []
    for i, p in enumerate(shown, 1):
        t = load_thumb(p, max_side=800)
        if t:
            items.append({'index': i, 'name': p.name, 'path': str(p), 'data': t[0], 'media_type': t[1]})
    by_index = {it['index']: it for it in items}
    log(f'사진 {len(items)}장으로 릴스 대본 {args.count}개 생성')

    scripts = ask_claude(args.model, post, items, args.count)
    out = []
    for n, sc in enumerate(scripts, 1):
        beats = []
        last = None
        for b in sc.get('beats', []):
            it = by_index.get(int(b.get('photo', -1))) or last or (items[0] if items else None)
            if not it:
                continue
            hold = float(b.get('hold') or 3.0)
            beats.append({'text': clean_line(b.get('text', ''), 3, 12), 'src': it['path'], 'hold': round(max(2.0, min(6.0, hold)), 2)})
            last = it
        if len(beats) < 3:
            continue
        hook_it = by_index.get(int(sc.get('hook_photo', -1))) or items[0]
        hashtags = [h if h.startswith('#') else f'#{h}' for h in (sc.get('hashtags') or []) if h]
        out.append({
            'id': sc.get('id') or f'r{n}',
            'topic': sc.get('topic', ''),
            'hook': clean_line(sc.get('hook', ''), 2, 12),
            'hook_src': hook_it['path'],
            'beats': beats,
            'cta': {'line1': clean_line(sc.get('cta_line1', '') or '상담은 편하게', 1, 14), **CTA_DEFAULT},
            'bgm': args.bgm,
            'brand': '3M 프로이즘 강남서초점',
            'caption': str(sc.get('caption', '')).strip(),
            'hashtags': hashtags[:12],
        })
    if not out:
        log('쓸 수 있는 대본이 없습니다'); sys.exit(2)
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    for r in out:
        log(f"- {r['id']} [{r['topic']}] {r['hook'].replace(chr(10), ' / ')} ({len(r['beats'])}비트)")


if __name__ == '__main__':
    main()
