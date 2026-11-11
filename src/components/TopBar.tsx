'use client';

import { team } from '@/config/team';
import { useState } from 'react';
import Link from 'next/link';
import { useTheme } from '@/components/ThemeProvider';
import PushToggle from '@/components/PushToggle';

interface TopBarProps {
  activeEmployeeId?: string;
  onHelpClick: () => void;
}

export default function TopBar({ activeEmployeeId, onHelpClick }: TopBarProps) {
  const [showTeam, setShowTeam] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();

  return (
    <div className="h-14 md:h-16 border-b border-[var(--c-border)] bg-[var(--c-card)] flex items-center px-4 md:px-6 justify-between shrink-0 gap-2">
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="w-9 h-9 rounded-lg bg-brand text-white font-extrabold text-[13px] tracking-tight flex items-center justify-center">3M</span>
          <span className="text-[var(--c-text-1)] font-bold text-[15px] md:text-base whitespace-nowrap">프로이즘 강남 서초점 <span className="text-[var(--c-text-3)] font-medium ml-1 hidden sm:inline">블로그 AI</span></span>
        </div>
        <Link
          href="/crm"
          className="text-xs md:text-sm font-semibold text-[var(--c-text-1)] border border-[var(--c-border)] hover:bg-[var(--c-subtle)] rounded-full px-3.5 py-1.5 whitespace-nowrap transition-colors ml-1"
        >
          <span className="hidden sm:inline">고객 관리 </span>CRM
        </Link>
      </div>

      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        {/* 팀원 아바타 (모바일 숨김) */}
        <div className="relative hidden md:block">
          <button
            onClick={() => setShowTeam(!showTeam)}
            className="flex items-center gap-1 hover:bg-[var(--c-subtle)] rounded-lg px-2 py-1 transition-colors"
          >
            <div className="flex -space-x-1.5">
              {team.slice(0, 6).map((member) => (
                <div
                  key={member.id}
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs border-2 ${
                    activeEmployeeId === member.id
                      ? 'border-gold ring-1 ring-gold'
                      : 'border-[var(--c-card)]'
                  }`}
                  style={{ backgroundColor: member.color + '22' }}
                  title={member.name}
                >
                  {member.emoji}
                </div>
              ))}
            </div>
            <span className="text-[var(--c-text-3)] text-xs ml-1">+{team.length - 6}</span>
          </button>

          {showTeam && (
            <div className="absolute right-0 top-10 w-72 bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl shadow-2xl z-50 p-3 max-h-96 overflow-y-auto">
              <div className="text-[var(--c-text-3)] text-xs font-medium mb-2 px-1">AI 팀원 ({team.length}명)</div>
              {['마케팅', '콘텐츠', '개발'].map((group) => (
                <div key={group} className="mb-2">
                  <div className="text-[var(--c-text-3)] text-[10px] uppercase tracking-wider px-1 mb-1">{group}</div>
                  {team
                    .filter((m) => m.group === group)
                    .map((member) => (
                      <div
                        key={member.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${
                          activeEmployeeId === member.id ? 'bg-[var(--c-subtle)]' : ''
                        }`}
                      >
                        <span>{member.emoji}</span>
                        <span className="text-[var(--c-text-1)]">{member.name}</span>
                        {activeEmployeeId === member.id && (
                          <span className="ml-auto text-[10px] text-gold">작업중</span>
                        )}
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <PushToggle />
          <button
            onClick={toggleTheme}
            className="w-7 h-7 rounded-full bg-[var(--c-subtle)] flex items-center justify-center hover:bg-[var(--c-hover)] transition-colors text-sm"
            title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
          >
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
          <button
            onClick={onHelpClick}
            className="w-7 h-7 rounded-full bg-[var(--c-subtle)] flex items-center justify-center text-[var(--c-text-3)] hover:text-[var(--c-text-1)] hover:bg-[var(--c-hover)] transition-colors text-sm"
            title="사용 가이드"
          >
            ?
          </button>
          <div className="hidden sm:flex items-center gap-1.5 bg-[var(--c-subtle)] rounded-lg px-2.5 py-1">
            <div className="w-2 h-2 rounded-full bg-ok" />
            <span className="text-[var(--c-text-1)] text-xs">roice_</span>
          </div>
        </div>
      </div>
    </div>
  );
}
