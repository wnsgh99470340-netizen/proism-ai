import { defineConfig } from 'vitest/config';
import path from 'node:path';

// 자동 시험 (2026-11-23 사장님 "자동 시험이랑 파일 쪼개기 지금 해야 하는 거 아니야?")
// 순수 로직은 그대로, DB 를 쓰는 흐름은 src/test/fake-supabase.ts 의 메모리 DB 로 돈다. 실제 Supabase 에는 절대 붙지 않는다
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { include: ['src/**/__tests__/**/*.test.ts'], environment: 'node', globals: false },
});
