#!/usr/bin/env python3
# 네이버 모바일 검색 결과 진단: 키워드별 블록 구성 / 우리 글(roice_) 위치 / 프로이즘 타 블로그·기자단 / 경쟁 상위
import re, html, json, sys, time, urllib.parse, urllib.request, collections
from pathlib import Path

OURS = 'roice_'
OTHER_PROISM = set(a for a in sys.argv[2:] if a)  # 공용 블로그 id (인자로)
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('diag_out')
OUT.mkdir(parents=True, exist_ok=True)
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

KEYWORDS = [
  '서초 PPF','강남 PPF','서초 썬팅','강남 썬팅','서초 랩핑','강남 랩핑','서초 크롬죽이기','강남 크롬죽이기','서초 신차패키지','강남 신차패키지',
  '반포 PPF','잠원 PPF','방배 PPF','역삼 썬팅','청담 썬팅','논현 PPF','양재 PPF','대치 PPF','삼성동 PPF','수서 PPF','신사 랩핑','역삼 랩핑',
  '테슬라 모델3 썬팅','테슬라 PPF','테슬라 모델Y 썬팅','BMW PPF 서초','카니발 랩핑','EV3 PPF','아우디 크롬죽이기','포르쉐 PPF 서울',
  '자동차 PPF 가격','신차패키지 가격','PPF 시리즈50','글라스틴트 로데','3M 프로이즘','프로이즘 강남서초점',
]

def fetch(q):
    url = 'https://m.search.naver.com/search.naver?query=' + urllib.parse.quote(q)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8', 'ignore')

def strip(t):
    return html.unescape(re.sub(r'<[^>]+>', '', t)).replace('\xa0', ' ').strip()

ANCHOR = re.compile(r'<a[^>]*?data-nlog-area="([^"]+)"[^>]*?data-nlog-target-url="(https://m\.(blog|cafe)\.naver\.com/([A-Za-z0-9_\-]+)(?:/(\d+))?[^"]*)"[^>]*?data-heatmap-target="\.link"[^>]*>(.*?)</a>', re.S)
PROFILE = re.compile(r'data-nlog-target-url="https://m\.blog\.naver\.com/([A-Za-z0-9_\-]+)"[^>]*data-heatmap-target="articleSourceJSX_title"[^>]*>(.*?)</a>', re.S)
HEADLINE = re.compile(r'<(?:h2|h3|strong|span)[^>]*class="[^"]*(?:headline|header-title|tit)[^"]*"[^>]*>(.*?)</(?:h2|h3|strong|span)>', re.S)

def analyze(q, s):
    names = {}
    for bid, inner in PROFILE.findall(s):
        t = strip(inner)
        if t and bid not in names: names[bid] = t[:40]
    items, seen = [], set()
    for m in ANCHOR.finditer(s):
        area, url, kind, bid, pid, inner = m.groups()
        key = (kind, bid, pid or '')
        if kind == 'blog' and not pid: continue
        title = strip(inner)
        # 본문 발췌(body1)는 제목이 아님
        if 'sds-comps-text-type-body1' in inner: continue
        if key in seen or not title: continue
        seen.add(key)
        block = area.split('.')[0]
        # 블록 헤더: 이 앵커 앞 30KB 안에서 가장 가까운 headline 텍스트
        pre = s[max(0, m.start() - 30000):m.start()]
        heads = [strip(h) for h in HEADLINE.findall(pre)]
        heads = [h for h in heads if 2 <= len(h) <= 30]
        head = heads[-1] if heads else ''
        items.append({'pos': len(items) + 1, 'kind': kind, 'id': bid, 'post': pid or '', 'title': title[:80], 'block': block, 'head': head, 'name': names.get(bid, '')})
    # 블록별 묶음
    blocks = []
    for it in items:
        if not blocks or blocks[-1]['block'] != it['block']:
            blocks.append({'block': it['block'], 'head': it['head'], 'items': []})
        blocks[-1]['items'].append(it)
    ours = [it for it in items if it['id'] == OURS]
    other = [it for it in items if it['id'] in OTHER_PROISM]
    press = [it for it in items if it['id'] != OURS and it['id'] not in OTHER_PROISM and ('프로이즘' in it['title'] or 'PROIZM' in it['title'].upper() or '프로이즘' in it['name'])]
    comps = [it for it in items if it['id'] != OURS and it['id'] not in OTHER_PROISM and it not in press][:3]
    place = bool(re.search(r'm\.place\.naver\.com|place\.naver\.com', s))
    place_proism = bool(re.search(r'프로이즘[^<]{0,30}</', s[:s.find('m.place.naver.com') + 200000] if place else ''))
    ai_brief = ('AI 브리핑' in s) or ('ai_brief' in s) or ('aibriefing' in s.lower())
    return {'keyword': q, 'total_items': len(items), 'blocks': [{'head': b['head'], 'n': len(b['items']), 'first': b['items'][0]['pos']} for b in blocks],
            'ours': [{'pos': o['pos'], 'head': o['head'], 'title': o['title']} for o in ours],
            'other_proism': [{'pos': o['pos'], 'id': o['id'], 'title': o['title']} for o in other],
            'press': [{'pos': o['pos'], 'id': o['id'], 'title': o['title']} for o in press],
            'competitors': [{'pos': c['pos'], 'id': c['id'], 'name': c['name'], 'title': c['title']} for c in comps],
            'place_block': place, 'place_has_proism': place_proism, 'ai_brief': ai_brief, 'items': items}

results = []
for i, q in enumerate(KEYWORDS, 1):
    try:
        s = fetch(q)
        (OUT / f'{i:02d}.html').write_text(s, encoding='utf-8')
        r = analyze(q, s)
    except Exception as e:  # noqa
        r = {'keyword': q, 'error': str(e)}
    results.append(r)
    o = r.get('ours', [])
    print(f"{i:02d} {q:14s} 항목{r.get('total_items',0):3d} | 우리:{('%d위(%s)' % (o[0]['pos'], o[0]['head'] or '블록?')) if o else '없음':14s} | 타프로이즘:{len(r.get('other_proism',[]))} 기자단:{len(r.get('press',[]))} | 플레이스:{'O' if r.get('place_block') else 'X'} AI브리핑:{'O' if r.get('ai_brief') else 'X'}", flush=True)
    time.sleep(1.5)
(OUT / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding='utf-8')
print('saved', OUT / 'results.json')
