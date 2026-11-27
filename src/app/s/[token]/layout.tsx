import type { Metadata } from 'next';

/** 직원용 예약 페이지: 홈 화면 추가 때 이 주소로 열리게 전용 매니페스트 (2026-11-27) */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const safe = /^[A-Za-z0-9]{24}$/.test(token) ? token : '';
  return {
    title: '프로이즘 예약',
    manifest: `/api/staff/manifest?token=${safe}`,
    appleWebApp: { capable: true, title: '예약', statusBarStyle: 'default' },
    robots: { index: false, follow: false },
  };
}

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return children;
}
