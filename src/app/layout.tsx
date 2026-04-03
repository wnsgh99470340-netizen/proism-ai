import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '3M 프로이즘 | PPF·틴팅·코팅 전문',
  description: '3M 프로이즘 강남서초점 - PPF, 틴팅, 세라믹코팅, 래핑 전문 시공점',
  openGraph: {
    title: '3M 프로이즘 | PPF·틴팅·코팅 전문',
    description: '3M 프로이즘 강남서초점 - PPF, 틴팅, 세라믹코팅, 래핑 전문 시공점',
    siteName: '3M 프로이즘',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
