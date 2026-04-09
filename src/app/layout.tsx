import type { Metadata } from 'next';
import ThemeProvider from '@/components/ThemeProvider';
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

const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script src="https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body className="h-full">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
