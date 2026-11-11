#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
세로 정보 릴스(9:16) 렌더러 — 3M 프로이즘 강남서초점

    python3 scripts/video/reel.py --plan reel.json --assets assets/video --out <outdir> [--font PATH] [--fast]

출력
    <outdir>/릴스.mp4          1080x1920 30fps H.264(libx264 medium crf20 yuv420p) + AAC 160k 44.1kHz, faststart
    <outdir>/릴스_썸네일.jpg    훅 장면(글자 완전히 뜬 상태)
    <outdir>/report.json       duration_sec, width, height, beats, warnings, audio{mean_db,max_db}, render_time_sec

종료 코드: 0 정상 / 2 플랜 문제 / 1 렌더 실패

구성(초): 훅 2.6 → 비트 n개(각 hold, 2.0~6.0로 클램프, 사이 0.35 크로스페이드) → CTA 2.6(마지막 0.4 블랙 페이드)
모든 프레임은 Pillow 로 만들어 ffmpeg 한 프로세스에 rawvideo 로 파이프한 뒤, 2차 패스에서 BGM(2-pass loudnorm) 을 합친다.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

try:
    import numpy as np
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps
except ImportError as e:  # pragma: no cover
    sys.stderr.write("필수 패키지가 없습니다 (pip install pillow numpy): %s\n" % e)
    sys.exit(1)

_RS = getattr(Image, "Resampling", Image)

# --------------------------------------------------------------------------- 규격
W, H, FPS = 1080, 1920, 30
SW, SH = 1242, 2208                     # 사전 스케일 소스 크기(9:16, 켄 번스 크롭용)
SAFE_L, SAFE_R, SAFE_T, SAFE_B = 72, 1008, 260, 1560
SAFE_W = SAFE_R - SAFE_L

HOOK_SEC = 2.6
CTA_SEC = 2.6
XF_SEC = 0.35          # 비트 사이 사진 크로스페이드
BLACK_SEC = 0.4        # 끝 블랙 페이드
HOOK_POP = 0.3         # 훅 글자 팝인
TEXT_IN = 0.28         # 비트 캡션 슬라이드 인
TEXT_OUT = 0.2         # 비트 캡션 페이드 아웃
TEXT_IN_DELAY = 0.15   # 2번째 비트부터 캡션 등장 지연(크로스페이드 중간)
CTA_FADE = 0.3
HOLD_MIN, HOLD_MAX = 2.0, 6.0
SLIDE_PX = 40

RED = (236, 27, 48)
WHITE = (255, 255, 255)

HOOK_PX, HOOK_MIN_PX, HOOK_LINES = 104, 64, 2
BEAT_PX, BEAT_MIN_PX, BEAT_LINES = 72, 48, 3
CHIP_PX = 34
PANEL_PAD, PANEL_RADIUS, PANEL_ALPHA = 40, 28, 160
PANEL_BOTTOM = 1480          # 캡션 패널 아래 변 y
HOOK_CENTER_Y = 900
LOGO_SMALL_W, LOGO_BIG_W = 150, 360
LOGO_SMALL_Y = 280

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansKR-Bold.ttf",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
]
DEFAULT_BRAND = "3M 프로이즘 강남서초점"
DEFAULT_PHONE = "010-7287-7140"


class PlanError(Exception):
    pass


class RenderError(Exception):
    pass


def log(msg):
    sys.stdout.write("[릴스] %s\n" % msg)
    sys.stdout.flush()


def run(cmd, timeout=None):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if p.returncode != 0:
        err = p.stderr.decode("utf-8", "replace").strip().splitlines()
        raise RenderError("ffmpeg 실패: %s" % (" | ".join(err[-4:]) if err else cmd[0]))
    return p


def ffprobe(path):
    try:
        p = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
        return json.loads(p.stdout.decode("utf-8", "replace") or "{}")
    except Exception:  # noqa: BLE001
        return {}


def media_duration(path):
    info = ffprobe(path)
    try:
        return float(info.get("format", {}).get("duration") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def ease(t):
    """ease-in-out cubic, 0~1 클램프."""
    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
    return 4 * t * t * t if t < 0.5 else 1 - ((-2 * t + 2) ** 3) / 2.0


def clamp01(v):
    return 0.0 if v < 0 else (1.0 if v > 1 else v)


# --------------------------------------------------------------------------- 입력(다운로드)
def is_url(s):
    return isinstance(s, str) and re.match(r"^https?://", s, re.I) is not None


def download(url, dst_dir, retries=2):
    base = re.sub(r"[^\w.\-]+", "_", os.path.basename(url.split("?")[0]) or "file")[:60]
    dst = os.path.join(dst_dir, "%s_%s" % (hashlib.md5(url.encode("utf-8")).hexdigest()[:8], base))
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return dst
    headers = {"User-Agent": UA, "Accept": "*/*"}
    if "pstatic.net" in url or "naver" in url:
        headers["Referer"] = "https://blog.naver.com/"
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as r, open(dst, "wb") as f:
                shutil.copyfileobj(r, f, 1 << 16)
            if os.path.getsize(dst) > 0:
                return dst
            last = "빈 응답"
        except Exception as e:  # noqa: BLE001
            last = str(e)
            time.sleep(1.0 + attempt)
    if os.path.exists(dst):
        os.remove(dst)
    raise RenderError("다운로드 실패 %s: %s" % (url, last))


def resolve_src(src, plan_dir, tmp_dl):
    if not src or not isinstance(src, str):
        return None
    if is_url(src):
        return download(src, tmp_dl)
    p = src if os.path.isabs(src) else os.path.join(plan_dir, src)
    if not os.path.isfile(p):
        raise RenderError("파일 없음: %s" % src)
    return p


# --------------------------------------------------------------------------- 글꼴
def _has_korean(font):
    try:
        a = font.getmask("한")
        b = font.getmask("\U000E0001")
        return a.size != b.size or bytes(a) != bytes(b)
    except Exception:  # noqa: BLE001
        return False


def _pick_face(path):
    best = None
    for idx in range(0, 12):
        try:
            f = ImageFont.truetype(path, 32, index=idx)
        except Exception:  # noqa: BLE001
            break
        try:
            fam = (f.getname()[0] or "").upper()
        except Exception:  # noqa: BLE001
            fam = ""
        if _has_korean(f):
            if "KR" in fam or "KOREA" in fam:
                return idx
            if best is None:
                best = idx
    return best


def find_font(arg_path, assets_dir):
    cands = []
    if arg_path:
        cands.append(arg_path)
    fdir = os.path.join(assets_dir, "fonts")
    if os.path.isdir(fdir):
        for fn in sorted(os.listdir(fdir)):
            if re.match(r"NotoSansKR-Bold\.(ttf|otf|ttc)$", fn, re.I):
                cands.append(os.path.join(fdir, fn))
    cands.extend(FONT_CANDIDATES)
    for p in cands:
        if not p or not os.path.isfile(p):
            continue
        idx = _pick_face(p)
        if idx is not None:
            return p, idx
    raise RenderError("한글 글꼴을 찾지 못했습니다. --font 로 NotoSansKR-Bold.otf 경로를 주세요")


class Typo:
    """글꼴 캐시 + 측정 + 잉크 기준 블록 렌더."""

    def __init__(self, path, index):
        self.path, self.index = path, index
        self._cache = {}
        self._draw = ImageDraw.Draw(Image.new("L", (4, 4)))

    def font(self, px):
        px = int(px)
        if px not in self._cache:
            self._cache[px] = ImageFont.truetype(self.path, px, index=self.index)
        return self._cache[px]

    def bbox(self, font, s):
        return self._draw.textbbox((0, 0), s, font=font)

    def width(self, font, s):
        l, _t, r, _b = self.bbox(font, s)
        return r - l

    def wrap(self, text, font, max_w):
        lines = []
        for para in str(text).replace("\r", "").split("\n"):
            words = para.split()
            if not words:
                continue
            cur = ""
            for w in words:
                cand = (cur + " " + w) if cur else w
                if self.width(font, cand) <= max_w:
                    cur = cand
                    continue
                if cur:
                    lines.append(cur)
                while self.width(font, w) > max_w and len(w) > 1:
                    k = len(w)
                    while k > 1 and self.width(font, w[:k]) > max_w:
                        k -= 1
                    lines.append(w[:k])
                    w = w[k:]
                cur = w
            if cur:
                lines.append(cur)
        return lines

    def fit(self, text, max_px, min_px, max_w, max_lines, warnings=None, label=""):
        """4px 씩 줄이며 max_lines 안에 들어가는 크기를 찾는다. 바닥에서도 안 되면 잘라낸다(넘침 금지)."""
        px = max_px
        while px >= min_px:
            lines = self.wrap(text, self.font(px), max_w)
            if lines and len(lines) <= max_lines:
                return px, lines
            px -= 4
        px = min_px
        f = self.font(px)
        lines = self.wrap(text, f, max_w) or [""]
        if len(lines) > max_lines:
            lines = lines[:max_lines]
            last = lines[-1]
            while last and self.width(f, last + "…") > max_w:
                last = last[:-1]
            lines[-1] = last + "…"
            if warnings is not None:
                warnings.append("%s 글자가 길어 %d줄로 잘랐습니다: %s" % (label or "문구", max_lines, text.replace("\n", " ")))
        return px, lines

    def block(self, lines, px, fill, align="left", line_mul=1.3, shadow=None):
        """여러 줄을 그려 잉크 bbox 로 잘라낸 RGBA. shadow=(dy, blur, alpha) 면 그림자 포함(여유 포함해 자름)."""
        font = self.font(px)
        line_h = int(round(px * line_mul))
        ascent, descent = font.getmetrics()
        boxes = [self.bbox(font, s) for s in lines]
        widths = [b[2] - b[0] for b in boxes]
        bw = max(widths) if widths else 1
        margin = int(px * 0.6) + (int(shadow[1] * 3) if shadow else 0)
        cw = bw + margin * 2
        ch = (len(lines) - 1) * line_h + ascent + descent + margin * 2
        txt = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        d = ImageDraw.Draw(txt)
        for i, s in enumerate(lines):
            f_ = {"left": 0.0, "center": 0.5, "right": 1.0}[align]
            x = margin + (bw - widths[i]) * f_ - boxes[i][0]
            y = margin + i * line_h + ascent
            d.text((x, y), s, font=font, fill=fill, anchor="ls")
        ink = txt.getchannel("A").getbbox()
        if not ink:
            return Image.new("RGBA", (1, 1), (0, 0, 0, 0))
        if shadow:
            dy, blur, alpha = shadow
            sh = Image.new("L", (cw, ch), 0)
            sh.paste(txt.getchannel("A"), (0, int(dy)))
            sh = sh.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(v * alpha))
            layer = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
            layer.putalpha(sh)
            layer.alpha_composite(txt)
            pad = int(blur * 2 + abs(dy)) + 2
            box = (max(0, ink[0] - pad), max(0, ink[1] - pad), min(cw, ink[2] + pad), min(ch, ink[3] + pad))
            out = layer.crop(box)
            # 잉크(그림자 제외)의 위치를 기록해 정렬에 쓴다
            out.info["ink"] = (ink[0] - box[0], ink[1] - box[1], ink[2] - box[0], ink[3] - box[1])
            return out
        out = txt.crop(ink)
        out.info["ink"] = (0, 0, out.size[0], out.size[1])
        return out


# --------------------------------------------------------------------------- 이미지 유틸
def exif_open(path):
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)
    if im.mode != "RGB":
        im = im.convert("RGB")
    return im


def prepare_photo(path):
    """EXIF 회전 → 약한 자동 대비 → 9:16 크롭(세로 긴 사진은 살짝 위쪽) → SW×SH."""
    im = exif_open(path)
    try:
        ac = ImageOps.autocontrast(im, cutoff=0.5, preserve_tone=True)
    except TypeError:
        ac = ImageOps.autocontrast(im, cutoff=0.5)
    im = Image.blend(im, ac, 0.5)
    w, h = im.size
    aspect = SW / float(SH)
    if w / float(h) > aspect:
        nw = int(round(h * aspect))
        x0 = (w - nw) // 2
        im = im.crop((x0, 0, x0 + nw, h))
    else:
        nh = int(round(w / aspect))
        y0 = int((h - nh) * 0.42)
        im = im.crop((0, y0, w, y0 + nh))
    if im.size != (SW, SH):
        im = im.resize((SW, SH), _RS.LANCZOS if im.size[0] >= SW else _RS.BICUBIC)
    return im


def make_logo(path, width, typo=None, wordmark="PROIZM"):
    """흰 배경 투명화 + 트림 + 리사이즈 + (아래 워드마크) + 드롭섀도 → (RGBA, pad).
    logo.png 에는 빨간 3M 마크만 있어 매장 간판처럼 아래에 PROIZM 을 흰 글자로 붙인다."""
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    minc = a[..., :3].min(axis=2)
    soft = np.clip((245.0 - minc) / 30.0, 0.0, 1.0)
    alpha = a[..., 3] * soft
    a[..., 3] = alpha
    im = Image.fromarray(a.astype(np.uint8))
    bbox = Image.fromarray((alpha > 8).astype(np.uint8) * 255).getbbox()
    if bbox:
        im = im.crop(bbox)
    w, h = im.size
    nh = max(1, int(round(h * width / float(w))))
    im = im.resize((width, nh), _RS.LANCZOS)
    if typo is not None and wordmark:
        # 워드마크: 마크 너비의 ~88%, 자간 넓게
        px = max(10, int(width * 0.19))
        while px > 10 and typo.width(typo.font(px), " ".join(wordmark)) > width * 0.9:
            px -= 1
        wm = typo.block([" ".join(wordmark)], px, WHITE, align="center", line_mul=1.0)
        gap = max(4, int(width * 0.07))
        merged = Image.new("RGBA", (width, nh + gap + wm.size[1]), (0, 0, 0, 0))
        merged.alpha_composite(im, (0, 0))
        merged.alpha_composite(wm, ((width - wm.size[0]) // 2, nh + gap))
        im = merged
        nh = im.size[1]
    pad = max(6, width // 12)
    off = max(2, width // 50)
    canvas = Image.new("RGBA", (width + pad * 2, nh + pad * 2), (0, 0, 0, 0))
    sh_alpha = Image.new("L", canvas.size, 0)
    sh_alpha.paste(im.getchannel("A"), (pad, pad + off))
    sh_alpha = sh_alpha.filter(ImageFilter.GaussianBlur(max(2, width / 30.0))).point(lambda v: int(v * 0.6))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow.putalpha(sh_alpha)
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.alpha_composite(im, (pad, pad))
    return canvas, pad


def vertical_shade(stops):
    """(y비율, 밝기배율) 꺾은선 → ImageChops.multiply 용 RGB 그라데이션."""
    ys = np.arange(H, dtype=np.float32) / float(H - 1)
    xs = [s[0] for s in stops]
    vs = [s[1] for s in stops]
    col = np.interp(ys, xs, vs)
    g = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8).reshape(H, 1)).resize((W, H), _RS.NEAREST)
    return Image.merge("RGB", (g, g, g))


def with_alpha(rgba, a):
    if a >= 0.999:
        return rgba
    out = rgba.copy()
    out.putalpha(rgba.getchannel("A").point(lambda v: int(v * a)))
    return out


def paste(frame, rgba, xy):
    frame.paste(rgba, (int(round(xy[0])), int(round(xy[1]))), rgba)


def rounded_panel(size, radius, alpha):
    p = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(p).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=(0, 0, 0, alpha))
    return p


# --------------------------------------------------------------------------- 켄 번스
def kb_box(pattern, u, zmax):
    """pattern 0 줌인 / 1 팬 왼→오 / 2 팬 오→왼. u 0~1(이징 전). 소스 좌표 float 박스."""
    t = ease(u)
    px = py = 0.0
    if pattern == 0:
        z = 1.0 + (zmax - 1.0) * t
    elif pattern == 1:
        z = zmax
        px = -1.0 + 2.0 * t
        py = -0.25 + 0.5 * t
    else:
        z = zmax
        px = 1.0 - 2.0 * t
        py = 0.25 - 0.5 * t
    cw, ch = SW / z, SH / z
    cx = SW / 2.0 + px * (SW - cw) / 2.0
    cy = SH / 2.0 + py * (SH - ch) / 2.0
    x0, y0 = cx - cw / 2.0, cy - ch / 2.0
    x0 = min(max(0.0, x0), SW - cw)
    y0 = min(max(0.0, y0), SH - ch)
    return (x0, y0, x0 + cw, y0 + ch)


# --------------------------------------------------------------------------- 렌더러
class ReelRenderer:
    def __init__(self, plan, args, tmp, warnings):
        self.plan = plan
        self.args = args
        self.tmp = tmp
        self.warnings = warnings
        self.resample = _RS.HAMMING if args.fast else _RS.BICUBIC
        self.plan_dir = os.path.dirname(os.path.abspath(args.plan))
        self.dl = os.path.join(tmp, "dl")
        os.makedirs(self.dl, exist_ok=True)

    # ----- 플랜 해석 ---------------------------------------------------------
    def parse(self):
        plan = self.plan
        if not isinstance(plan, dict):
            raise PlanError("플랜 JSON 최상위가 객체가 아닙니다")
        beats_in = plan.get("beats")
        if not isinstance(beats_in, list) or not beats_in:
            raise PlanError("beats 가 비어 있습니다")
        beats = []
        for i, b in enumerate(beats_in):
            if not isinstance(b, dict):
                raise PlanError("beats[%d] 가 객체가 아닙니다" % i)
            text = str(b.get("text") or "").strip()
            if not text:
                raise PlanError("beats[%d].text 가 비어 있습니다" % i)
            try:
                hold = float(b.get("hold", 3.0))
            except (TypeError, ValueError):
                hold = 3.0
                self.warnings.append("beats[%d].hold 값이 숫자가 아니라 3.0초로 둡니다" % i)
            if not math.isfinite(hold):
                hold = 3.0
            hold_c = min(HOLD_MAX, max(HOLD_MIN, hold))
            if abs(hold_c - hold) > 1e-6:
                self.warnings.append("beats[%d].hold %.1f → %.1f 로 클램프" % (i, hold, hold_c))
            beats.append({"text": text, "src": b.get("src"), "hold": hold_c})
        self.beats = beats

        hook = str(plan.get("hook") or "").strip()
        if not hook:
            hook = beats[0]["text"]
            self.warnings.append("hook 이 없어 첫 비트 문구를 훅으로 씁니다")
        self.hook_text = hook
        self.brand = str(plan.get("brand") or DEFAULT_BRAND).strip() or DEFAULT_BRAND
        cta = plan.get("cta") if isinstance(plan.get("cta"), dict) else {}
        self.cta = {
            "line1": str(cta.get("line1") or "상담 문의").strip(),
            "line2": str(cta.get("line2") or self.brand).strip(),
            "line3": str(cta.get("line3") or DEFAULT_PHONE).strip(),
        }
        self.hook_src = plan.get("hook_src") or beats[0].get("src")
        self.bgm_src = plan.get("bgm")

    # ----- 사진 로드 ---------------------------------------------------------
    def _load(self, src, label):
        try:
            p = resolve_src(src, self.plan_dir, self.dl)
            if not p:
                raise RenderError("src 없음")
            return prepare_photo(p)
        except Exception as e:  # noqa: BLE001
            self.warnings.append("%s 사진을 못 읽어 다른 사진으로 대체: %s (%s)" % (label, src, e))
            return None

    def load_photos(self):
        photos = []
        prev = None
        for i, b in enumerate(self.beats):
            im = self._load(b["src"], "비트 %d" % (i + 1))
            if im is None:
                im = prev
            photos.append(im)
            if im is not None:
                prev = im
        # 앞쪽이 비어 있으면 뒤에서 가져온다
        nxt = None
        for i in range(len(photos) - 1, -1, -1):
            if photos[i] is None:
                photos[i] = nxt
            else:
                nxt = photos[i]
        if any(p is None for p in photos):
            raise PlanError("사진을 한 장도 읽지 못했습니다")
        self.photos = photos
        hook = None
        if self.hook_src and self.hook_src != self.beats[0].get("src"):
            hook = self._load(self.hook_src, "훅")
        self.hook_photo = hook if hook is not None else photos[0]

    # ----- 타임라인 ----------------------------------------------------------
    def timeline(self):
        t = HOOK_SEC
        n = len(self.beats)
        for i, b in enumerate(self.beats):
            b["start"] = t
            b["end"] = t + b["hold"]
            b["has_next"] = i < n - 1
            t += b["hold"] - (XF_SEC if i < n - 1 else 0.0)
        self.cta_start = t
        self.total = t + CTA_SEC
        self.n_frames = int(round(self.total * FPS))

    # ----- 정적 요소 사전 렌더 ---------------------------------------------
    def prerender(self, typo, logo_path):
        self.typo = typo
        # 로고
        self.logo_small = self.logo_big = None
        if logo_path and os.path.isfile(logo_path):
            try:
                self.logo_small = make_logo(logo_path, LOGO_SMALL_W, typo)
                self.logo_big = make_logo(logo_path, LOGO_BIG_W, typo)
            except Exception as e:  # noqa: BLE001
                self.warnings.append("로고를 읽지 못해 로고 없이 렌더: %s" % e)
        else:
            self.warnings.append("로고 파일이 없어 로고 없이 렌더: %s" % logo_path)

        # 그라데이션(곱하기 마스크)
        self.hook_shade = vertical_shade([(0.0, 0.50), (0.18, 0.60), (0.36, 0.52), (0.56, 0.52), (1.0, 0.34)])
        self.beat_shade = vertical_shade([(0.0, 0.78), (0.14, 1.0), (0.52, 1.0), (1.0, 0.50)])

        # 훅 글자 블록: 빨간 바 + 글자(그림자)
        px, lines = typo.fit(self.hook_text, HOOK_PX, HOOK_MIN_PX, SAFE_W, HOOK_LINES, self.warnings, "훅")
        txt = typo.block(lines, px, WHITE, align="center", line_mul=1.22, shadow=(5, 7, 0.55))
        ink = txt.info["ink"]
        bar_w, bar_h, gap = 96, 8, 30
        bw = max(txt.size[0], bar_w)
        bh = bar_h + gap + txt.size[1]
        blk = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
        ink_cx = (ink[0] + ink[2]) / 2.0 + (bw - txt.size[0]) / 2.0
        # 글자 잉크 위 gap 만큼 띄워 빨간 바(잉크 top = bar_h + gap + ink[1])
        ImageDraw.Draw(blk).rounded_rectangle(
            (int(ink_cx - bar_w / 2), ink[1], int(ink_cx + bar_w / 2), ink[1] + bar_h), radius=4, fill=RED + (255,))
        blk.alpha_composite(txt, ((bw - txt.size[0]) // 2, bar_h + gap))
        # 잉크 중심(그림자 제외) 이 HOOK_CENTER_Y 에 오도록
        ink_cy = bar_h + gap + (ink[1] + ink[3]) / 2.0
        self.hook_block = blk
        self.hook_block_pos = (W / 2.0 - bw / 2.0, HOOK_CENTER_Y - ink_cy)
        log("훅 글자 %dpx %d줄" % (px, len(lines)))

        # 비트 캡션 블록(칩 + 패널)
        n = len(self.beats)
        max_w = SAFE_W - PANEL_PAD * 2
        for i, b in enumerate(self.beats):
            px, lines = typo.fit(b["text"], BEAT_PX, BEAT_MIN_PX, max_w, BEAT_LINES, self.warnings, "비트 %d" % (i + 1))
            txt = typo.block(lines, px, WHITE, align="left", line_mul=1.3)
            pw, ph = txt.size[0] + PANEL_PAD * 2, txt.size[1] + PANEL_PAD * 2
            panel = rounded_panel((pw, ph), PANEL_RADIUS, PANEL_ALPHA)
            panel.alpha_composite(txt, (PANEL_PAD, PANEL_PAD))
            chip = typo.block(["%02d / %02d" % (i + 1, n)], CHIP_PX, RED, align="left")
            chip_gap = 18
            bw_ = max(pw, chip.size[0] + 6)
            blk = Image.new("RGBA", (bw_, chip.size[1] + chip_gap + ph), (0, 0, 0, 0))
            blk.alpha_composite(chip, (6, 0))
            blk.alpha_composite(panel, (0, chip.size[1] + chip_gap))
            b["block"] = blk
            b["block_pos"] = (SAFE_L, PANEL_BOTTOM - blk.size[1])
            b["px"] = px
            b["lines"] = len(lines)
            log("비트 %d 캡션 %dpx %d줄 패널 %dx%d" % (i + 1, px, len(lines), pw, ph))

        # CTA 배경 + 오버레이
        last = self.beats[-1]
        last_photo = self.photos[-1]
        last_box = kb_box((n - 1) % 3, 1.0, 1.05)
        self.last_frame = self._beat_bg(last_photo, last_box)
        small = self.last_frame.resize((W // 4, H // 4), _RS.BILINEAR).filter(ImageFilter.GaussianBlur(5))
        bg = small.resize((W, H), _RS.BICUBIC)
        self.cta_bg = Image.eval(bg, lambda v: int(v * 0.45))

        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        def cta_line(text, px, min_px, fill, label):
            fpx, lines = typo.fit(text, px, min_px, SAFE_W, 1, self.warnings, label)
            return typo.block(lines, fpx, fill, "center", 1.22, (4, 6, 0.4))

        l1 = cta_line(self.cta["line1"], 80, 56, WHITE, "CTA1")
        l2 = cta_line(self.cta["line2"], 48, 36, (255, 255, 255, 217), "CTA2")
        l3 = cta_line(self.cta["line3"], 64, 44, WHITE, "CTA3")
        gaps = {"logo": 84, "l1": 30, "l2": 40, "l3": 0}
        seq = ([("logo", self.logo_big[0])] if self.logo_big else []) + [("l1", l1), ("l2", l2), ("l3", l3)]
        total_h = sum(im.size[1] for _k, im in seq) + sum(gaps[k] for k, _im in seq[:-1])
        y = int((SAFE_T + SAFE_B) / 2.0 - total_h / 2.0) + 20
        y = max(SAFE_T, min(y, SAFE_B - total_h))
        for k, im in seq:
            ov.alpha_composite(im, ((W - im.size[0]) // 2, int(y)))
            y += im.size[1] + gaps[k]
        self.cta_overlay = ov
        self.black = Image.new("RGB", (W, H), (0, 0, 0))

    # ----- 프레임 합성 -------------------------------------------------------
    def _crop(self, photo, box):
        return photo.resize((W, H), self.resample, box=box)

    def _stamp_logo(self, frame):
        if self.logo_small:
            im, pad = self.logo_small
            paste(frame, im, (SAFE_R - im.size[0] + pad, LOGO_SMALL_Y - pad))

    def _beat_bg(self, photo, box):
        return ImageChops.multiply(self._crop(photo, box), self.beat_shade)

    def hook_frame(self, t, pop=True):
        u = t / HOOK_SEC
        frame = ImageChops.multiply(self._crop(self.hook_photo, kb_box(0, u, 1.08)), self.hook_shade)
        self._stamp_logo(frame)
        blk, (bx, by) = self.hook_block, self.hook_block_pos
        if pop and t < HOOK_POP:
            k = ease(t / HOOK_POP)
            s = 0.92 + 0.08 * k
            if k <= 0.001:
                return frame
            sw, sh = max(1, int(round(blk.size[0] * s))), max(1, int(round(blk.size[1] * s)))
            small = with_alpha(blk.resize((sw, sh), _RS.LANCZOS), k)
            paste(frame, small, (bx + (blk.size[0] - sw) / 2.0, by + (blk.size[1] - sh) / 2.0))
        else:
            paste(frame, blk, (bx, by))
        return frame

    def _beat_photo(self, i, t):
        b = self.beats[i]
        u = clamp01((t - b["start"]) / b["hold"])
        return self._crop(self.photos[i], kb_box(i % 3, u, 1.05))

    def beat_frame(self, i, t):
        b = self.beats[i]
        lt = t - b["start"]
        cur = self._beat_photo(i, t)
        if i > 0 and lt < XF_SEC:
            prev = self._beat_photo(i - 1, t)
            cur = Image.blend(prev, cur, ease(lt / XF_SEC))
        frame = ImageChops.multiply(cur, self.beat_shade)
        self._stamp_logo(frame)
        # 캡션
        delay = TEXT_IN_DELAY if i > 0 else 0.0
        a_in = ease((lt - delay) / TEXT_IN)
        out_end = b["hold"] - (XF_SEC if b["has_next"] else 0.0)
        a_out = 1.0 - ease((lt - (out_end - TEXT_OUT)) / TEXT_OUT)
        a = a_in * a_out
        if a > 0.002:
            bx, by = b["block_pos"]
            dy = SLIDE_PX * (1.0 - a_in)
            paste(frame, with_alpha(b["block"], a), (bx, by + dy))
        return frame

    def cta_frame(self, t):
        lt = t - self.cta_start
        k = ease(lt / CTA_FADE)
        frame = self.cta_bg if k >= 0.999 else Image.blend(self.last_frame, self.cta_bg, k)
        if k > 0.002:
            if k >= 0.999:
                frame = frame.copy()
            paste(frame, with_alpha(self.cta_overlay, k), (0, 0))
        elif frame is self.cta_bg:
            frame = frame.copy()
        fb = (lt - (CTA_SEC - BLACK_SEC)) / BLACK_SEC
        if fb > 0:
            frame = Image.blend(frame, self.black, clamp01(fb))
        return frame

    def frame(self, j):
        t = j / float(FPS)
        if t < HOOK_SEC:
            return self.hook_frame(t)
        if t < self.cta_start:
            i = 0
            for k, b in enumerate(self.beats):
                if t >= b["start"]:
                    i = k
            return self.beat_frame(i, t)
        return self.cta_frame(min(t, self.total - 1.0 / FPS))

    # ----- 비디오 인코드 -----------------------------------------------------
    def encode_video(self, out_path):
        cmd = ["ffmpeg", "-y", "-nostdin", "-v", "error", "-nostats",
               "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (W, H), "-r", str(FPS), "-i", "-",
               "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
               "-r", str(FPS), "-movflags", "+faststart", out_path]
        err_path = os.path.join(self.tmp, "ffmpeg_video.log")
        t0 = time.time()
        with open(err_path, "wb") as errf:
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errf)
            try:
                for j in range(self.n_frames):
                    proc.stdin.write(self.frame(j).tobytes())
                    if j % (FPS * 5) == 0 and j:
                        log("프레임 %d/%d (%.1fs)" % (j, self.n_frames, time.time() - t0))
            except BrokenPipeError:
                pass
            try:
                proc.stdin.close()
            except (BrokenPipeError, OSError):
                pass
            proc.wait()
        if proc.returncode != 0:
            try:
                with open(err_path, "r", encoding="utf-8", errors="replace") as f:
                    err = f.read().strip()
            except OSError:
                err = ""
            raise RenderError("비디오 인코드 실패: %s" % err[-400:])
        log("프레임 %d장 생성 %.1fs" % (self.n_frames, time.time() - t0))


# --------------------------------------------------------------------------- 오디오
def measure_loudness(bgm, loops, dur):
    af = ("aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:%.4f,asetpts=PTS-STARTPTS,"
          "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json" % dur)
    cmd = ["ffmpeg", "-nostdin", "-v", "info", "-nostats", "-stream_loop", str(loops), "-i", bgm,
           "-vn", "-af", af, "-t", "%.4f" % (dur + 0.5), "-f", "null", "-"]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    m = re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", p.stderr.decode("utf-8", "replace"), re.S)
    if not m:
        return None
    try:
        return json.loads(m[-1])
    except ValueError:
        return None


def mux_audio(video, bgm, dur, out_path, warnings):
    cmd = ["ffmpeg", "-y", "-nostdin", "-v", "error", "-nostats", "-i", video]
    if bgm:
        bdur = media_duration(bgm)
        if bdur <= 0.5:
            warnings.append("BGM 길이를 읽지 못해 무음으로 렌더합니다")
            bgm = None
    if bgm:
        loops = int(math.ceil(dur / bdur)) + 1
        meas = measure_loudness(bgm, loops, dur)
        ln = "loudnorm=I=-16:TP=-1.5:LRA=11"
        keys = ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")
        if meas and all(k in meas for k in keys):
            try:
                ln += ":measured_I=%s:measured_TP=%s:measured_LRA=%s:measured_thresh=%s:offset=%s:linear=true" % tuple(
                    float(meas[k]) for k in keys)
            except (TypeError, ValueError):
                warnings.append("loudnorm 측정값 파싱 실패 → 1-pass")
        else:
            warnings.append("loudnorm 측정 실패 → 1-pass")
        af = ("[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:%.4f,asetpts=PTS-STARTPTS,%s,"
              "aresample=44100,afade=t=in:st=0:d=0.6,afade=t=out:st=%.4f:d=1.2,atrim=0:%.4f[a]"
              % (dur, ln, max(0.0, dur - 1.2), dur))
        cmd += ["-stream_loop", str(loops), "-i", bgm, "-filter_complex", af, "-map", "0:v:0", "-map", "[a]"]
    else:
        warnings.append("BGM 없음 → 무음 트랙")
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-map", "0:v:0", "-map", "1:a"]
    cmd += ["-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-t", "%.4f" % dur,
            "-movflags", "+faststart", out_path]
    run(cmd)


def volume_detect(path):
    p = subprocess.run(["ffmpeg", "-nostdin", "-v", "info", "-nostats", "-i", path, "-vn", "-af", "volumedetect",
                        "-f", "null", "-"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    txt = p.stderr.decode("utf-8", "replace")
    out = {"mean_db": None, "max_db": None}
    m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", txt)
    if m:
        out["mean_db"] = float(m.group(1))
    m = re.search(r"max_volume:\s*(-?[\d.]+) dB", txt)
    if m:
        out["max_db"] = float(m.group(1))
    return out


# --------------------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description="세로 정보 릴스 렌더러")
    ap.add_argument("--plan", required=True)
    ap.add_argument("--assets", default="assets/video")
    ap.add_argument("--out", required=True)
    ap.add_argument("--font", default=None)
    ap.add_argument("--fast", action="store_true", help="리샘플을 HAMMING 으로(속도 우선)")
    args = ap.parse_args(argv)

    t_start = time.time()
    warnings = []
    os.makedirs(args.out, exist_ok=True)
    out_mp4 = os.path.join(args.out, "릴스.mp4")
    out_jpg = os.path.join(args.out, "릴스_썸네일.jpg")
    out_report = os.path.join(args.out, "report.json")

    def write_report(extra):
        rep = {"width": W, "height": H, "fps": FPS, "warnings": warnings, "render_time_sec": round(time.time() - t_start, 1)}
        rep.update(extra)
        with open(out_report, "w", encoding="utf-8") as f:
            json.dump(rep, f, ensure_ascii=False, indent=2)

    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        log("ffmpeg/ffprobe 가 PATH 에 없습니다")
        write_report({"error": "ffmpeg 없음"})
        return 1

    try:
        with open(args.plan, "r", encoding="utf-8") as f:
            plan = json.load(f)
    except Exception as e:  # noqa: BLE001
        log("플랜 JSON 을 읽지 못했습니다: %s" % e)
        write_report({"error": "plan: %s" % e})
        return 2

    tmp = tempfile.mkdtemp(prefix="reel_")
    try:
        try:
            font_path, font_idx = find_font(args.font, args.assets)
        except RenderError as e:
            log(str(e))
            write_report({"error": str(e)})
            return 1
        typo = Typo(font_path, font_idx)
        log("글꼴 %s" % os.path.basename(font_path))

        r = ReelRenderer(plan, args, tmp, warnings)
        r.parse()
        log("비트 %d개, 훅 '%s'" % (len(r.beats), r.hook_text.replace("\n", " / ")))
        r.load_photos()
        r.timeline()
        log("총 길이 %.2fs (%d프레임)" % (r.total, r.n_frames))
        r.prerender(typo, os.path.join(args.assets, "logo.png"))

        # 썸네일(훅 장면, 팝인 없이)
        r.hook_frame(0.0, pop=False).save(out_jpg, quality=92, optimize=True)

        video_only = os.path.join(tmp, "video.mp4")
        r.encode_video(video_only)

        bgm_path = None
        if r.bgm_src:
            try:
                bgm_path = resolve_src(r.bgm_src, r.plan_dir, r.dl)
            except Exception as e:  # noqa: BLE001
                warnings.append("BGM 을 읽지 못해 무음으로 렌더: %s" % e)
        log("오디오 합치는 중%s" % ("" if bgm_path else " (무음)"))
        mux_audio(video_only, bgm_path, r.total, out_mp4, warnings)

        info = ffprobe(out_mp4)
        vstream = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), {})
        dur = media_duration(out_mp4)
        audio = volume_detect(out_mp4) if bgm_path else {"mean_db": None, "max_db": None}
        beats_rep = [{"index": i + 1, "text": b["text"], "src": b.get("src"), "hold": b["hold"],
                      "start": round(b["start"], 3), "end": round(b["end"], 3), "font_px": b["px"], "lines": b["lines"]}
                     for i, b in enumerate(r.beats)]
        write_report({
            "ok": True,
            "duration_sec": round(dur, 3),
            "planned_duration_sec": round(r.total, 3),
            "width": int(vstream.get("width") or W),
            "height": int(vstream.get("height") or H),
            "codec": vstream.get("codec_name"),
            "hook": r.hook_text,
            "hook_start": 0.0,
            "cta_start": round(r.cta_start, 3),
            "beats": beats_rep,
            "audio": audio,
            "files": {"video": out_mp4, "thumbnail": out_jpg},
        })
        log("완료 %s (%.1fs, 총 %.1fs)" % (out_mp4, dur, time.time() - t_start))
        for w in warnings:
            log("주의: %s" % w)
        return 0
    except PlanError as e:
        log("플랜 문제: %s" % e)
        write_report({"error": str(e)})
        return 2
    except (RenderError, OSError) as e:
        log("렌더 실패: %s" % e)
        write_report({"error": str(e)})
        return 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
