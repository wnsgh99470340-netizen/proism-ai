import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 배포마다 바뀌는 값: VersionWatcher 가 새 배포를 알아채는 데 쓴다 (Vercel 커밋 해시, 없으면 빌드 시각)
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now()) },
};

export default nextConfig;
