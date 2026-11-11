#!/usr/bin/env python3
"""
사장님이 말하는 30초 — 폰 영상에 자막·세로 규격·로고·연락처 카드 (2026-11-11)

입력 mp4/mov → (faster-whisper 로 음성을 글로) → 자막 큐 → 1080x1920 세로(가로 영상이면 흐린 배경 위에 얹음)
→ 큰 자막(Pillow, 안전 영역 안) + 로고 → 마지막 연락처 카드 2.5초 → 음성 loudnorm → 말하기.mp4

사용:
  python3 talk.py --input clip.mp4 --assets assets/video --out <outdir> [--cues cues.json] [--model small] [--font PATH] [--fast]
  --cues 를 주면 음성 인식을 건너뛰고 그 자막(수정본)으로 다시 만든다
출력: 말하기.mp4, 말하기_썸네일.jpg, cues.json({cues:[{start,end,text}], transcript}), report.json
"""
from __future__ import annotations
import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1080, 1920
FPS = 30
RED = (236, 27, 48)
SAFE_TOP, SAFE_BOTTOM = 260, 1560          # 인스타 UI 가림 영역 밖
SUB_BASE_Y = 1420                           # 자막 블록 아래쪽 기준선
END_CARD_SEC = 2.5
CONTACT = ['상담 문의 010-7287-7140', '서울 서초구 서초중앙로8길 82 1동 1층 1호', '3M 프로이즘 강남서초점']
MAX_LINE_CHARS = 14
MAX_LINES = 2
MIN_CUE_SEC, MAX_CUE_SEC = 0.8, 3.6
FONT_CANDIDATES = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/System/Library/Fonts/AppleSDGothicNeo.ttc',
]


def log(msg):
    print(msg, flush=True)


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)


def ffprobe(path):
    out = run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', str(path)]).stdout
    return json.loads(out)


# ---------- 글꼴 ----------
def find_font(arg, assets):
    cands = []
    if arg:
        cands.append(arg)
    for ext in ('otf', 'ttf', 'ttc'):
        cands.append(os.path.join(assets, 'fonts', f'NotoSansKR-Bold.{ext}'))
    cands += FONT_CANDIDATES
    for c in cands:
        if c and os.path.isfile(c):
            for idx in range(0, 6):
                try:
                    f = ImageFont.truetype(c, 40, index=idx)
                    if f.getbbox('한')[2] > 5 and f.getbbox('한') != f.getbbox('�'):
                        return c, idx
                except Exception:  # noqa: BLE001
                    break
    raise SystemExit('한글 글꼴을 찾지 못했습니다 (assets/video/fonts/NotoSansKR-Bold.otf 또는 fonts-noto-cjk)')


class Fonts:
    def __init__(self, path, index):
        self.path, self.index, self.cache = path, index, {}

    def __call__(self, px):
        px = int(px)
        if px not in self.cache:
            self.cache[px] = ImageFont.truetype(self.path, px, index=self.index)
        return self.cache[px]


# ---------- 음성 → 자막 큐 ----------
VOCAB_PROMPT = ('3M 프로이즘 강남서초점입니다. 썬팅, PPF, 랩핑, 컬러PPF, 크롬죽이기, 신차패키지, 유리막코팅, '
                '글라스틴트 로데, 크리스탈라인, 루마 버텍스, 시리즈50, PRO200, 2080 사틴블랙, '
                '열선, 이질감, 곡면, 후면 유리, 하프 시공, 풀 시공, 본넷, 범퍼, 휀다, 도어, 루프, 메인터넌스, 테슬라 모델3, 서초, 강남, 역삼, 청담.')
# 자주 틀리는 표기 → 바른 표기 (음성 인식 뒤 자막·대본에 적용)
CORRECTIONS = [
    (r'프로\s*이[즘쯤점]', '프로이즘'), (r'프로이\s*즘', '프로이즘'), (r'강남\s*서\s*초점', '강남서초점'), (r'삼\s*엠', '3M'),
    (r'선팅', '썬팅'), (r'썬\s*팅', '썬팅'), (r'틴팅', '틴팅'), (r'공면', '곡면'), (r'이질\s*감', '이질감'), (r'열\s*선', '열선'),
    (r'때려면', '떼려면'), (r'때면', '떼면'), (r'피피에프|피 피 에프', 'PPF'), (r'보닛', '본넷'), (r'모델\s*3', '모델3'), (r'모델\s*와이', '모델Y'),
    (r'랩 핑', '랩핑'), (r'풀\s*시공', '풀 시공'), (r'하프\s*시공', '하프 시공'), (r'메인터\s*넌스', '메인터넌스'),
]


def correct_text(t: str) -> str:
    for pat, rep in CORRECTIONS:
        t = re.sub(pat, rep, t)
    return t


def transcribe(path, model_size, language='ko'):
    from faster_whisper import WhisperModel

    log(f'음성 인식 중 (faster-whisper {model_size})…')
    model = WhisperModel(model_size, device='cpu', compute_type='int8')
    segments, info = model.transcribe(str(path), language=language, vad_filter=True, word_timestamps=True,
                                      beam_size=5, condition_on_previous_text=False, initial_prompt=VOCAB_PROMPT)
    words = []
    for seg in segments:
        if seg.words:
            for w in seg.words:
                words.append({'start': float(w.start), 'end': float(w.end), 'word': w.word})
        else:
            words.append({'start': float(seg.start), 'end': float(seg.end), 'word': seg.text})
    return words, getattr(info, 'language', language)


def words_to_cues(words):
    """단어 타임스탬프를 2줄·14자 이내 큐로 묶는다 (0.8~3.6초)"""
    cues = []
    cur, cur_start = [], None
    cur_len = 0

    def flush(end):
        nonlocal cur, cur_start, cur_len
        if not cur:
            return
        text = ''.join(cur).strip()
        text = re.sub(r'\s+', ' ', text)
        if text:
            cues.append({'start': round(cur_start, 2), 'end': round(max(end, cur_start + MIN_CUE_SEC), 2), 'text': text})
        cur, cur_start, cur_len = [], None, 0

    for i, w in enumerate(words):
        tok = w['word']
        if cur_start is None:
            cur_start = w['start']
        # 큐 길이·문장부호·시간 기준으로 끊기
        too_long = cur_len + len(tok.strip()) > MAX_LINE_CHARS * MAX_LINES
        too_slow = (w['end'] - cur_start) > MAX_CUE_SEC
        gap = i > 0 and (w['start'] - words[i - 1]['end']) > 0.7
        if cur and (too_long or too_slow or gap):
            flush(words[i - 1]['end'])
            cur_start = w['start']
        cur.append(tok)
        cur_len += len(tok.strip())
        if re.search(r'[.!?。]$', tok.strip()) and cur_len >= 6:
            flush(w['end'])
    if words:
        flush(words[-1]['end'])
    for c in cues:
        c['text'] = correct_text(c['text'])
    # 너무 짧은 큐(6자 이하)는 앞 큐에 붙인다 (합쳐서 28자 이내일 때)
    merged = []
    for c in cues:
        if merged and len(c['text']) <= 6 and len(merged[-1]['text']) + 1 + len(c['text']) <= MAX_LINE_CHARS * MAX_LINES:
            merged[-1]['text'] = (merged[-1]['text'] + ' ' + c['text']).strip()
            merged[-1]['end'] = c['end']
        else:
            merged.append(c)
    cues = merged
    # 겹침 정리
    for a, b in zip(cues, cues[1:]):
        if a['end'] > b['start']:
            a['end'] = round(b['start'], 2)
    return cues


def wrap_cue(text, font, max_w, draw):
    """공백 기준으로 2줄 안에 넣기. 안 되면 글자 단위"""
    words = text.split(' ')
    lines, cur = [], ''
    for w in words:
        cand = (cur + ' ' + w).strip()
        if draw.textbbox((0, 0), cand, font=font)[2] <= max_w or not cur:
            cur = cand
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    if len(lines) <= MAX_LINES and all(draw.textbbox((0, 0), l, font=font)[2] <= max_w for l in lines):
        return lines
    # 글자 단위 재분배
    flat = text.replace(' ', '')
    n = max(1, math.ceil(len(flat) / MAX_LINES))
    return [flat[i:i + n] for i in range(0, len(flat), n)][:MAX_LINES]


# ---------- 오버레이 ----------
def make_logo(path, width):
    im = Image.open(path).convert('RGBA')
    a = np.array(im).astype(np.int16)
    white = (a[..., 0] > 235) & (a[..., 1] > 235) & (a[..., 2] > 235)
    a[..., 3] = np.where(white, 0, a[..., 3])
    im = Image.fromarray(a.astype(np.uint8), 'RGBA')
    bbox = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    r = width / im.width
    im = im.resize((width, max(1, int(im.height * r))), Image.LANCZOS)
    sh = Image.new('RGBA', (im.width + 16, im.height + 16), (0, 0, 0, 0))
    sa = Image.new('L', sh.size, 0)
    sa.paste(im.getchannel('A'), (8, 10))
    sa = sa.filter(ImageFilter.GaussianBlur(5)).point(lambda v: int(v * 0.5))
    shadow = Image.new('RGBA', sh.size, (0, 0, 0, 0))
    shadow.putalpha(sa)
    shadow.alpha_composite(im, (8, 8))
    return shadow


def render_cue_panel(lines, fonts, fast=False):
    """자막 블록(RGBA): 반투명 검정 둥근 상자 + 흰 글자"""
    px = 64
    pad_x, pad_y, gap = 36, 24, 10
    max_w = W - 2 * 72 - 2 * pad_x
    tmp = Image.new('RGBA', (1, 1))
    d = ImageDraw.Draw(tmp)
    while px > 44:
        f = fonts(px)
        widths = [d.textbbox((0, 0), l, font=f)[2] for l in lines]
        if max(widths) <= max_w:
            break
        px -= 4
    f = fonts(px)
    asc, desc = f.getmetrics()
    lh = int((asc + desc) * 1.08)
    widths = [d.textbbox((0, 0), l, font=f)[2] for l in lines]
    bw = max(widths) + 2 * pad_x
    bh = lh * len(lines) + gap * (len(lines) - 1) + 2 * pad_y
    panel = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
    pd = ImageDraw.Draw(panel)
    pd.rounded_rectangle((0, 0, bw - 1, bh - 1), radius=26, fill=(0, 0, 0, 165))
    y = pad_y
    for l, wdt in zip(lines, widths):
        x = (bw - wdt) // 2
        pd.text((x + 2, y + 3), l, font=f, fill=(0, 0, 0, 120))
        pd.text((x, y), l, font=f, fill=(255, 255, 255, 255))
        y += lh + gap
    return panel


def end_card(bg, logo_path, fonts):
    """마지막 카드: 마지막 프레임 흐림+어둡게, 큰 로고, 연락처 3줄"""
    base = bg.resize((W // 4, H // 4), Image.BILINEAR).filter(ImageFilter.GaussianBlur(6)).resize((W, H), Image.BICUBIC)
    base = Image.eval(base, lambda v: int(v * 0.45)).convert('RGBA')
    d = ImageDraw.Draw(base)
    y = 640
    if logo_path and os.path.isfile(logo_path):
        lg = make_logo(logo_path, 360)
        base.alpha_composite(lg, ((W - lg.width) // 2, y))
        y += lg.height + 70
    sizes = [66, 42, 56]
    cols = [(255, 255, 255, 255), (255, 255, 255, 217), (255, 255, 255, 255)]
    for i, (line, px, col) in enumerate(zip(CONTACT, sizes, cols)):
        f = fonts(px)
        l, t, r, b = d.textbbox((0, 0), line, font=f)
        x = (W - (r - l)) // 2 - l
        d.text((x + 2, y - t + 3), line, font=f, fill=(0, 0, 0, 120))
        d.text((x, y - t), line, font=f, fill=col)
        y += int((b - t) * 1.7)
        if i == 0:
            d.rounded_rectangle(((W - 120) // 2, y - 8, (W + 120) // 2, y - 2), radius=3, fill=RED + (255,))
            y += 26
    return base.convert('RGB')


# ---------- 메인 ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--assets', default='assets/video')
    ap.add_argument('--out', required=True)
    ap.add_argument('--cues', default='')
    ap.add_argument('--model', default=os.environ.get('WHISPER_MODEL', 'medium'))
    ap.add_argument('--language', default='ko')
    ap.add_argument('--font', default='')
    ap.add_argument('--fast', action='store_true')
    args = ap.parse_args()
    t0 = time.time()
    src = Path(args.input)
    if not src.is_file():
        log(f'입력 영상이 없습니다: {src}'); sys.exit(2)
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    font_path, font_idx = find_font(args.font, args.assets)
    fonts = Fonts(font_path, font_idx)
    warnings = []

    info = ffprobe(src)
    vs = next((s for s in info['streams'] if s['codec_type'] == 'video'), None)
    has_audio = any(s['codec_type'] == 'audio' for s in info['streams'])
    if not vs:
        log('영상 트랙이 없습니다'); sys.exit(2)
    dur = float(info['format'].get('duration') or 0)
    vw, vh = int(vs['width']), int(vs['height'])
    rot = 0
    for sd in vs.get('side_data_list', []) or []:
        if 'rotation' in sd:
            rot = int(sd['rotation'])
    if abs(rot) in (90, 270):
        vw, vh = vh, vw
    log(f'입력 {vw}x{vh} {dur:.1f}초 음성 {"있음" if has_audio else "없음"}')

    # 1) 자막 큐
    if args.cues and os.path.isfile(args.cues):
        cues = json.loads(Path(args.cues).read_text(encoding='utf-8')).get('cues', [])
        transcript = ' '.join(c['text'] for c in cues)
        log(f'자막 {len(cues)}개 (수정본 사용)')
    elif has_audio:
        words, lang = transcribe(src, args.model, args.language)
        cues = words_to_cues(words)
        transcript = correct_text(''.join(w['word'] for w in words).strip())
        log(f'자막 {len(cues)}개 / 인식 언어 {lang}')
    else:
        cues, transcript = [], ''
        warnings.append('음성이 없어 자막을 만들지 못했습니다')
    (outdir / 'cues.json').write_text(json.dumps({'cues': cues, 'transcript': transcript}, ensure_ascii=False, indent=1), encoding='utf-8')

    # 2) 세로 규격 변환 필터 (ffmpeg): 세로 영상은 1080x1920 채움 크롭, 가로 영상은 흐린 배경 위에 가로폭 1080 으로
    tall = vw / vh < 9 / 16 + 0.01
    if tall:
        vf = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},format=rgb24"
    else:
        vf = (f"split[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=30:5,eq=brightness=-0.15[bg];"
              f"[b]scale={W}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,fps={FPS},format=rgb24")
    tmp = Path(tempfile.mkdtemp(prefix='talk_'))
    try:
        dec = subprocess.Popen(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(src), '-filter_complex' if not tall else '-vf', vf,
                                '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
        main_mp4 = tmp / 'main.mp4'
        enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                                '-c:v', 'libx264', '-preset', 'veryfast' if args.fast else 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', str(main_mp4)], stdin=subprocess.PIPE)
        logo_path = os.path.join(args.assets, 'logo.png')
        logo = make_logo(logo_path, 150) if os.path.isfile(logo_path) else None
        panels = {}
        frame_bytes = W * H * 3
        n = 0
        last_frame = None
        thumb_done = False
        while True:
            buf = dec.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            fr = Image.frombuffer('RGB', (W, H), buf, 'raw', 'RGB', 0, 1).copy()
            t = n / FPS
            if logo:
                fr.paste(logo, (W - 72 - logo.width, SAFE_TOP + 10), logo)
            cue = next((c for c in cues if c['start'] <= t < c['end']), None)
            if cue:
                key = cue['text']
                if key not in panels:
                    lines = wrap_cue(key, fonts(64), W - 2 * 72 - 72, ImageDraw.Draw(Image.new('RGB', (1, 1))))
                    panels[key] = render_cue_panel(lines, fonts, args.fast)
                p = panels[key]
                # 시작 0.15초 페이드인
                a = min(1.0, (t - cue['start']) / 0.15)
                if a < 1.0:
                    p = p.copy()
                    p.putalpha(p.getchannel('A').point(lambda v: int(v * a)))
                fr.paste(p, ((W - p.width) // 2, SUB_BASE_Y - p.height), p)
            if not thumb_done and t >= 0.6:
                fr.save(outdir / '말하기_썸네일.jpg', 'JPEG', quality=90)
                thumb_done = True
            enc.stdin.write(fr.tobytes())
            last_frame = fr
            n += 1
        dec.stdout.close()
        enc.stdin.close()
        enc.wait()
        dec.wait()
        if n == 0:
            log('프레임을 읽지 못했습니다'); sys.exit(1)
        if not thumb_done and last_frame is not None:
            last_frame.save(outdir / '말하기_썸네일.jpg', 'JPEG', quality=90)
        main_sec = n / FPS

        # 3) 끝 카드
        card = end_card(last_frame, logo_path, fonts)
        card_png = tmp / 'card.png'
        card.save(card_png)
        card_mp4 = tmp / 'card.mp4'
        run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-loop', '1', '-i', str(card_png), '-t', str(END_CARD_SEC), '-r', str(FPS),
             '-vf', f'fade=in:0:{int(0.3 * FPS)},fade=out:{int((END_CARD_SEC - 0.4) * FPS)}:{int(0.4 * FPS)}',
             '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', str(card_mp4)])

        # 4) 오디오: 음성 loudnorm, 끝 카드 구간은 무음, 마지막 0.5초 페이드
        total = main_sec + END_CARD_SEC
        concat_txt = tmp / 'concat.txt'
        concat_txt.write_text(f"file '{main_mp4}'\nfile '{card_mp4}'\n", encoding='utf-8')
        out_mp4 = outdir / '말하기.mp4'
        if has_audio:
            af = (f"loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur={END_CARD_SEC + 1},atrim=0:{total:.3f},"
                  f"afade=t=out:st={max(0.0, main_sec - 0.3):.3f}:d=0.6,asetpts=PTS-STARTPTS")
            run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i', str(concat_txt), '-i', str(src),
                 '-filter_complex', f'[1:a]{af}[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
                 '-movflags', '+faststart', '-shortest', str(out_mp4)])
        else:
            run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i', str(concat_txt), '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
                 '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-shortest', str(out_mp4)])
        fin = ffprobe(out_mp4)
        report = {
            'duration_sec': round(float(fin['format']['duration']), 2), 'width': W, 'height': H, 'fps': FPS,
            'cues': len(cues), 'transcript': transcript, 'input': {'width': vw, 'height': vh, 'duration': round(dur, 2), 'landscape': not tall},
            'warnings': warnings, 'render_time_sec': round(time.time() - t0, 1),
        }
        (outdir / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
        log(f"완료: {out_mp4} ({report['duration_sec']}초, 자막 {len(cues)}개, {report['render_time_sec']}초 소요)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
