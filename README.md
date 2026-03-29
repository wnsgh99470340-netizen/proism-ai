# 3M 프로이즘 AI 마케팅 에이전트

사진만 올리면 네이버 블로그 글이 자동으로 완성되는 AI 시스템

## 설치 방법

### Windows
1. Git 설치: https://git-scm.com/download/win (기본 설정으로 Next 계속 클릭)
2. Node.js 설치: https://nodejs.org (LTS 버전 다운로드 후 설치)
3. 이 저장소를 다운로드:
   ```
   git clone [저장소URL]
   cd proism-app
   ```
4. 패키지 설치:
   ```
   npm install
   ```
5. API 키 설정:
   - 프로젝트 폴더에 `.env.local` 파일을 만들고:
   ```
   ANTHROPIC_API_KEY=여기에_API키_입력
   ```
   - API 키 발급: https://console.anthropic.com → API Keys → Create Key
6. 실행:
   ```
   npm run dev
   ```
7. 브라우저에서 http://localhost:3000 접속

### Mac
1. 터미널 열기 (Spotlight → "터미널")
2. Homebrew 설치 (없으면):
   ```
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
3. Git + Node.js 설치:
   ```
   brew install git node
   ```
4. 이후 Windows의 3~7번과 동일

## 사용 방법
1. 시공 사진을 드래그앤드롭으로 업로드
2. AI가 사진을 분석하고 활용법을 제안
3. "BMW M4 전체 PPF 시공기 써줘" 같이 입력
4. AI가 기존 블로그 스타일 그대로 글 작성
5. 미리보기 확인 → 수정 요청 → HTML 복사 → 네이버 블로그에 붙여넣기

## 기능
- 13명 AI 직원 (마케팅7 + 콘텐츠4 + 개발2)
- 사진 업로드 → Claude Vision 자동 분석 → 활용 제안
- 대화 기반 블로그 글 작성/수정
- 네이버 블로그 실시간 미리보기
- QA 스코어링 (품질 자동 채점)
- SEO/마케팅 인사이트
- HTML 복사 (네이버 에디터 붙여넣기용)
