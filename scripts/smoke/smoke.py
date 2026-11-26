#!/usr/bin/env python3
"""
CRM 배포 전 자동 점검 (2026-11-25 사장님 "배포 전 자동 점검 스크립트").
- Playwright(파이썬)로 로컬 서버를 실제로 열어 홈·고객 목록·예약 달력·사후관리·상담 기록·고객 상세·작업 내역서 창·블로그 탭·회원 탭을 한 바퀴 돈다
- **읽기만 한다**: 저장·완료·문자 보내기는 누르지 않는다. confirm/alert/prompt 는 전부 취소로 닫는다
- 실행: `npm run smoke` (scripts/smoke/run.py 가 dev 서버를 켜고 이 파일을 돌린 뒤 끈다). 이미 켜진 서버에 돌리려면 `python3 scripts/smoke/smoke.py --base http://localhost:3000`
- 로그인은 .env.local 의 CRM_PASSWORD 로 쿠키를 만들어 넣는다(값은 출력하지 않음). 결과는 표로, 화면은 scripts/smoke/out/ (깃 제외)
"""
import argparse, hashlib, os, re, sys, time
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'scripts', 'smoke', 'out')


def auth_cookie():
    env = open(os.path.join(ROOT, '.env.local'), encoding='utf-8').read()
    m = re.search(r'^CRM_PASSWORD=(.*)$', env, re.M)
    if not m:
        sys.exit('CRM_PASSWORD 가 .env.local 에 없습니다')
    pw = m.group(1).strip().strip('"\'')
    return hashlib.sha256(f'proism-crm-v1:{pw}'.encode()).hexdigest()


class Smoke:
    def __init__(self, base, mobile=False):
        self.base = base; self.mobile = mobile; self.results = []; self.console_errors = []

    def record(self, name, ok, note=''):
        self.results.append((name, ok, note))
        print(f"{'OK ' if ok else 'FAIL'}  {name}{(' — ' + note) if note else ''}", flush=True)

    def check(self, name, fn):
        try:
            note = fn() or ''
            self.record(name, True, str(note))
        except Exception as e:  # noqa: BLE001
            self.record(name, False, str(e).split('\n')[0][:160])
            try: self.page.screenshot(path=os.path.join(OUT, f"fail-{re.sub(r'[^0-9A-Za-z가-힣]+', '-', name)}.png"), full_page=True)
            except Exception: pass

    def goto(self, path):
        self.page.goto(self.base + path, wait_until='networkidle', timeout=90000)
        self.page.wait_for_timeout(600)

    def shot(self, name):
        self.page.screenshot(path=os.path.join(OUT, f"{'m-' if self.mobile else ''}{name}.png"), full_page=False)

    def no_overflow(self):
        w = self.page.evaluate('[document.documentElement.scrollWidth, window.innerWidth]')
        if w[0] > w[1] + 2: raise AssertionError(f'가로로 넘침 {w[0]}px > 화면 {w[1]}px')
        return f'가로 {w[1]}px 안에 들어옴'

    def run(self):
        os.makedirs(OUT, exist_ok=True)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(
                viewport={'width': 375, 'height': 812} if self.mobile else {'width': 1280, 'height': 900},
                is_mobile=self.mobile, has_touch=self.mobile, device_scale_factor=2,
                user_agent=('Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36' if self.mobile else None),
            )
            host = re.sub(r'^https?://', '', self.base).split(':')[0]
            ctx.add_cookies([{'name': 'crm_auth', 'value': auth_cookie(), 'domain': host, 'path': '/'}])
            self.page = page = ctx.new_page()
            page.set_default_timeout(15000)
            page.on('console', lambda m: self.console_errors.append(m.text) if m.type == 'error' else None)
            page.on('dialog', lambda d: d.dismiss())  # 어떤 확인창도 취소 — 저장·전송이 일어나지 않게

            # 0. 서버·버전
            self.check('서버 응답(/api/version)', lambda: str(page.request.get(self.base + '/api/version').status))

            # 1. 홈
            def home():
                self.goto('/crm?tab=home')
                page.get_by_role('heading', name=re.compile('안녕하세요')).wait_for()
                page.get_by_text('오늘 예약').first.wait_for()
                page.get_by_text('마케팅팀 오늘 한 일').first.wait_for()
                page.get_by_text('오늘 있었던 일').first.wait_for()  # 2026-11-25 메모 카드
                page.get_by_role('button', name='이 탭 새로고침').first.click(); page.wait_for_timeout(800)  # 2026-11-26 헤더 새로고침
                page.get_by_role('button', name='받은 알림').first.click()  # 2026-11-26 받은 알림 창 열고 닫기
                page.get_by_role('heading', name=re.compile('받은 알림')).wait_for()
                page.get_by_role('button', name='닫기').last.click(); page.wait_for_timeout(300)
                self.shot('home'); return self.no_overflow()
            self.check('홈 — 인사·오늘 예약·마케팅팀 카드', home)

            # 2. 고객 목록 + 검색
            first_name = {}
            def customers():
                self.goto('/crm?tab=customers')
                rows = page.locator('tbody tr'); rows.first.wait_for()
                n = rows.count()
                if n == 0: raise AssertionError('고객 줄이 0개')
                name = rows.first.locator('td').first.inner_text().split('\n')[0].strip()
                first_name['v'] = name
                page.get_by_placeholder(re.compile('검색')).fill(name[:2]); page.wait_for_timeout(500)
                after = page.locator('tbody tr').count()
                if after > n: raise AssertionError('검색해도 줄이 안 줄어듦')
                page.get_by_placeholder(re.compile('검색')).fill('')
                self.shot('customers'); return f'{n}줄, 검색 "{name[:2]}" → {after}줄'
            self.check('고객 목록 — 줄·검색', customers)

            # 3. 고객 상세 (시공 기록 있는 첫 손님)
            def detail():
                self.goto('/crm?tab=customers')
                rows = page.locator('tbody tr'); rows.first.wait_for()
                idx = 0
                for i in range(min(rows.count(), 60)):
                    if re.search(r'PPF|랩핑|크롬|신차|썬팅', rows.nth(i).inner_text()): idx = i; break
                rows.nth(idx).click(); page.wait_for_url(re.compile(r'/crm/[0-9a-f-]{8,}'), timeout=30000); page.wait_for_timeout(2500)
                page.get_by_text('이 손님과 있었던 일').first.wait_for()
                page.get_by_text('고객 정보').first.wait_for()
                for tab in ['시공 이력', '상담 기록', '사후관리']:
                    page.get_by_role('button', name=re.compile(f'^{tab}')).first.click(); page.wait_for_timeout(250)
                self.shot('detail'); return self.no_overflow()
            self.check('고객 상세 — 타임라인·고객 정보·탭 전환', detail)

            # 4. 예약/일정 달력 + 리스트 + 날짜 클릭
            def appointments():
                self.goto('/crm?tab=appointments')
                page.get_by_role('button', name='달력').first.wait_for()
                page.get_by_role('button', name='리스트').first.click(); page.wait_for_timeout(400)
                page.get_by_role('button', name='달력').first.click(); page.wait_for_timeout(400)
                # 예약 칩이 있는 날을 눌러 아래 상세 줄이 뜨는지
                chip = page.locator('button:has-text("·")').filter(has_text=re.compile(r'PPF|랩핑|크롬|신차|썬팅|코팅')).first
                if chip.count():
                    chip.click(); page.wait_for_timeout(600)
                    page.get_by_text('고객 정보').first.wait_for()
                self.shot('appointments'); return self.no_overflow()
            self.check('예약/일정 — 달력·리스트·날짜 상세', appointments)

            # 5. 작업 내역서 창 열고 닫기 (저장 안 함)
            def workorder():
                self.goto('/crm?tab=appointments')
                btn = page.get_by_role('button', name='작업 내역서').first
                if btn.count() == 0:
                    chip = page.locator('button').filter(has_text=re.compile(r'PPF|랩핑|크롬|신차|썬팅|코팅')).first
                    chip.click(); page.wait_for_timeout(600)
                    btn = page.get_by_role('button', name='작업 내역서').first
                btn.wait_for(); btn.click()
                page.get_by_role('heading', name='작업 내역서').wait_for()
                self.shot('workorder')
                page.get_by_role('button', name='취소').last.click(); page.wait_for_timeout(300)
                if page.get_by_role('heading', name='작업 내역서').count(): raise AssertionError('취소로 창이 안 닫힘')
                return '열고 취소로 닫음'
            self.check('작업 내역서 창 — 열고 닫기', workorder)

            # 6. 사후관리
            def followups():
                self.goto('/crm?tab=followups')
                page.get_by_text('미처리').first.wait_for()
                page.get_by_role('button', name=re.compile('^QC')).first.click(); page.wait_for_timeout(300)
                page.get_by_role('button', name=re.compile('^전체')).first.click(); page.wait_for_timeout(300)
                page.get_by_role('button', name='오늘').first.click(); page.wait_for_timeout(300)
                self.shot('followups'); return self.no_overflow()
            self.check('사후관리 — 요약·필터·달력', followups)

            # 7. 상담 기록 + 견적 문자 창·통화 요약 창 열고 닫기
            def consultations():
                self.goto('/crm?tab=consultations')
                page.get_by_role('button', name=re.compile('견적 문자')).first.click()
                page.get_by_role('heading', name='견적 문자').wait_for()
                page.get_by_role('button', name='닫기').last.click(); page.wait_for_timeout(300)
                page.get_by_role('button', name=re.compile('통화 요약')).first.click()
                page.get_by_role('heading', name=re.compile('통화 요약')).wait_for()
                page.get_by_role('button', name='닫기').last.click(); page.wait_for_timeout(300)
                self.shot('consultations'); return '견적 문자·통화 요약 창 열고 닫음'
            self.check('상담 기록 — 견적 문자·통화 요약 창', consultations)

            # 8. 블로그 탭 (폼·모드 전환·미리보기 탭)
            def blog():
                self.goto('/crm?tab=blog')
                page.get_by_role('button', name='시공기', exact=True).first.click(); page.wait_for_timeout(300)
                page.get_by_text('도입 아이디어').first.wait_for()
                page.get_by_role('button', name='FAQ·공지 글', exact=True).first.click(); page.wait_for_timeout(300)
                if not self.mobile:
                    page.get_by_role('button', name='인스타', exact=True).first.click(); page.wait_for_timeout(300)
                    page.get_by_role('button', name='블로그', exact=True).last.click(); page.wait_for_timeout(300)
                self.shot('blog'); return '폼 전환·미리보기 탭 전환'
            self.check('블로그 탭 — 폼·탭 전환', blog)

            # 9. 회원 탭
            def membership():
                self.goto('/crm/membership')
                page.get_by_text('회원 목록').first.wait_for()
                self.shot('membership'); return self.no_overflow()
            self.check('회원 탭', membership)

            # 10. 콘솔 오류 (401 은 뒷자리 시험 같은 의도된 것일 수 있어 그 외만)
            errs = [e for e in self.console_errors if '401' not in e and 'favicon' not in e]
            self.record('콘솔 오류 없음', len(errs) == 0, '' if not errs else errs[0][:140])
            browser.close()
        return self.results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://localhost:3000')
    ap.add_argument('--mobile', action='store_true', help='375px 안드로이드 화면으로도 한 바퀴')
    a = ap.parse_args()
    if not re.match(r'^https?://(localhost|127\.0\.0\.1)(:\d+)?$', a.base):
        sys.exit('로컬 서버에만 돌립니다 (운영 서버에 자동 클릭 금지)')
    t0 = time.time()
    print(f'== CRM 점검 (데스크톱) {a.base}')
    results = Smoke(a.base).run()
    if a.mobile:
        print('== CRM 점검 (375px 안드로이드)')
        results += Smoke(a.base, mobile=True).run()
    fails = [r for r in results if not r[1]]
    print(f'\n== 결과: {len(results) - len(fails)}/{len(results)} 통과, {time.time() - t0:.0f}초. 화면: scripts/smoke/out/')
    if fails:
        print('실패:'); [print(f'  - {n}: {note}') for n, _, note in fails]
        sys.exit(1)


if __name__ == '__main__':
    main()
