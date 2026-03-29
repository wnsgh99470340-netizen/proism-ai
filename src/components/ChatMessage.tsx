'use client';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  employeeName?: string;
  employeeEmoji?: string;
  employeeColor?: string;
  images?: string[];
}

export default function ChatMessage({
  role,
  content,
  employeeName,
  employeeEmoji,
  employeeColor,
  images,
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

        <div className="bg-[#1a1a1f] border border-[#1e1e22] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm text-[#e4e4e7] leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      </div>
    </div>
  );
}
