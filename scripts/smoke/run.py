#!/usr/bin/env python3
"""
`npm run smoke`: dev 서버를 빈 포트(기본 3100)에 켜고 smoke.py 를 돌린 뒤 끈다. 이미 3000 에 서버가 켜져 있어도 부딪히지 않는다.
옵션은 smoke.py 로 그대로 넘어간다 (예: npm run smoke -- --mobile)
"""
import os, socket, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PORT = int(os.environ.get('SMOKE_PORT', '3100'))



def pick_python():
    """playwright 가 깔린 파이썬을 고른다. 2026-11-26 brew 가 python@3.15 를 깔아 `python3` 가 그쪽을 가리키면서
    시스템 파이썬(3.9, playwright 설치됨)이 가려져 smoke 가 ModuleNotFoundError 로 죽었음."""
    for exe in [sys.executable, '/usr/bin/python3', 'python3']:
        try:
            if subprocess.call([exe, '-c', 'import playwright'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0:
                return exe
        except OSError:
            pass
    return sys.executable

def port_open(port):
    try:
        with socket.create_connection(('localhost', port), timeout=1): return True
    except OSError: return False


def main():
    args = [a for a in sys.argv[1:] if a != '--']
    if port_open(PORT):
        sys.exit(f'{PORT} 포트가 이미 쓰이고 있습니다. SMOKE_PORT=다른번호 로 다시 실행해 주세요')
    env = dict(os.environ, PORT=str(PORT), NEXT_TELEMETRY_DISABLED='1')
    server = subprocess.Popen(['npx', 'next', 'dev', '-p', str(PORT)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(120):
            if port_open(PORT): break
            time.sleep(0.5)
        else:
            sys.exit('dev 서버가 60초 안에 안 떴습니다')
        time.sleep(1.5)
        code = subprocess.call([pick_python(), os.path.join(ROOT, 'scripts', 'smoke', 'smoke.py'), '--base', f'http://localhost:{PORT}', *args], cwd=ROOT)
    finally:
        server.terminate()
        try: server.wait(timeout=10)
        except subprocess.TimeoutExpired: server.kill()
    sys.exit(code)


if __name__ == '__main__':
    main()
