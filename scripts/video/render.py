#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
프로이즘 시공 영상 렌더러 (standalone)

  python3 scripts/video/render.py --plan plan.json --assets assets/video --out outdir [--font PATH] [--vertical]

출력: outdir/영상.mp4 [영상_세로.mp4] contact_sheet.jpg [contact_sheet_세로.jpg] report.json
의존: Python 3.9+, Pillow, numpy, PATH 의 ffmpeg/ffprobe

구조
  - 슬라이드(타이틀 카드 / 사진 / 클립 / 연락처 카드)마다 워커 프로세스가 Pillow 로 프레임을 만들고
    자기 ffmpeg(libx264) 로 세그먼트 mp4 를 인코딩한다. 크로스페이드는 다음 슬라이드 워커가 이전 슬라이드의
    꼬리 프레임을 직접 다시 그려 Image.blend 로 섞는다(프레임 전송 없음, xfade 체인 없음).
  - 인트로/아웃트로도 같은 코덱 설정의 세그먼트로 재인코딩한 뒤 concat demuxer(-c copy) 로 이어 붙이고,
    마지막 패스에서 BGM(loudnorm 2-pass → volume → fade) 을 정확한 길이로 잘라 mux 한다.
"""
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
from multiprocessing import Pool, cpu_count

try:
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
except ImportError as e:  # pragma: no cover
    sys.stderr.write("필수 패키지가 없습니다 (pip install pillow numpy): %s\n" % e)
    sys.exit(1)

_RS = getattr(Image, "Resampling", Image)
FPS = 30
XF_SEC = 0.45
TITLE_SEC = 2.0
CONTACT_SEC = 3.0
TITLE_FADE_SEC = 0.4
CAPTION_SEC = 3.0
CAPTION_FADE_SEC = 0.3
CAPTION_DELAY_SEC = 0.2
BLUR_RATIO = 0.25
BLUR_FLOOR = 25.0
BGM_VOLUME = 0.6
RED = (236, 27, 48)
DEFAULT_CONTACT = [
    "상담 문의 010-7287-7140",
    "서울 서초구 서초중앙로8길 82 1동 1층 1호",
    "3M 프로이즘 강남서초점",
]
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansKR-Bold.ttf",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "/Library/Fonts/AppleSDGothicNeo.ttc",
]


class RenderError(Exception):
    pass


def log(msg):
    print(msg, flush=True)


# --------------------------------------------------------------------------- ffmpeg helpers
def run(cmd, timeout=None):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if p.returncode != 0:
        tail = p.stderr.decode("utf-8", "replace").strip().splitlines()[-12:]
        raise RenderError("ffmpeg 실패: %s\n%s" % (" ".join(cmd[:3]), "\n".join(tail)))
    return p


def ffprobe(path):
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if p.returncode != 0:
        return None
    try:
        return json.loads(p.stdout.decode("utf-8", "replace"))
    except ValueError:
        return None


def probe_summary(path):
    info = ffprobe(path)
    if not info:
        return None
    out = {"duration": float(info.get("format", {}).get("duration") or 0.0)}
    for s in info.get("streams", []):
        if s.get("codec_type") == "video" and "width" not in out:
            out["width"] = int(s.get("width") or 0)
            out["height"] = int(s.get("height") or 0)
            out["vcodec"] = s.get("codec_name")
            fr = s.get("avg_frame_rate") or s.get("r_frame_rate") or "0/1"
            try:
                a, b = fr.split("/")
                out["fps"] = round(float(a) / float(b), 3) if float(b) else 0.0
            except ValueError:
                out["fps"] = 0.0
            try:
                rot = int(s.get("tags", {}).get("rotate", 0))
            except (TypeError, ValueError):
                rot = 0
            for sd in s.get("side_data_list", []) or []:
                if "rotation" in sd:
                    try:
                        rot = int(round(float(sd["rotation"])))
                    except (TypeError, ValueError):
                        pass
            if rot % 180:
                out["width"], out["height"] = out["height"], out["width"]
            if not out["duration"] and s.get("duration"):
                out["duration"] = float(s["duration"])
        elif s.get("codec_type") == "audio" and "acodec" not in out:
            out["acodec"] = s.get("codec_name")
            out["sample_rate"] = int(s.get("sample_rate") or 0)
    return out


# --------------------------------------------------------------------------- download
def is_url(s):
    return isinstance(s, str) and re.match(r"^https?://", s, re.I) is not None


def safe_name(name, fallback="file"):
    name = os.path.basename(name or "").split("?")[0]
    name = re.sub(r"[^\w.\-가-힣]+", "_", name)
    return name or fallback


def download(url, dst_dir, name=None, retries=2):
    fname = safe_name(name or url, "download")
    dst = os.path.join(dst_dir, "%s_%s" % (hashlib.md5(url.encode("utf-8")).hexdigest()[:8], fname))
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


# --------------------------------------------------------------------------- font
def _has_korean(font):
    try:
        a = font.getmask("한")
        b = font.getmask("\U000E0001")  # 정의되지 않은 코드포인트 → .notdef
        if a.size != b.size:
            return True
        return bytes(a) != bytes(b)
    except Exception:  # noqa: BLE001
        return False


def _pick_face(path):
    """TTC 면 중 KR 글리프가 있는 index 선택 (NotoSansCJK: JP=0, KR=1 ...)."""
    best = None
    for idx in range(0, 12):
        try:
            f = ImageFont.truetype(path, 32, index=idx)
        except Exception:  # noqa: BLE001
            break
        try:
            fam, _sty = f.getname()
        except Exception:  # noqa: BLE001
            fam = ""
        if _has_korean(f):
            if "KR" in (fam or "").upper() or "KOREA" in (fam or "").upper():
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
        for fn in sorted(os.listdir(fdir)):
            if re.search(r"\.(ttf|otf|ttc)$", fn, re.I) and os.path.join(fdir, fn) not in cands:
                cands.append(os.path.join(fdir, fn))
    cands.extend(FONT_CANDIDATES)
    tried = []
    for p in cands:
        if not p or not os.path.isfile(p):
            continue
        idx = _pick_face(p)
        if idx is None:
            tried.append(p)
            continue
        return p, idx
    raise RenderError(
        "한글 글꼴을 찾지 못했습니다. --font 로 NotoSansKR-Bold.otf 경로를 주거나 assets/video/fonts/ 에 넣어 주세요"
        + (" (한글 글리프 없음: %s)" % ", ".join(tried) if tried else "")
    )


# --------------------------------------------------------------------------- image utils
def exif_open(path):
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)
    if im.mode != "RGB":
        im = im.convert("RGB")
    return im


def blur_score(path):
    """Laplacian 분산 (720px 다운스케일 그레이). 값이 클수록 선명."""
    im = Image.open(path)
    try:
        im.draft("L", (im.size[0] // 4, im.size[1] // 4))
    except Exception:  # noqa: BLE001
        pass
    im = ImageOps.exif_transpose(im).convert("L")
    w, h = im.size
    s = 720.0 / max(w, h)
    if s < 1:
        im = im.resize((max(8, int(w * s)), max(8, int(h * s))), _RS.BOX)
    a = np.asarray(im, dtype=np.float32)
    lap = 4 * a[1:-1, 1:-1] - a[:-2, 1:-1] - a[2:, 1:-1] - a[1:-1, :-2] - a[1:-1, 2:]
    return float(lap.var())


def center_crop(im, aspect):
    w, h = im.size
    if w / h > aspect:
        nw = int(round(h * aspect))
        x0 = (w - nw) // 2
        return im.crop((x0, 0, x0 + nw, h))
    nh = int(round(w / aspect))
    y0 = (h - nh) // 2
    return im.crop((0, y0, w, y0 + nh))


def prepare_photo(path, sw, sh):
    """EXIF 회전 → 약한 자동 대비 → 중앙 크롭 → 소스 크기(sw×sh) 로 리사이즈."""
    im = exif_open(path)
    try:
        ac = ImageOps.autocontrast(im, cutoff=0.5, preserve_tone=True)
    except TypeError:
        ac = ImageOps.autocontrast(im, cutoff=0.5)
    im = Image.blend(im, ac, 0.7)
    im = center_crop(im, sw / sh)
    if im.size != (sw, sh):
        im = im.resize((sw, sh), _RS.LANCZOS if im.size[0] >= sw else _RS.BICUBIC)
    return im


def make_logo(path, width):
    """흰 배경 투명화 + 바운딩 박스 트림 + 리사이즈 + 드롭섀도 → RGBA 스탬프."""
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    minc = a[..., :3].min(axis=2)
    alpha = a[..., 3]
    soft = np.clip((245.0 - minc) / 30.0, 0.0, 1.0)  # 245 이상 흰색 → 0, 215 이하 → 1
    alpha = alpha * soft
    a[..., 3] = alpha
    im = Image.fromarray(a.astype(np.uint8), "RGBA")
    bbox = Image.fromarray((alpha > 8).astype(np.uint8) * 255, "L").getbbox()
    if bbox:
        im = im.crop(bbox)
    w, h = im.size
    nh = max(1, int(round(h * width / float(w))))
    im = im.resize((width, nh), _RS.LANCZOS)
    pad = max(6, width // 14)
    off = max(2, width // 50)
    canvas = Image.new("RGBA", (width + pad * 2, nh + pad * 2), (0, 0, 0, 0))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sh_alpha = Image.new("L", canvas.size, 0)
    sh_alpha.paste(im.split()[3], (pad, pad + off))
    sh_alpha = sh_alpha.filter(ImageFilter.GaussianBlur(max(2, width / 36.0)))
    sh_alpha = sh_alpha.point(lambda v: int(v * 0.55))
    shadow.putalpha(sh_alpha)
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.alpha_composite(im, (pad, pad))
    return canvas, pad


def paste_rgba(frame, rgba, pos):
    frame.paste(rgba, pos, rgba)


def text_wh(font, text):
    l, t, r, b = font.getbbox(text)
    return r - l, b - t


def wrap_text(text, font, max_w, max_lines=3):
    words = text.split()
    if len(words) <= 1:
        units = list(text)
        joiner = ""
    else:
        units = words
        joiner = " "
    lines, cur = [], ""
    for u in units:
        cand = (cur + joiner + u) if cur else u
        if text_wh(font, cand)[0] <= max_w or not cur:
            cur = cand
        else:
            lines.append(cur)
            cur = u
    if cur:
        lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and text_wh(font, last + "…")[0] > max_w:
            last = last[:-1]
        lines[-1] = last + "…"
    return lines


def fit_text(font_loader, text, max_px, min_px, max_w, max_lines=2):
    """한 줄로 들어가는 최대 크기 탐색 → 안 되면 min_px 에서 줄바꿈."""
    px = max_px
    while px >= min_px:
        f = font_loader(px)
        if text_wh(f, text)[0] <= max_w:
            return f, [text]
        px -= 2
    f = font_loader(min_px)
    return f, wrap_text(text, f, max_w, max_lines)


def draw_text_shadow(draw, xy, text, font, fill, shadow=(0, 0, 0, 110), off=2):
    x, y = xy
    draw.text((x + off, y + off), text, font=font, fill=shadow)
    draw.text((x, y), text, font=font, fill=fill)


def ease(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3.0 - 2.0 * t)


# --------------------------------------------------------------------------- worker
_CFG = None
_CACHE = {}
_LOGO = None
_FONTS = {}


def _font(px):
    px = int(round(px))
    f = _FONTS.get(px)
    if f is None:
        f = ImageFont.truetype(_CFG["font_path"], px, index=_CFG["font_index"])
        _FONTS[px] = f
    return f


def _init_worker(cfg):
    global _CFG, _LOGO
    _CFG = cfg
    _CACHE.clear()
    _FONTS.clear()
    if cfg.get("logo_path"):
        try:
            _LOGO = make_logo(cfg["logo_path"], cfg["logo_w"])
        except Exception:  # noqa: BLE001
            _LOGO = None
    else:
        _LOGO = None


def _cache_get(key, builder, keep=4):
    if key in _CACHE:
        return _CACHE[key]
    val = builder()
    if len(_CACHE) >= keep:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[key] = val
    return val


def _apply_logo(frame):
    if _LOGO is None:
        return
    stamp, pad = _LOGO
    W = _CFG["W"]
    m = _CFG["margin"]
    paste_rgba(frame, stamp, (W - m - stamp.size[0] + pad, m - pad))


def _caption_overlay(idx):
    """챕터 캡션 바(RGB, alpha, pos) — 슬라이드당 1회 생성."""
    def build():
        sl = _CFG["slides"][idx]
        text = sl["caption"]
        W, H = _CFG["W"], _CFG["H"]
        m = _CFG["margin"]
        s = _CFG["s"]
        bar_w = W - 2 * m
        bar_h = _CFG["bar_h"]
        pad_x = int(round(44 * s))
        accent_w = int(round(8 * s))
        max_w = bar_w - 2 * pad_x - accent_w - int(round(20 * s))
        font, lines = fit_text(_font, text, _CFG["cap_max"], _CFG["cap_min"], max_w, max_lines=2)
        lh = int(round(font.size * 1.25))
        need = lh * len(lines) + int(round(44 * s))
        if need > bar_h:
            bar_h = need
        rgba = Image.new("RGBA", (bar_w, bar_h), (0, 0, 0, 0))
        d = ImageDraw.Draw(rgba)
        r = int(round(18 * s))
        d.rounded_rectangle((0, 0, bar_w - 1, bar_h - 1), radius=r, fill=(0, 0, 0, 178))
        d.rounded_rectangle((pad_x - accent_w - int(round(20 * s)), int(round(28 * s)), pad_x - int(round(20 * s)), bar_h - int(round(28 * s))),
                            radius=accent_w // 2, fill=RED + (255,))
        total_h = lh * len(lines)
        y = (bar_h - total_h) // 2
        for ln in lines:
            l, t, _r, _b = font.getbbox(ln)
            d.text((pad_x - l, y - t + (lh - (_b - t)) // 2), ln, font=font, fill=(255, 255, 255, 255))
            y += lh
        rgb = rgba.convert("RGB")
        alpha = rgba.split()[3]
        pos = (m, H - m - bar_h)
        return rgb, alpha, pos
    return _cache_get(("cap", idx), build)


def _apply_caption(frame, idx, j):
    sl = _CFG["slides"][idx]
    if not sl.get("caption"):
        return
    c0, c1, cf = sl["cap_start"], sl["cap_end"], sl["cap_fade"]
    if j < c0 or j >= c1:
        return
    f = 1.0
    if j < c0 + cf:
        f = (j - c0 + 1) / float(cf + 1)
    elif j >= c1 - cf:
        f = (c1 - j) / float(cf + 1)
    rgb, alpha, pos = _caption_overlay(idx)
    if f >= 0.999:
        frame.paste(rgb, pos, alpha)
    else:
        lut = [int(v * f) for v in range(256)]
        frame.paste(rgb, pos, alpha.point(lut))


def _photo_source(idx):
    sl = _CFG["slides"][idx]
    return _cache_get(("src", idx), lambda: prepare_photo(sl["path"], _CFG["SW"], _CFG["SH"]))


def _kb_box(idx, j):
    """켄 번스: 패턴별 줌/팬 박스 (소스 좌표, float)."""
    sl = _CFG["slides"][idx]
    n = sl["n"]
    SW, SH = _CFG["SW"], _CFG["SH"]
    t = ease(j / float(max(1, n - 1)))
    pat = sl["pattern"] % 4
    zmax = 1.06
    px = py = 0.0
    if pat == 0:
        z = 1.0 + (zmax - 1.0) * t
    elif pat == 1:
        z = 1.05
        px = -1.0 + 2.0 * t
        py = -0.3 + 0.6 * t
    elif pat == 2:
        z = zmax - (zmax - 1.0) * t
    else:
        z = 1.05
        px = 1.0 - 2.0 * t
        py = 0.3 - 0.6 * t
    cw, ch = SW / z, SH / z
    cx = SW / 2.0 + px * (SW - cw) / 2.0
    cy = SH / 2.0 + py * (SH - ch) / 2.0
    return (cx - cw / 2.0, cy - ch / 2.0, cx + cw / 2.0, cy + ch / 2.0)


def _blurred_bg(hero_path):
    W, H = _CFG["W"], _CFG["H"]
    if not hero_path:
        return Image.new("RGB", (W, H), (20, 20, 22))
    try:
        im = prepare_photo(hero_path, _CFG["SW"], _CFG["SH"])
    except Exception:  # noqa: BLE001
        return Image.new("RGB", (W, H), (20, 20, 22))
    small = im.resize((W // 4, H // 4), _RS.BILINEAR)
    small = small.filter(ImageFilter.GaussianBlur(25 / 4.0))
    bg = small.resize((W, H), _RS.BICUBIC)
    bg = Image.eval(bg, lambda v: int(v * 0.55))
    return bg


def _card(idx):
    def build():
        sl = _CFG["slides"][idx]
        W, H = _CFG["W"], _CFG["H"]
        s = _CFG["s"]
        bg = _blurred_bg(sl.get("hero"))
        _apply_logo(bg)
        d = ImageDraw.Draw(bg, "RGBA")
        max_w = int(W * 0.86)
        if sl["kind"] == "title":
            title = sl.get("title") or ""
            sub = sl.get("subtitle") or ""
            blocks = []
            if title:
                f, lines = fit_text(_font, title, 76 * s, 52 * s, max_w, max_lines=2)
                blocks.append((f, lines, (255, 255, 255, 255), int(round(f.size * 1.22))))
            if sub:
                f2, lines2 = fit_text(_font, sub, 40 * s, 30 * s, max_w, max_lines=2)
                blocks.append((f2, lines2, (255, 255, 255, 217), int(round(f2.size * 1.3))))
            gap = int(round(22 * s))
            accent_h = int(round(6 * s)) if blocks else 0
            total = accent_h + gap + sum(lh * len(ls) for _f, ls, _c, lh in blocks) + gap * (len(blocks) - 1)
            y = (H - total) // 2
            if blocks:
                aw = int(round(72 * s))
                d.rounded_rectangle(((W - aw) // 2, y, (W + aw) // 2, y + accent_h), radius=accent_h // 2, fill=RED + (255,))
            y += accent_h + gap
            for f, lines, col, lh in blocks:
                for ln in lines:
                    l, t, r, b = f.getbbox(ln)
                    x = (W - (r - l)) // 2 - l
                    draw_text_shadow(d, (x, y - t + (lh - (b - t)) // 2), ln, f, col, off=max(2, int(3 * s)))
                    y += lh
                y += gap
        else:
            lines_in = sl.get("contact") or []
            blocks = []
            for i, ln in enumerate(lines_in):
                px = (64 if i == 0 else 40) * s
                f, ls = fit_text(_font, ln, px, px * 0.7, max_w, max_lines=2)
                col = (255, 255, 255, 255) if i == 0 else (255, 255, 255, 217)
                blocks.append((f, ls, col, int(round(f.size * 1.3))))
            gap = int(round(14 * s))
            div_h = int(round(4 * s))
            total = sum(lh * len(ls) for _f, ls, _c, lh in blocks) + gap * max(0, len(blocks) - 1)
            if len(blocks) > 1:
                total += div_h + gap * 2
            y = (H - total) // 2
            for bi, (f, lines, col, lh) in enumerate(blocks):
                for ln in lines:
                    l, t, r, b = f.getbbox(ln)
                    x = (W - (r - l)) // 2 - l
                    draw_text_shadow(d, (x, y - t + (lh - (b - t)) // 2), ln, f, col, off=max(2, int(3 * s)))
                    y += lh
                y += gap
                if bi == 0 and len(blocks) > 1:
                    dw = int(round(120 * s))
                    y += gap
                    d.rounded_rectangle(((W - dw) // 2, y, (W + dw) // 2, y + div_h), radius=div_h // 2, fill=RED + (255,))
                    y += div_h + gap
        return bg
    return _cache_get(("card", idx), build)


class ClipReader:
    """ffmpeg 로 클립을 디코드해 WxH rgb24 프레임을 순서대로 읽는다(무음, 채움 크롭, 30fps)."""

    def __init__(self, path, start_sec, W, H):
        vf = "scale=%d:%d:force_original_aspect_ratio=increase:flags=bicubic,crop=%d:%d,fps=%d,format=rgb24" % (W, H, W, H, FPS)
        cmd = ["ffmpeg", "-nostdin", "-v", "error", "-nostats"]
        if start_sec > 0:
            cmd += ["-ss", "%.4f" % start_sec]
        cmd += ["-i", path, "-an", "-sn", "-vf", vf, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
        self.p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.W, self.H = W, H
        self.size = W * H * 3
        self.last = None

    def read(self):
        buf = b""
        while len(buf) < self.size:
            chunk = self.p.stdout.read(self.size - len(buf))
            if not chunk:
                break
            buf += chunk
        if len(buf) < self.size:
            if self.last is None:
                return Image.new("RGB", (self.W, self.H), (0, 0, 0))
            return self.last.copy()
        self.last = Image.frombytes("RGB", (self.W, self.H), buf)
        return self.last.copy()

    def close(self):
        try:
            self.p.stdout.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            self.p.terminate()
            self.p.wait(timeout=5)
        except Exception:  # noqa: BLE001
            pass


def _frames(idx, j0, j1):
    """슬라이드 idx 의 프레임 j0..j1-1 을 순서대로 생성."""
    sl = _CFG["slides"][idx]
    kind = sl["kind"]
    W, H = _CFG["W"], _CFG["H"]
    if j1 <= j0:
        return
    if kind == "photo":
        src = _photo_source(idx)
        rs = _RS.HAMMING if _CFG.get("fast") else _RS.BICUBIC
        for j in range(j0, j1):
            fr = src.resize((W, H), rs, box=_kb_box(idx, j))
            _apply_logo(fr)
            _apply_caption(fr, idx, j)
            yield fr
    elif kind in ("clip", "intro", "outro"):
        start = sl.get("trim_start", 0.0) + j0 / float(FPS)
        rd = ClipReader(sl["path"], start, W, H)
        try:
            for j in range(j0, j1):
                fr = rd.read()
                if kind == "clip":
                    _apply_logo(fr)
                    _apply_caption(fr, idx, j)
                yield fr
        finally:
            rd.close()
    else:  # title / contact
        card = _card(idx)
        for _j in range(j0, j1):
            yield card.copy()


def _encode_cmd(out_path):
    W, H = _CFG["W"], _CFG["H"]
    return [
        "ffmpeg", "-y", "-nostdin", "-v", "error", "-nostats",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (W, H), "-r", str(FPS), "-i", "-",
        "-an",
        "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-profile:v", "high", "-level", "4.1",
        "-threads", str(_CFG["x264_threads"]),
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-movflags", "+faststart",
        out_path,
    ]


def render_segment(idx):
    """슬라이드 idx 의 세그먼트 mp4 생성. 반환 (idx, path, frames, seconds, error)."""
    t0 = time.time()
    sl = _CFG["slides"][idx]
    out_path = os.path.join(_CFG["tmp"], "seg_%03d.mp4" % idx)
    err_path = out_path + ".log"
    n = sl["n"]
    tail = sl["tail"]
    xf_in = sl["xf_in"]
    fade_in = sl["fade_in"]
    own_count = n - tail
    prev_iter = None
    base = None
    try:
        if idx > 0 and xf_in > 0:
            pn = _CFG["slides"][idx - 1]["n"]
            prev_iter = _frames(idx - 1, pn - xf_in, pn)
        if idx > 0 and fade_in > 0:
            pn = _CFG["slides"][idx - 1]["n"]
            for fr in _frames(idx - 1, pn - 1, pn):
                base = fr
        elif fade_in > 0:
            base = Image.new("RGB", (_CFG["W"], _CFG["H"]), (0, 0, 0))
        with open(err_path, "wb") as errf:
            enc = subprocess.Popen(_encode_cmd(out_path), stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errf)
            written = 0
            try:
                for j, fr in enumerate(_frames(idx, 0, own_count)):
                    if prev_iter is not None and j < xf_in:
                        pf = next(prev_iter)
                        fr = Image.blend(pf, fr, (j + 1) / float(xf_in + 1))
                    if base is not None and j < fade_in:
                        fr = Image.blend(base, fr, (j + 1) / float(fade_in + 1))
                    enc.stdin.write(fr.tobytes())
                    written += 1
            finally:
                try:
                    enc.stdin.close()
                except Exception:  # noqa: BLE001
                    pass
                rc = enc.wait()
        if rc != 0:
            with open(err_path, "rb") as f:
                msg = f.read().decode("utf-8", "replace").strip()[-800:]
            return (idx, out_path, written, time.time() - t0, "세그먼트 인코딩 실패(%d): %s" % (rc, msg))
        return (idx, out_path, written, time.time() - t0, None)
    except Exception as e:  # noqa: BLE001
        import traceback
        return (idx, out_path, 0, time.time() - t0, "%s\n%s" % (e, traceback.format_exc()[-1200:]))
    finally:
        if prev_iter is not None:
            try:
                prev_iter.close()
            except Exception:  # noqa: BLE001
                pass


# --------------------------------------------------------------------------- plan → slides
def variant_config(vertical):
    if vertical:
        W, H, s = 1080, 1920, 0.85
        return dict(W=W, H=H, s=s, SW=1152, SH=2048, logo_w=120, margin=30, bar_h=120,
                    cap_max=int(round(48 * s)), cap_min=int(round(30 * s)))
    W, H, s = 1920, 1080, 1.0
    return dict(W=W, H=H, s=s, SW=2048, SH=1152, logo_w=172, margin=36, bar_h=140, cap_max=48, cap_min=30)


def build_slides(items, plan, intro, outro, vertical):
    """items: 사용 가능한 사진/클립 (path 포함). 반환 (slides, total_frames)."""
    xf = int(round(XF_SEC * FPS))
    slides = []
    if intro:
        n = max(1, int(round(intro["duration"] * FPS)))
        slides.append(dict(kind="intro", path=intro["path"], n=n, xf_in=0, fade_in=0, name="intro"))
    heroes = [it for it in items if it.get("role") == "hero" and it["kind"] == "photo"]
    photos = [it for it in items if it["kind"] == "photo"]
    hero_first = (heroes[0] if heroes else (photos[0] if photos else None))
    hero_last = (heroes[-1] if heroes else (photos[-1] if photos else None))
    slides.append(dict(kind="title", n=int(round(TITLE_SEC * FPS)), xf_in=0,
                       fade_in=int(round(TITLE_FADE_SEC * FPS)),
                       title=plan.get("title") or "", subtitle=plan.get("subtitle") or "",
                       hero=hero_first["path"] if hero_first else None, name="title"))
    pat = 0
    for it in items:
        if it["kind"] == "photo":
            n = int(round(it["hold"] * FPS))
            slides.append(dict(kind="photo", path=it["path"], n=n, xf_in=xf, fade_in=0, pattern=pat,
                               caption=it.get("chapter"), name=it["name"]))
            pat += 1
        else:
            n = int(round(it["clip_dur"] * FPS))
            slides.append(dict(kind="clip", path=it["path"], n=n, xf_in=xf, fade_in=0,
                               trim_start=it["trim_start"], caption=it.get("chapter"), name=it["name"]))
    slides.append(dict(kind="contact", n=int(round(CONTACT_SEC * FPS)), xf_in=xf, fade_in=0,
                       contact=plan.get("contact") or DEFAULT_CONTACT,
                       hero=hero_last["path"] if hero_last else None, name="contact"))
    if outro:
        n = max(1, int(round(outro["duration"] * FPS)))
        slides.append(dict(kind="outro", path=outro["path"], n=n, xf_in=0, fade_in=0, name="outro"))

    # 최소 길이 보장: 겹침(들어오는 xf + 나가는 xf) 보다 길어야 함
    for i, sl in enumerate(slides):
        nxt = slides[i + 1]["xf_in"] if i + 1 < len(slides) else 0
        sl["tail"] = nxt
        need = sl["xf_in"] + nxt + 6
        if sl["n"] < need:
            sl["n"] = need
    cap_fade = int(round(CAPTION_FADE_SEC * FPS))
    pos = 0
    for i, sl in enumerate(slides):
        sl["pos"] = pos
        seg = sl["n"] - sl["tail"]
        sl["seg"] = seg
        pos += seg
        if sl.get("caption"):
            c0 = int(round(CAPTION_DELAY_SEC * FPS))
            c1 = min(c0 + int(round(CAPTION_SEC * FPS)), sl["n"] - 2)
            if c1 - c0 < cap_fade * 2 + 6:
                c0 = 0
                c1 = min(int(round(CAPTION_SEC * FPS)), sl["n"] - 2)
            sl["cap_start"], sl["cap_end"], sl["cap_fade"] = c0, c1, min(cap_fade, max(1, (c1 - c0) // 3))
    return slides, pos


# --------------------------------------------------------------------------- audio / post
def measure_loudness(bgm, loops, dur):
    af = "aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:%.4f,asetpts=PTS-STARTPTS,loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json" % dur
    cmd = ["ffmpeg", "-nostdin", "-v", "info", "-nostats", "-stream_loop", str(loops), "-i", bgm, "-vn", "-af", af, "-t", "%.4f" % (dur + 0.5), "-f", "null", "-"]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    txt = p.stderr.decode("utf-8", "replace")
    m = re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", txt, re.S)
    if not m:
        return None
    try:
        return json.loads(m[-1])
    except ValueError:
        return None


def mux_final(concat_list, bgm, dur, out_path, warnings):
    cmd = ["ffmpeg", "-y", "-nostdin", "-v", "error", "-nostats", "-f", "concat", "-safe", "0", "-i", concat_list]
    if bgm:
        info = probe_summary(bgm["path"])
        bdur = (info or {}).get("duration") or 0.0
        if bdur <= 0.5:
            warnings.append("BGM 길이를 읽지 못해 무음으로 렌더합니다: %s" % bgm["name"])
            bgm = None
    if bgm:
        loops = int(math.ceil(dur / bdur)) + 1
        meas = measure_loudness(bgm["path"], loops, dur)
        ln = "loudnorm=I=-18:TP=-1.5:LRA=11"
        if meas and all(k in meas for k in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")):
            try:
                ln += ":measured_I=%s:measured_TP=%s:measured_LRA=%s:measured_thresh=%s:offset=%s:linear=true" % (
                    float(meas["input_i"]), float(meas["input_tp"]), float(meas["input_lra"]),
                    float(meas["input_thresh"]), float(meas["target_offset"]))
            except (TypeError, ValueError):
                warnings.append("loudnorm 측정값 파싱 실패 → 1-pass 로 진행")
        else:
            warnings.append("loudnorm 측정 실패 → 1-pass 로 진행")
        af = ("[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:%.4f,asetpts=PTS-STARTPTS,%s,"
              "aresample=44100,volume=%.3f,afade=t=in:st=0:d=1.0,afade=t=out:st=%.4f:d=2.0[a]"
              % (dur, ln, BGM_VOLUME, max(0.0, dur - 2.0)))
        cmd += ["-stream_loop", str(loops), "-i", bgm["path"], "-filter_complex", af, "-map", "0:v:0", "-map", "[a]"]
    else:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-map", "0:v:0", "-map", "1:a"]
    cmd += ["-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-t", "%.4f" % dur,
            "-movflags", "+faststart", out_path]
    run(cmd)


def volume_detect(path):
    p = subprocess.run(["ffmpeg", "-nostdin", "-v", "info", "-nostats", "-i", path, "-vn", "-af", "volumedetect", "-f", "null", "-"],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    txt = p.stderr.decode("utf-8", "replace")
    out = {}
    m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", txt)
    if m:
        out["mean_db"] = float(m.group(1))
    m = re.search(r"max_volume:\s*(-?[\d.]+) dB", txt)
    if m:
        out["max_db"] = float(m.group(1))
    return out


def contact_sheet(video, dur, out_jpg, tmp, font_path, font_index, vertical):
    cols, rows = 4, 4
    tw, th = (270, 480) if vertical else (480, 270)
    d = os.path.join(tmp, "cs_v" if vertical else "cs_h")
    os.makedirs(d, exist_ok=True)
    n = cols * rows
    step = dur / n
    files = []
    for i in range(n):
        t = min(step / 2 + i * step, max(0.0, dur - 0.05))
        fn = os.path.join(d, "f_%02d.png" % i)
        run(["ffmpeg", "-y", "-nostdin", "-v", "error", "-nostats", "-ss", "%.4f" % t, "-i", video,
             "-vf", "scale=%d:%d" % (tw, th), "-frames:v", "1", fn])
        if os.path.isfile(fn):
            files.append("f_%02d.png" % i)
    sheet = Image.new("RGB", (cols * tw, rows * th), (16, 16, 16))
    try:
        font = ImageFont.truetype(font_path, 20, index=font_index)
    except Exception:  # noqa: BLE001
        font = None
    for i, fn in enumerate(files[:n]):
        im = Image.open(os.path.join(d, fn)).convert("RGB")
        t = step / 2 + i * step
        dr = ImageDraw.Draw(im, "RGBA")
        label = "%02d:%04.1f" % (int(t // 60), t % 60)
        dr.rectangle((0, 0, 92, 26), fill=(0, 0, 0, 160))
        dr.text((6, 3), label, font=font, fill=(255, 255, 0, 255))
        sheet.paste(im, ((i % cols) * tw, (i // cols) * th))
    sheet.save(out_jpg, quality=86)


# --------------------------------------------------------------------------- main pipeline
def resolve_src(src, plan_dir, tmp_dl, name):
    if is_url(src):
        return download(src, tmp_dl, name)
    p = os.path.expanduser(src)
    if not os.path.isabs(p):
        p = os.path.join(plan_dir, p)
    if not os.path.isfile(p):
        raise RenderError("파일 없음: %s" % src)
    return p


def collect_items(plan, plan_dir, tmp_dl, warnings, excluded):
    items = []
    for i, ph in enumerate(plan.get("photos") or []):
        if not isinstance(ph, dict):
            continue
        src = ph.get("src") or ph.get("url") or ph.get("path")
        name = ph.get("name") or safe_name(src or "", "photo%02d" % (i + 1))
        kind = (ph.get("kind") or "photo").lower()
        if kind not in ("photo", "video"):
            kind = "video" if re.search(r"\.(mp4|mov|m4v|webm|mkv)$", name, re.I) else "photo"
        if not src:
            warnings.append("src 없음: %s" % name)
            excluded.append({"name": name, "reason": "경로 없음"})
            continue
        try:
            path = resolve_src(src, plan_dir, tmp_dl, name)
        except RenderError as e:
            warnings.append(str(e))
            excluded.append({"name": name, "reason": "불러오기 실패"})
            continue
        role = ph.get("role")
        it = dict(name=name, path=path, role=role, chapter=ph.get("chapter") or None, kind="photo")
        if kind == "video":
            info = probe_summary(path)
            if not info or not info.get("vcodec"):
                warnings.append("클립을 읽을 수 없어 건너뜀: %s" % name)
                excluded.append({"name": name, "reason": "클립 읽기 실패"})
                continue
            cdur = info.get("duration") or 0.0
            trim = ph.get("trim")
            if isinstance(trim, (list, tuple)) and len(trim) == 2:
                a, b = float(trim[0]), float(trim[1])
            else:
                a, b = 0.0, min(6.0, cdur if cdur > 0 else 6.0)
            a = max(0.0, a)
            if cdur > 0:
                b = min(b, cdur)
            if b - a < 1.0:
                a, b = 0.0, min(max(1.0, b), cdur if cdur > 0 else max(1.0, b))
            it.update(kind="clip", trim_start=a, clip_dur=max(1.0, b - a))
        else:
            try:
                Image.open(path).close()
            except Exception:  # noqa: BLE001
                warnings.append("사진을 열 수 없어 건너뜀: %s" % name)
                excluded.append({"name": name, "reason": "사진 읽기 실패"})
                continue
            hold = ph.get("hold")
            if hold is None:
                hold = {"hero": 2.6, "detail": 1.6}.get(role or "", 2.0)
            try:
                hold = float(hold)
            except (TypeError, ValueError):
                hold = 2.0
            it["hold"] = min(10.0, max(1.0, hold))
        items.append(it)
    return items


def auto_blur_filter(items, excluded, warnings):
    scores = []
    for it in items:
        if it["kind"] != "photo":
            continue
        try:
            it["blur"] = blur_score(it["path"])
            scores.append(it["blur"])
        except Exception as e:  # noqa: BLE001
            warnings.append("선명도 계산 실패(%s): %s" % (it["name"], e))
    if len(scores) < 4:
        return items
    med = float(np.median(scores))
    keep = []
    for it in items:
        sc = it.get("blur")
        if sc is not None and sc < BLUR_RATIO * med and sc < BLUR_FLOOR:
            excluded.append({"name": it["name"], "reason": "흐림(자동 감지)", "score": round(sc, 1)})
            continue
        keep.append(it)
    return keep


def render_variant(plan, items, assets, font, tmp, out_mp4, vertical, workers, fast, warnings, bgm):
    cfg = variant_config(vertical)
    intro = outro = None
    for key in ("intro", "outro"):
        p = os.path.join(assets, key + ".mp4")
        info = probe_summary(p) if os.path.isfile(p) else None
        if info and info.get("vcodec") and info.get("duration", 0) > 0:
            d = dict(path=p, duration=info["duration"])
            if key == "intro":
                intro = d
            else:
                outro = d
        else:
            warnings.append("%s.mp4 없음 → 건너뜀" % key)
    slides, total_frames = build_slides(items, plan, intro, outro, vertical)
    vt = os.path.join(tmp, "v" if vertical else "h")
    os.makedirs(vt, exist_ok=True)
    cfg.update(
        slides=slides, tmp=vt, fast=fast,
        font_path=font[0], font_index=font[1],
        logo_path=os.path.join(assets, "logo.png") if os.path.isfile(os.path.join(assets, "logo.png")) else None,
        x264_threads=max(2, int(math.ceil(1.5 * cpu_count() / max(1, workers)))),
    )
    if not cfg["logo_path"]:
        warnings.append("logo.png 없음 → 로고 생략")
    label = "세로" if vertical else "가로"
    log("%s 렌더 시작: 슬라이드 %d개, %d프레임(%.1f초), 워커 %d" % (label, len(slides), total_frames, total_frames / FPS, workers))
    t0 = time.time()
    order = sorted(range(len(slides)), key=lambda i: -slides[i]["n"])  # 긴 것부터
    results = {}
    if workers > 1:
        with Pool(workers, initializer=_init_worker, initargs=(cfg,)) as pool:
            for idx, path, nfr, secs, err in pool.imap_unordered(render_segment, order):
                if err:
                    pool.terminate()
                    raise RenderError("슬라이드 %d(%s) 실패: %s" % (idx, slides[idx].get("name"), err))
                results[idx] = (path, nfr)
    else:
        _init_worker(cfg)
        for idx in order:
            _, path, nfr, secs, err = render_segment(idx)
            if err:
                raise RenderError("슬라이드 %d(%s) 실패: %s" % (idx, slides[idx].get("name"), err))
            results[idx] = (path, nfr)
    got = 0
    for i, sl in enumerate(slides):
        path, nfr = results[i]
        if nfr != sl["seg"]:
            warnings.append("세그먼트 %d 프레임 수 불일치 %d≠%d" % (i, nfr, sl["seg"]))
        got += nfr
    log("%s 세그먼트 완료 %.1f초 (%d프레임)" % (label, time.time() - t0, got))
    lst = os.path.join(vt, "concat.txt")
    with open(lst, "w", encoding="utf-8") as f:
        for i in range(len(slides)):
            f.write("file '%s'\n" % results[i][0].replace("'", "'\\''"))
            f.write("duration %.6f\n" % (results[i][1] / float(FPS)))  # 이음새 타임스탬프를 정확히 1/30 배수로
    dur = got / float(FPS)
    mux_final(lst, bgm, dur, out_mp4, warnings)
    info = probe_summary(out_mp4)
    if not info:
        raise RenderError("출력 파일 확인 실패: %s" % out_mp4)
    chapters = []
    for sl in slides:
        if sl.get("caption"):
            t = sl["pos"] / float(FPS)
            chapters.append({"text": sl["caption"], "start_sec": round(t, 2), "time": "%02d:%02d" % (int(t // 60), int(t % 60)), "photo": sl.get("name")})
    return dict(
        file=out_mp4, duration_sec=round(info["duration"], 3), width=info.get("width"), height=info.get("height"),
        fps=info.get("fps"), vcodec=info.get("vcodec"), acodec=info.get("acodec"),
        planned_duration_sec=round(dur, 3), frames=got, chapters=chapters,
        render_sec=round(time.time() - t0, 1),
        intro_sec=round(intro["duration"], 3) if intro else 0.0, outro_sec=round(outro["duration"], 3) if outro else 0.0,
        slides=[{"kind": s["kind"], "name": s.get("name"), "sec": round(s["n"] / FPS, 2), "start_sec": round(s["pos"] / FPS, 2)} for s in slides],
    )


def main(argv=None):
    ap = argparse.ArgumentParser(description="프로이즘 시공 영상 렌더러")
    ap.add_argument("--plan", required=True)
    ap.add_argument("--assets", default="assets/video")
    ap.add_argument("--out", required=True)
    ap.add_argument("--font", default=None)
    ap.add_argument("--vertical", action="store_true", help="세로(9:16) 버전도 렌더")
    ap.add_argument("--workers", type=int, default=0, help="워커 프로세스 수(기본: CPU 수, 최대 6)")
    ap.add_argument("--fast", action="store_true", help="리샘플 HAMMING (조금 빠름)")
    ap.add_argument("--keep-temp", action="store_true")
    args = ap.parse_args(argv)

    t_start = time.time()
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            log("오류: %s 가 PATH 에 없습니다" % tool)
            return 1
    try:
        with open(args.plan, "r", encoding="utf-8") as f:
            plan = json.load(f)
    except Exception as e:  # noqa: BLE001
        log("오류: plan.json 을 읽을 수 없습니다: %s" % e)
        return 2
    if not isinstance(plan, dict):
        log("오류: plan.json 최상위는 객체여야 합니다")
        return 2
    plan_dir = os.path.dirname(os.path.abspath(args.plan))
    assets = os.path.abspath(args.assets)
    outdir = os.path.abspath(args.out)
    os.makedirs(outdir, exist_ok=True)
    vertical = bool(args.vertical or plan.get("vertical"))
    workers = args.workers or min(6, max(1, cpu_count() or 1))
    warnings = []
    excluded = list(plan.get("excluded") or [])
    tmp = tempfile.mkdtemp(prefix="proism_render_")
    try:
        font = find_font(args.font, assets)
        log("글꼴: %s" % os.path.basename(font[0]))
        tmp_dl = os.path.join(tmp, "dl")
        os.makedirs(tmp_dl, exist_ok=True)
        items = collect_items(plan, plan_dir, tmp_dl, warnings, excluded)
        n_in = len(plan.get("photos") or [])
        items = auto_blur_filter(items, excluded, warnings)
        n_photo = sum(1 for it in items if it["kind"] == "photo")
        n_clip = len(items) - n_photo
        if len(items) < 3:
            log("오류: 사용할 수 있는 사진이 %d장뿐입니다(최소 3장)" % len(items))
            return 2
        auto_blur = sum(1 for e in excluded if e.get("reason", "").startswith("흐림(자동"))
        log("사진 %d장 중 %d장 사용, 제외 %d장%s%s" % (
            n_in, n_photo, n_in - n_photo - n_clip,
            " (흐림 %d)" % auto_blur if auto_blur else "", ", 클립 %d개" % n_clip if n_clip else ""))
        bgm = None
        bsrc = plan.get("bgm")
        if bsrc:
            try:
                bpath = resolve_src(bsrc, plan_dir, tmp_dl, "bgm.mp3")
                bgm = dict(path=bpath, name=safe_name(bsrc, "bgm"))
            except RenderError as e:
                warnings.append("BGM 사용 불가 → 무음: %s" % e)
        else:
            warnings.append("BGM 미지정 → 무음")

        report = dict(fps=FPS, photos_used=n_photo, clips_used=n_clip, excluded=excluded,
                      bgm=(bgm["name"] if bgm else None), warnings=warnings, title=plan.get("title"))
        out_h = os.path.join(outdir, "영상.mp4")
        rh = render_variant(plan, items, assets, font, tmp, out_h, False, workers, args.fast, warnings, bgm)
        report.update(duration_sec=rh["duration_sec"], width=rh["width"], height=rh["height"], chapters=rh["chapters"],
                      horizontal=rh)
        report["audio"] = volume_detect(out_h)
        try:
            contact_sheet(out_h, rh["duration_sec"], os.path.join(outdir, "contact_sheet.jpg"), tmp, font[0], font[1], False)
        except Exception as e:  # noqa: BLE001
            warnings.append("contact_sheet 생성 실패: %s" % e)
        if vertical:
            out_v = os.path.join(outdir, "영상_세로.mp4")
            rv = render_variant(plan, items, assets, font, tmp, out_v, True, workers, args.fast, warnings, bgm)
            report["vertical"] = rv
            try:
                contact_sheet(out_v, rv["duration_sec"], os.path.join(outdir, "contact_sheet_세로.jpg"), tmp, font[0], font[1], True)
            except Exception as e:  # noqa: BLE001
                warnings.append("세로 contact_sheet 생성 실패: %s" % e)
        seen = set()
        warnings[:] = [w for w in warnings if not (w in seen or seen.add(w))]
        report["render_time_sec"] = round(time.time() - t_start, 1)
        with open(os.path.join(outdir, "report.json"), "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        log("완료: %s (%.1f초, %dx%d, 총 %.0f초 소요)" % (out_h, rh["duration_sec"], rh["width"], rh["height"], time.time() - t_start))
        if vertical:
            log("완료: %s (%.1f초)" % (out_v, rv["duration_sec"]))
        for w in warnings:
            log("경고: %s" % w)
        return 0
    except RenderError as e:
        log("오류: %s" % e)
        return 1
    finally:
        if args.keep_temp:
            log("임시 폴더 유지: %s" % tmp)
        else:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
