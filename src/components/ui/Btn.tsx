'use client';
/**
 * 앱 공통 버튼 (2026-11-25 사장님 "앱 안 버튼들(스크린샷·복사·명함·견적 문자·문의 답변 등) 너무 못생겼음")
 * 연락처 저장 버튼에서 좋아하신 모양을 기준으로: 알약, 선 아이콘, 짧은 글자, 이모지 없음.
 *  - primary: 빨강 채움(그 화면의 주 행동 하나) / dark: 검정 채움 / outline: 테두리(보통) / subtle: 연회색 / kakao: 카카오 노랑 / ghost: 테두리 없음
 *  - size md(상단 도구줄) / sm(줄 안 칩)
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export type BtnVariant = 'primary' | 'dark' | 'outline' | 'subtle' | 'kakao' | 'ghost' | 'danger';
export type BtnSize = 'md' | 'sm' | 'xs';

const V: Record<BtnVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark border border-transparent',
  dark: 'bg-[var(--c-text-1)] text-[var(--c-card)] hover:opacity-90 border border-transparent',
  outline: 'bg-[var(--c-card)] text-[var(--c-text-1)] border border-[var(--c-border)] hover:bg-[var(--c-subtle)]',
  subtle: 'bg-[var(--c-subtle)] text-[var(--c-text-1)] border border-transparent hover:bg-[var(--c-hover)]',
  kakao: 'bg-[#FEE500] text-[#191919] border border-transparent hover:bg-[#FDD835]',
  ghost: 'bg-transparent text-[var(--c-text-3)] border border-transparent hover:text-[var(--c-text-1)] hover:bg-[var(--c-subtle)]',
  danger: 'bg-danger/10 text-danger border border-transparent hover:bg-danger/15',
};
const S: Record<BtnSize, { pad: string; text: string; icon: number }> = {
  md: { pad: 'px-3.5 py-2 gap-1.5', text: 'text-sm', icon: 15 },
  sm: { pad: 'px-2.5 py-1.5 gap-1', text: 'text-xs', icon: 13 },
  xs: { pad: 'px-2 py-1 gap-1', text: 'text-[11px]', icon: 12 },
};

export default function Btn({ icon, variant = 'outline', size = 'md', children, className = '', ...rest }: { icon?: IconName; variant?: BtnVariant; size?: BtnSize; children?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const s = S[size];
  return (
    <button type="button" {...rest} className={`inline-flex items-center justify-center rounded-full font-semibold whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${V[variant]} ${s.pad} ${s.text} ${className}`}>
      {icon && <Icon name={icon} size={s.icon} />}
      {children}
    </button>
  );
}
