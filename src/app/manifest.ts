import type { MetadataRoute } from 'next';

/** PWA 매니페스트 (/manifest.webmanifest) — 홈 화면 추가용 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '3M 프로이즘',
    short_name: '3M 프로이즘',
    description: '3M 프로이즘 강남서초점 블로그 자동화 + 고객 관리',
    lang: 'ko',
    start_url: '/crm',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f5f5f6',
    theme_color: '#E4002B',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
