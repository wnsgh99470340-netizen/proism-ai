#!/bin/bash
# CRM 페이지 검증 후 배포 스크립트
set -e

PROJECT_DIR="/Users/junho/Desktop/proism-ai"
PORT=3000
CRM_URL="http://localhost:${PORT}/crm"
MAX_WAIT=30

cd "$PROJECT_DIR"

echo "=== 1단계: 빌드 ==="
npm run build
echo "빌드 성공"

# 기존 3000 포트 프로세스 정리
lsof -ti:${PORT} 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

echo "=== 2단계: 서버 시작 ==="
npm run start &
SERVER_PID=$!

# 서버 준비 대기
echo "서버 준비 대기 중..."
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}" 2>/dev/null | grep -q "200\|307\|308"; then
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

if [ $WAITED -ge $MAX_WAIT ]; then
  echo "서버 시작 실패 (${MAX_WAIT}초 초과) — 배포 중단"
  kill $SERVER_PID 2>/dev/null || true
  exit 1
fi

echo "=== 3단계: CRM 페이지 검증 ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -L "$CRM_URL" 2>/dev/null)
echo "CRM 페이지 응답: HTTP ${HTTP_CODE}"

# 서버 종료
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
echo "서버 종료 완료"

if [ "$HTTP_CODE" != "200" ]; then
  echo ""
  echo "============================================"
  echo "  CRM 페이지 에러 발견 — 배포 중단"
  echo "  HTTP 응답: ${HTTP_CODE} (기대값: 200)"
  echo "============================================"
  exit 1
fi

echo ""
echo "CRM 페이지 검증 통과 (HTTP 200)"
echo "=== 4단계: 배포 ==="
npx vercel --prod
echo "배포 완료"
