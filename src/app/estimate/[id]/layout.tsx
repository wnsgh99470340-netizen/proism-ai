import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '3M 프로이즘 견적서',
  description: '3M 프로이즘 강남서초점에서 보내드리는 견적서입니다',
  openGraph: {
    title: '3M 프로이즘 견적서',
    description: '3M 프로이즘 강남서초점에서 보내드리는 견적서입니다',
    siteName: '3M 프로이즘',
  },
};

export default function EstimateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
