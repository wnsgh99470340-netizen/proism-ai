import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '3M 프로이즘 시공 보증서',
  description: '3M 프로이즘 강남서초점 시공 보증서입니다',
  openGraph: {
    title: '3M 프로이즘 시공 보증서',
    description: '3M 프로이즘 강남서초점 시공 보증서입니다',
    siteName: '3M 프로이즘',
  },
};

export default function WarrantyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
