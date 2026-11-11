import type { Metadata } from 'next';

/**
 * 공개 명함 페이지 (2026-11-11) — 견적 문자 끝에 링크로 붙는다.
 * 로그인 없이 열리고, 연락처 저장(vCard)·전화·톡톡·블로그·지도 버튼과 명함 앞뒤, 3M 프리퍼드 인스톨러 인증서를 보여준다.
 * 개인정보(생년월일·자격번호)가 있는 국가기술자격증은 올리지 않는다.
 */
export const metadata: Metadata = {
  title: '3M 프로이즘 강남서초점 · 대표 진준호',
  description: '신차패키지 · 썬팅 · 랩핑 · PPF — 3M 프리퍼드 인스톨러. 서울 서초구 서초중앙로8길 82 1동 1층 1호 / 010-7287-7140',
  openGraph: { title: '3M 프로이즘 강남서초점 · 대표 진준호', description: '신차패키지 · 썬팅 · 랩핑 · PPF / 010-7287-7140', images: ['/card/front.jpg'] },
};

const PHONE = '010-7287-7140';
const btn = 'flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition-colors';

export default function CardPage() {
  return (
    <main className="min-h-screen bg-[#0f0f12] text-white">
      <div className="mx-auto max-w-md px-4 py-6 space-y-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/card/front.jpg" alt="3M 프로이즘 명함 앞면" className="w-full rounded-2xl shadow-2xl" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/card/back.jpg" alt="3M 프로이즘 대표 진준호 명함 뒷면" className="w-full rounded-2xl shadow-2xl bg-white" />

        <div className="pt-2">
          <div className="text-xs text-white/50">3M 프로이즘 강남서초점 · 대표</div>
          <div className="text-2xl font-bold tracking-tight">진준호</div>
          <div className="text-sm text-white/70 mt-1">신차패키지 · 썬팅 · 랩핑 · PPF · 3M 프리퍼드 인스톨러</div>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <a href="/card/proism.vcf" download="3M프로이즘_진준호.vcf" className={`${btn} bg-[#E4002B] hover:bg-[#c60026] text-white`}>📇 연락처에 저장하기</a>
          <div className="grid grid-cols-2 gap-2">
            <a href={`tel:${PHONE}`} className={`${btn} bg-white/10 hover:bg-white/15`}>📞 전화 {PHONE}</a>
            <a href="http://talk.naver.com/wy4w32e" className={`${btn} bg-[#03C75A]/90 hover:bg-[#03C75A] text-white`}>💬 네이버 톡톡</a>
            <a href="https://blog.naver.com/roice_" className={`${btn} bg-white/10 hover:bg-white/15`}>📝 블로그</a>
            <a href="https://map.naver.com/p/entry/place/2043882706" className={`${btn} bg-white/10 hover:bg-white/15`}>📍 지도·길찾기</a>
          </div>
        </div>

        <div className="rounded-2xl bg-white/5 p-4 text-sm leading-relaxed text-white/80">
          <div className="font-semibold text-white mb-1">오시는 길</div>
          서울특별시 서초구 서초중앙로8길 82 1동 1층 1호<br />
          영업 중 문의는 전화가 가장 빠릅니다
        </div>

        <div className="pt-2">
          <div className="text-xs text-white/50 mb-2">3M Car Wrap Film Preferred Installer 인증</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/card/3m-preferred-installer.jpg" alt="3M Preferred Installer 인증서 — Junho Jin" className="w-full rounded-2xl shadow-xl bg-white" />
          <div className="text-[11px] text-white/40 mt-2">3M 필름 인스톨 트레이닝 센터 검증 · 3M 랩마스터 · 자동차정비산업기사(국가기술자격) 보유</div>
        </div>

        <div className="text-center text-[11px] text-white/30 pt-4 pb-8">© 3M 프로이즘 강남서초점</div>
      </div>
    </main>
  );
}
