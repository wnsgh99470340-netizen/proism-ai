# -*- coding: utf-8 -*-
"""
마크다운 → 보기 편한 PDF (2026-11-27 사장님 "좀 보기 편하게 정리해서 올려주면" — 바탕화면 정신차려 폴더용)
사용: /usr/bin/python3 scripts/desk/md2pdf.py <in.md> [<out.pdf>]   (여러 개면 in.md 를 나열, out 생략 시 같은 이름 .pdf)
시스템 파이썬(3.9)에 markdown + playwright 가 깔려 있다. 폰에서도 읽히게 A4, 큰 글자, 표는 줄무늬.
"""
import sys, os, re
import markdown
from playwright.sync_api import sync_playwright

CSS = """
@page { size: A4; margin: 16mm 14mm; }
body { font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; font-size: 13.5px; line-height: 1.65; color: #16181d; word-break: keep-all; }
h1 { font-size: 22px; margin: 0 0 14px; padding-bottom: 8px; border-bottom: 2px solid #e4002b; }
h2 { font-size: 17px; margin: 22px 0 8px; color: #e4002b; }
h3 { font-size: 14.5px; margin: 16px 0 6px; }
p { margin: 6px 0; }
ul, ol { padding-left: 20px; margin: 6px 0; }
li { margin: 3px 0; }
strong { color: #000; }
code { font-family: Menlo, monospace; font-size: 12px; background: #f3f3f3; padding: 1px 4px; border-radius: 3px; }
pre { background: #f3f3f3; padding: 8px; border-radius: 6px; white-space: pre-wrap; font-size: 12px; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; font-size: 12.5px; }
th, td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; text-align: left; }
th { background: #f6f6f6; }
tr:nth-child(even) td { background: #fafafa; }
blockquote { margin: 8px 0; padding: 6px 12px; border-left: 3px solid #e4002b; background: #fff5f6; }
hr { border: 0; border-top: 1px solid #ddd; margin: 16px 0; }
.meta { color: #777; font-size: 11px; margin-bottom: 12px; }
"""

def convert(src: str, out: str) -> None:
    text = open(src, encoding='utf-8').read()
    # 마크다운 제목이 없으면 파일 이름을 제목으로
    if not re.search(r'^# ', text, re.M):
        title = os.path.splitext(os.path.basename(src))[0]
        text = f'# {title}\n\n{text}'
    html_body = markdown.markdown(text, extensions=['tables', 'fenced_code', 'sane_lists', 'nl2br'])
    html = f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>{CSS}</style></head><body>{html_body}</body></html>'
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.set_content(html, wait_until='load')
        pg.pdf(path=out, format='A4', print_background=True, margin={'top': '16mm', 'bottom': '16mm', 'left': '14mm', 'right': '14mm'})
        b.close()

if __name__ == '__main__':
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(1)
    if len(args) == 2 and args[1].lower().endswith('.pdf'):
        convert(args[0], args[1]); print(args[1])
    else:
        for a in args:
            out = os.path.splitext(a)[0] + '.pdf'
            convert(a, out); print(out)
