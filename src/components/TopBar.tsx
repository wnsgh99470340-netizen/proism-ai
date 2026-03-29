'use client';

import { team } from '@/config/team';
import { useState } from 'react';

interface TopBarProps {
  activeEmployeeId?: string;
  onHelpClick: () => void;
}

export default function TopBar({ activeEmployeeId, onHelpClick }: TopBarProps) {
  const [showTeam, setShowTeam] = useState(false);

  return (
    <div className="h-14 border-b border-[#1e1e22] bg-[#111113] flex items-center px-4 justify-between shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[#E4002B] text-lg font-bold">◆</span>
          <span className="text-[#fafaf9] font-semibold text-sm">3M 프로이즘 AI</span>
        </div>
        <span className="text-[#71717a] text-xs">마케팅 에이전트</span>
      </div>

      <div className="flex items-center gap-3">
        {/* 팀원 아바타 */}
        <div className="relative">
          <button
            onClick={() => setShowTeam(!showTeam)}
            className="flex items-center gap-1 hover:bg-[#1e1e22] rounded-lg px-2 py-1 transition-colors"
          >
            <div className="flex -space-x-1.5">
              {team.slice(0, 6).map((member) => (
                <div
                  key={member.id}
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs border-2 ${
                    activeEmployeeId === member.id
                      ? 'border-[#C8A951] ring-1 ring-[#C8A951]'
                      : 'border-[#111113]'
                  }`}
                  style={{ backgroundColor: member.color + '22' }}
                  title={member.name}
                >
                  {member.emoji}
                </div>
              ))}
            </div>
            <span className="text-[#71717a] text-xs ml-1">+{team.length - 6}</span>
          </button>

          {showTeam && (
            <div className="absolute right-0 top-10 w-72 bg-[#111113] border border-[#1e1e22] rounded-xl shadow-2xl z-50 p-3 max-h-96 overflow-y-auto">
              <div className="text-[#71717a] text-xs font-medium mb-2 px-1">AI 팀원 ({team.length}명)</div>
              {['마케팅', '콘텐츠', '개발'].map((group) => (
                <div key={group} className="mb-2">
                  <div className="text-[#71717a] text-[10px] uppercase tracking-wider px-1 mb-1">{group}</div>
                  {team
                    .filter((m) => m.group === group)
                    .map((member) => (
                      <div
                        key={member.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${
                          activeEmployeeId === member.id ? 'bg-[#1e1e22]' : ''
                        }`}
                      >
                        <span>{member.emoji}</span>
                        <span className="text-[#fafaf9]">{member.name}</span>
                        {activeEmployeeId === member.id && (
                          <span className="ml-auto text-[10px] text-[#C8A951]">작업중</span>
                        )}
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onHelpClick}
            className="w-7 h-7 rounded-full bg-[#1e1e22] flex items-center justify-center text-[#71717a] hover:text-[#fafaf9] hover:bg-[#2a2a2e] transition-colors text-sm"
            title="사용 가이드"
          >
            ?
          </button>
          <div className="flex items-center gap-1.5 bg-[#1e1e22] rounded-lg px-2.5 py-1">
            <div className="w-2 h-2 rounded-full bg-[#10B981]" />
            <span className="text-[#fafaf9] text-xs">roice_</span>
          </div>
        </div>
      </div>
    </div>
  );
}
