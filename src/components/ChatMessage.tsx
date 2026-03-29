'use client';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  employeeName?: string;
  employeeEmoji?: string;
  employeeColor?: string;
  images?: string[];
  analysis?: {
    vehicle: string;
    stage: string;
    description: string;
    suggestion: string;
    caption: string;
  } | null;
}

export default function ChatMessage({
  role,
  content,
  employeeName,
  employeeEmoji,
  employeeColor,
  images,
  analysis,
}: ChatMessageProps) {
  if (role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%]">
          {images && images.length > 0 && (
            <div className="flex gap-2 mb-2 justify-end flex-wrap">
              {images.map((img, i) => (
                <img
                  key={i}
                  src={img}
                  alt={`업로드 ${i + 1}`}
                  className="w-20 h-20 object-cover rounded-lg border border-[#1e1e22]"
                />
              ))}
            </div>
          )}
          {content && (
            <div className="bg-[#E4002B] text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed">
              {content}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex mb-4 gap-2.5">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 mt-0.5"
        style={{ backgroundColor: (employeeColor || '#C8A951') + '22' }}
      >
        {employeeEmoji || '✍️'}
      </div>
      <div className="max-w-[85%]">
        {employeeName && (
          <div className="text-xs mb-1" style={{ color: employeeColor || '#C8A951' }}>
            {employeeEmoji} {employeeName}
          </div>
        )}

        {/* 사진 분석 결과 */}
        {analysis && (
          <div className="bg-[#1a1a1f] border border-[#1e1e22] rounded-xl p-3 mb-2">
            <div className="text-xs text-[#C8A951] font-medium mb-2">📷 사진 분석 결과</div>
            <div className="space-y-1 text-xs text-[#a1a1aa]">
              <div>• 차종: <span className="text-[#fafaf9]">{analysis.vehicle}</span></div>
              <div>• 장면: <span className="text-[#fafaf9]">{analysis.description}</span></div>
              <div>• 시공 단계: <span className="text-[#fafaf9]">{analysis.stage}</span></div>
            </div>
            <div className="mt-2 text-xs text-[#71717a] border-t border-[#1e1e22] pt-2">
              💡 {analysis.suggestion}
            </div>
          </div>
        )}

        <div className="bg-[#1a1a1f] border border-[#1e1e22] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm text-[#e4e4e7] leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      </div>
    </div>
  );
}
