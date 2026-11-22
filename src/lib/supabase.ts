import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isDemoClient } from '@/lib/demo';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * 둘러보기 모드용 빈 클라이언트 (2026-11-22, src/lib/demo.ts)
 * supabase 쿼리 빌더는 어떤 메서드를 이어 붙여도 마지막에 await 되는 thenable 이라,
 * 무엇을 호출하든 자기 자신을 돌려주다가 await 되면 { data: [], error: null, count: 0 } 으로 끝나는 Proxy 로 대신한다.
 * 읽기는 전부 0건, 쓰기는 아무 데도 가지 않는다 (DB 주소·키를 아예 들고 있지 않음)
 */
function emptyClient(): SupabaseClient {
  const result = { data: [], error: null, count: 0, status: 200, statusText: 'demo' };
  const proxy: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (onOk: (v: unknown) => unknown) => Promise.resolve(result).then(onOk);
      if (prop === 'catch' || prop === 'finally') return () => proxy;
      if (prop === Symbol.toPrimitive || prop === 'toString') return () => '[demo-supabase]';
      return proxy;
    },
    apply() { return proxy; },
  });
  return proxy as SupabaseClient;
}

export const supabase: SupabaseClient = typeof document !== 'undefined' && isDemoClient()
  ? emptyClient()
  : createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder');
