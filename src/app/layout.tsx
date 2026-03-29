import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '3M 프로이즘 AI 마케팅 에이전트',
  description: '사진만 올리면 네이버 블로그 글이 자동으로 완성되는 AI 시스템',
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
